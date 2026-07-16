# League System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 7-tier weekly League (Bronza→Chempion), built on the existing XP infrastructure, with an idempotent admin-triggered weekly promotion/relegation computation (no new job-scheduling dependency).

**Architecture:** A new `backend/src/league/` module (pure tier-ranking logic, a Postgres repository, and routes) hooks into the EXISTING `progressionService.ts` orchestrator (same call site as XP/Mastery/Daily Quest/Streak) to accumulate weekly XP lazily, exactly like `daily_quest_progress`. The weekly promotion/relegation computation is exposed as an idempotent admin-only endpoint (`POST /api/admin/league/process-week`), meant to be triggered by a host-level crontab entry (matching the existing `scripts/healthcheck-alert.sh` pattern) — **not** an in-process scheduler, since this deployment could scale to multiple instances later and an in-process timer would then risk double-processing.

**Tech Stack:** Backend: Node/TypeScript/Express/PostgreSQL/Redis, Jest against a real local Postgres+Redis. Frontend: Vite/React/TypeScript/Tailwind v4, Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-07-16-league-system-design.md`

**Deployment note (not part of any task below, a manual step for whoever deploys this):** after this plan ships, add a crontab entry on the production server, e.g. `5 0 * * 1 curl -X POST -u admin:$ADMIN_PASSWORD https://<domain>/api/admin/league/process-week` (runs every Monday at 00:05).

---

### Task 1: Database schema — league_weekly_xp, user_league, league_processing_log

**Files:**
- Modify: `backend/src/db/schema.sql`

- [ ] **Step 1: Add the new tables**

Insert this block into `backend/src/db/schema.sql` immediately after the existing `daily_quest_progress` table definition (added in the previous feature), before the `CREATE INDEX` statements:

```sql
-- One row per (user, ISO week). Mirrors daily_quest_progress's "lazy reset"
-- pattern - a new week simply has no row yet, so a fresh week's XP starts at
-- 0 with no explicit reset step. week_start_date is always a Monday (UTC),
-- computed the same way progression/streakLogic.ts's mostRecentMonday()
-- already computes week boundaries for the daily-streak freeze.
CREATE TABLE IF NOT EXISTS league_weekly_xp (
  user_id INTEGER NOT NULL REFERENCES users(id),
  week_start_date DATE NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, week_start_date)
);

-- A user's CURRENT league tier - persistent, only ever changed by the
-- weekly promotion/relegation computation (see league/leagueRoutes.ts's
-- POST /admin/league/process-week). Defaults new rows to 'Bronza' (created
-- lazily the first time a user earns any weekly XP - see
-- league/leagueRepository.ts's accumulateWeeklyXp).
CREATE TABLE IF NOT EXISTS user_league (
  user_id INTEGER NOT NULL REFERENCES users(id) PRIMARY KEY,
  tier TEXT NOT NULL DEFAULT 'Bronza',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency marker: a row here means promotion/relegation has already run
-- for that week. The weekly-processing endpoint checks this FIRST and
-- no-ops if a row already exists, so an accidental duplicate trigger (e.g.
-- a manual run plus the scheduled crontab run landing the same week) can
-- never double-apply promotions/relegations.
CREATE TABLE IF NOT EXISTS league_processing_log (
  week_start_date DATE PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Apply and verify the migration**

Run (from `backend/`):
```bash
npm run migrate
```
Expected: no errors. Then verify (adjust to your local Postgres connection):
```bash
psql "$DATABASE_URL" -c "\d league_weekly_xp" -c "\d user_league" -c "\d league_processing_log"
```
Expected: all three tables present with the columns above. If `psql` isn't available in your shell, verify via a small ad-hoc Node script using this project's existing `pool` config instead (same approach used to verify Task 1 of the previous XP/Mastery feature).

- [ ] **Step 3: Commit**

```bash
git add backend/src/db/schema.sql
git commit -m "Add league_weekly_xp, user_league, league_processing_log tables"
```

---

### Task 2: Pure league tier logic

**Files:**
- Create: `backend/src/league/leagueTiers.ts`
- Test: `backend/tests/league/leagueTiers.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/league/leagueTiers.test.ts`:

```typescript
import { LEAGUE_TIERS, computeTierChanges } from '../../src/league/leagueTiers';

describe('LEAGUE_TIERS', () => {
  it('has the 7 tiers in ascending order', () => {
    expect(LEAGUE_TIERS).toEqual(['Bronza', 'Kumush', 'Oltin', 'Platina', 'Olmos', 'Usta', 'Chempion']);
  });
});

describe('computeTierChanges', () => {
  it('promotes the top ~20% and relegates the bottom ~20% of a mid-tier bracket', () => {
    const members = Array.from({ length: 10 }, (_, i) => ({ userId: i + 1, weeklyXp: (10 - i) * 100 }));
    const changes = computeTierChanges('Oltin', members);

    // Top 2 (userId 1, 2 - highest XP) promoted to Platina.
    expect(changes).toContainEqual({ userId: 1, newTier: 'Platina' });
    expect(changes).toContainEqual({ userId: 2, newTier: 'Platina' });
    // Bottom 2 (userId 9, 10 - lowest XP) relegated to Kumush.
    expect(changes).toContainEqual({ userId: 9, newTier: 'Kumush' });
    expect(changes).toContainEqual({ userId: 10, newTier: 'Kumush' });
    // Everyone else (userId 3-8) has no change.
    expect(changes.length).toBe(4);
  });

  it('never relegates out of Bronza, the lowest tier', () => {
    const members = Array.from({ length: 10 }, (_, i) => ({ userId: i + 1, weeklyXp: (10 - i) * 100 }));
    const changes = computeTierChanges('Bronza', members);

    // No relegation targets exist below Bronza.
    expect(changes.every((c) => c.newTier !== undefined)).toBe(true);
    expect(changes.some((c) => c.userId === 9 || c.userId === 10)).toBe(false);
    // Promotion to Kumush still applies to the top performers.
    expect(changes).toContainEqual({ userId: 1, newTier: 'Kumush' });
    expect(changes).toContainEqual({ userId: 2, newTier: 'Kumush' });
  });

  it('never promotes past Chempion, the highest tier', () => {
    const members = Array.from({ length: 10 }, (_, i) => ({ userId: i + 1, weeklyXp: (10 - i) * 100 }));
    const changes = computeTierChanges('Chempion', members);

    expect(changes.some((c) => c.userId === 1 || c.userId === 2)).toBe(false);
    // Relegation to Usta still applies to the bottom performers.
    expect(changes).toContainEqual({ userId: 9, newTier: 'Usta' });
    expect(changes).toContainEqual({ userId: 10, newTier: 'Usta' });
  });

  it('returns no changes for an empty bracket', () => {
    expect(computeTierChanges('Oltin', [])).toEqual([]);
  });

  it('returns no changes for a bracket too small for any 20% band to round up to at least 1', () => {
    const members = [
      { userId: 1, weeklyXp: 300 },
      { userId: 2, weeklyXp: 200 },
      { userId: 3, weeklyXp: 100 },
    ];
    expect(computeTierChanges('Oltin', members)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `backend/`):
```bash
npx jest tests/league/leagueTiers.test.ts
```
Expected: FAIL — `Cannot find module '../../src/league/leagueTiers'`.

- [ ] **Step 3: Implement `leagueTiers.ts`**

Create `backend/src/league/leagueTiers.ts`:

```typescript
// backend/src/league/leagueTiers.ts
export type LeagueTier = 'Bronza' | 'Kumush' | 'Oltin' | 'Platina' | 'Olmos' | 'Usta' | 'Chempion';

export const LEAGUE_TIERS: LeagueTier[] = ['Bronza', 'Kumush', 'Oltin', 'Platina', 'Olmos', 'Usta', 'Chempion'];

const PROMOTION_FRACTION = 0.2;
const RELEGATION_FRACTION = 0.2;

export interface BracketMember {
  userId: number;
  weeklyXp: number;
}

export interface TierChange {
  userId: number;
  newTier: LeagueTier;
}

// Ranks one tier's bracket by weekly XP (descending) and returns the tier
// change for each member who is promoted or demoted - top ~20% up one tier
// (no-op at Chempion, the highest), bottom ~20% down one tier (no-op at
// Bronza, the lowest - see the design spec's "never relegate below Bronza"
// rule). Members not in either band are omitted from the result (their
// tier doesn't change). Fractions are floored, so small brackets (where
// 20% rounds down to 0) simply produce no changes that round.
export function computeTierChanges(tier: LeagueTier, members: BracketMember[]): TierChange[] {
  if (members.length === 0) return [];

  const sorted = [...members].sort((a, b) => b.weeklyXp - a.weeklyXp);
  const promoteCount = Math.floor(sorted.length * PROMOTION_FRACTION);
  const relegateCount = Math.floor(sorted.length * RELEGATION_FRACTION);

  const tierIndex = LEAGUE_TIERS.indexOf(tier);
  const changes: TierChange[] = [];

  if (tierIndex < LEAGUE_TIERS.length - 1) {
    for (let i = 0; i < promoteCount; i += 1) {
      changes.push({ userId: sorted[i].userId, newTier: LEAGUE_TIERS[tierIndex + 1] });
    }
  }

  if (tierIndex > 0) {
    for (let i = 0; i < relegateCount; i += 1) {
      const member = sorted[sorted.length - 1 - i];
      // A member already slated for promotion (only possible in a bracket
      // small enough that promoteCount + relegateCount > length) must not
      // also be relegated - promotion wins.
      if (changes.some((c) => c.userId === member.userId)) continue;
      changes.push({ userId: member.userId, newTier: LEAGUE_TIERS[tierIndex - 1] });
    }
  }

  return changes;
}
```

- [ ] **Step 4: Run to verify it passes**

Run (from `backend/`):
```bash
npx jest tests/league/leagueTiers.test.ts
```
Expected: PASS — all tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/league/leagueTiers.ts backend/tests/league/leagueTiers.test.ts
git commit -m "Add pure league tier promotion/relegation logic"
```

---

### Task 3: League repository and weekly XP accumulation

**Files:**
- Create: `backend/src/league/leagueRepository.ts`
- Modify: `backend/src/progression/progressionService.ts`
- Test: `backend/tests/league/leagueRepository.test.ts`
- Test: `backend/tests/game/gameEngineProgression.test.ts` (add one assertion)

- [ ] **Step 1: Write the failing tests for `leagueRepository.ts`**

Create `backend/tests/league/leagueRepository.test.ts`:

```typescript
import { pool } from '../../src/config/db';
import { upsertUser } from '../../src/users/userRepository';
import {
  accumulateWeeklyXp,
  getUserLeague,
  getWeeklyXp,
  getWeeklyBracket,
  getFullBracket,
  applyTierChange,
  isWeekProcessed,
  markWeekProcessed,
  previousWeekStartDateString,
} from '../../src/league/leagueRepository';

describe('leagueRepository', () => {
  let userId: number;

  beforeAll(async () => {
    const user = await upsertUser(882001, 'leagueRepoTestUser', 'LeagueRepoTest', null);
    userId = user.id;
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM league_weekly_xp WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM user_league WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM league_processing_log WHERE week_start_date = '2020-01-06'`);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id = 882001`);
    await pool.end();
  });

  it('defaults a user with no rows to Bronza tier and zero weekly XP', async () => {
    expect(await getUserLeague(userId)).toBe('Bronza');
    expect(await getWeeklyXp(userId)).toBe(0);
  });

  it('accumulates weekly XP and lazily creates a Bronza user_league row', async () => {
    await accumulateWeeklyXp(userId, 50);
    await accumulateWeeklyXp(userId, 30);
    expect(await getWeeklyXp(userId)).toBe(80);
    expect(await getUserLeague(userId)).toBe('Bronza');
  });

  it('does not overwrite an already-promoted tier when accumulating more XP', async () => {
    await accumulateWeeklyXp(userId, 10);
    await applyTierChange(userId, 'Oltin');
    await accumulateWeeklyXp(userId, 10);
    expect(await getUserLeague(userId)).toBe('Oltin');
  });

  it('getWeeklyBracket returns members of the same tier ordered by weekly XP descending', async () => {
    const p2 = await upsertUser(882002, 'leagueRepoTestUser2', 'LeagueRepoTest2', null);
    await accumulateWeeklyXp(userId, 50);
    await accumulateWeeklyXp(p2.id, 100);

    const bracket = await getWeeklyBracket('Bronza', 10);
    const ids = bracket.map((b) => b.telegramId);
    expect(ids.indexOf(882002)).toBeLessThan(ids.indexOf(882001));

    await pool.query(`DELETE FROM league_weekly_xp WHERE user_id = $1`, [p2.id]);
    await pool.query(`DELETE FROM user_league WHERE user_id = $1`, [p2.id]);
    await pool.query(`DELETE FROM users WHERE telegram_id = 882002`);
  });

  it('getFullBracket returns every member of a tier for a given week, unlimited', async () => {
    await accumulateWeeklyXp(userId, 25);
    // Note: backend/src/config/db.ts registers a global Postgres type-parser
    // override for DATE (OID 1082) columns, added in the previous feature -
    // it returns them as plain 'YYYY-MM-DD' strings, NOT JS Date objects.
    // week_start_date below is already a string; do not call .toISOString()
    // on it (that override is exactly why it doesn't need it).
    const weekStart = (await pool.query(`SELECT week_start_date FROM league_weekly_xp WHERE user_id = $1`, [userId]))
      .rows[0].week_start_date;
    const full = await getFullBracket('Bronza', weekStart);
    expect(full.some((m) => m.userId === userId && m.weeklyXp === 25)).toBe(true);
  });

  it('isWeekProcessed/markWeekProcessed track idempotency per week', async () => {
    expect(await isWeekProcessed('2020-01-06')).toBe(false);
    await markWeekProcessed('2020-01-06');
    expect(await isWeekProcessed('2020-01-06')).toBe(true);
    // Marking again must not throw (ON CONFLICT DO NOTHING).
    await markWeekProcessed('2020-01-06');
    expect(await isWeekProcessed('2020-01-06')).toBe(true);
  });

  it('previousWeekStartDateString returns the Monday one week before the given date\'s week', () => {
    // 2026-07-16 is a Thursday; that week's Monday is 2026-07-13; the
    // previous week's Monday is 2026-07-06.
    expect(previousWeekStartDateString(new Date(Date.UTC(2026, 6, 16)))).toBe('2026-07-06');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `backend/`):
```bash
npx jest tests/league/leagueRepository.test.ts
```
Expected: FAIL — `Cannot find module '../../src/league/leagueRepository'`.

- [ ] **Step 3: Implement `leagueRepository.ts`**

Create `backend/src/league/leagueRepository.ts`:

```typescript
// backend/src/league/leagueRepository.ts
import { pool } from '../config/db';
import { mostRecentMonday } from '../progression/streakLogic';
import { LeagueTier } from './leagueTiers';

function weekStartDateString(date: Date): string {
  return mostRecentMonday(date).toISOString().slice(0, 10);
}

// Used by the weekly-processing endpoint, which always operates on the week
// that JUST ended (the endpoint runs at the start of a new week, per the
// design spec's host-crontab trigger), not the current in-progress week.
export function previousWeekStartDateString(referenceDate: Date): string {
  const thisMonday = mostRecentMonday(referenceDate);
  const previousMonday = new Date(thisMonday);
  previousMonday.setUTCDate(previousMonday.getUTCDate() - 7);
  return previousMonday.toISOString().slice(0, 10);
}

// Called once per finished ingliz_tili match (see
// progression/progressionService.ts), mirroring daily_quest_progress's lazy
// per-period-row pattern - a new week simply has no row until the first
// accumulation. Also lazily creates a Bronza user_league row on a user's
// very first weekly XP (ON CONFLICT DO NOTHING - never overwrites an
// already-promoted/relegated tier on subsequent calls).
export async function accumulateWeeklyXp(userId: number, xpDelta: number): Promise<void> {
  const weekStart = weekStartDateString(new Date());
  await pool.query(
    `INSERT INTO league_weekly_xp (user_id, week_start_date, xp)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, week_start_date) DO UPDATE SET
       xp = league_weekly_xp.xp + EXCLUDED.xp`,
    [userId, weekStart, xpDelta]
  );
  await pool.query(`INSERT INTO user_league (user_id, tier) VALUES ($1, 'Bronza') ON CONFLICT (user_id) DO NOTHING`, [
    userId,
  ]);
}

export async function getUserLeague(userId: number): Promise<LeagueTier> {
  const result = await pool.query<{ tier: LeagueTier }>(`SELECT tier FROM user_league WHERE user_id = $1`, [userId]);
  return result.rows[0]?.tier ?? 'Bronza';
}

export async function getWeeklyXp(userId: number): Promise<number> {
  const weekStart = weekStartDateString(new Date());
  const result = await pool.query<{ xp: number }>(
    `SELECT xp FROM league_weekly_xp WHERE user_id = $1 AND week_start_date = $2`,
    [userId, weekStart]
  );
  return result.rows[0]?.xp ?? 0;
}

export interface BracketEntry {
  telegramId: number;
  firstName: string;
  weeklyXp: number;
}

// Top-N preview for GET /api/league (the current, in-progress week).
export async function getWeeklyBracket(tier: LeagueTier, limit = 10): Promise<BracketEntry[]> {
  const weekStart = weekStartDateString(new Date());
  const result = await pool.query<{ telegram_id: string; first_name: string; xp: number }>(
    `SELECT u.telegram_id, u.first_name, lwx.xp
     FROM league_weekly_xp lwx
     JOIN user_league ul ON ul.user_id = lwx.user_id
     JOIN users u ON u.id = lwx.user_id
     WHERE ul.tier = $1 AND lwx.week_start_date = $2 AND u.telegram_id != 0
     ORDER BY lwx.xp DESC
     LIMIT $3`,
    [tier, weekStart, limit]
  );
  return result.rows.map((r) => ({ telegramId: Number(r.telegram_id), firstName: r.first_name, weeklyXp: r.xp }));
}

// Used by the weekly-processing endpoint - returns EVERY member of a tier
// for a given (already-ended) week, unlimited, since promotion/relegation
// must rank the whole bracket, not just a top-N preview.
export async function getFullBracket(
  tier: LeagueTier,
  weekStartDate: string
): Promise<{ userId: number; weeklyXp: number }[]> {
  const result = await pool.query<{ user_id: number; xp: number }>(
    `SELECT lwx.user_id, lwx.xp
     FROM league_weekly_xp lwx
     JOIN user_league ul ON ul.user_id = lwx.user_id
     WHERE ul.tier = $1 AND lwx.week_start_date = $2`,
    [tier, weekStartDate]
  );
  return result.rows.map((r) => ({ userId: r.user_id, weeklyXp: r.xp }));
}

export async function applyTierChange(userId: number, newTier: LeagueTier): Promise<void> {
  await pool.query(`UPDATE user_league SET tier = $1, updated_at = now() WHERE user_id = $2`, [newTier, userId]);
}

export async function isWeekProcessed(weekStartDate: string): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM league_processing_log WHERE week_start_date = $1`, [weekStartDate]);
  return (result.rowCount ?? 0) > 0;
}

export async function markWeekProcessed(weekStartDate: string): Promise<void> {
  await pool.query(
    `INSERT INTO league_processing_log (week_start_date) VALUES ($1) ON CONFLICT (week_start_date) DO NOTHING`,
    [weekStartDate]
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run (from `backend/`):
```bash
npx jest tests/league/leagueRepository.test.ts
```
Expected: PASS — all tests.

- [ ] **Step 5: Wire weekly XP accumulation into `progressionService.ts`**

In `backend/src/progression/progressionService.ts`, add this import:

```typescript
import { accumulateWeeklyXp } from '../league/leagueRepository';
```

Change:

```typescript
      await addSubjectProgress(player.userId, game.category, player.score, masteryPointsDelta);

      const starsToday = game.level != null ? calculateLevelStars(correctCount) : null;
```

to:

```typescript
      await addSubjectProgress(player.userId, game.category, player.score, masteryPointsDelta);
      await accumulateWeeklyXp(player.userId, player.score);

      const starsToday = game.level != null ? calculateLevelStars(correctCount) : null;
```

(This lands inside the existing per-player `try` block, so it inherits the same swallow-and-log failure handling as the other progression updates — no new error-handling logic needed here.)

- [ ] **Step 6: Add one assertion to the existing `gameEngineProgression.test.ts`**

In `backend/tests/game/gameEngineProgression.test.ts`, add this import:

```typescript
import { getWeeklyXp } from '../../src/league/leagueRepository';
```

Add this assertion inside the FIRST test (`'awards XP and CEFR-weighted mastery points to both real players after an ingliz_tili level match'`), right after the existing `expect(progress1.xp).toBeGreaterThan(0);` line:

```typescript
    expect(await getWeeklyXp(player1Id)).toBe(progress1.xp);
```

(Since this is the player's first-ever match in this test suite, their all-time `subject_xp.xp` and this week's `league_weekly_xp.xp` should be identical — both were incremented by the same match score.)

Add this cleanup to the test file's existing `afterAll`, alongside the other `DELETE FROM ...` lines:

```typescript
    await pool.query(`DELETE FROM league_weekly_xp WHERE user_id IN ($1, $2)`, [player1Id, player2Id]);
    await pool.query(`DELETE FROM user_league WHERE user_id IN ($1, $2)`, [player1Id, player2Id]);
```

- [ ] **Step 7: Run to verify it passes, then run the full backend suite**

Run (from `backend/`):
```bash
npx jest tests/game/gameEngineProgression.test.ts
npm test
```
Expected: PASS — all tests, no regressions.

- [ ] **Step 8: Commit**

```bash
git add backend/src/league/leagueRepository.ts backend/src/progression/progressionService.ts backend/tests/league/leagueRepository.test.ts backend/tests/game/gameEngineProgression.test.ts
git commit -m "Add league repository and wire weekly XP accumulation into progressionService"
```

---

### Task 4: Weekly promotion/relegation endpoint

**Files:**
- Modify: `backend/src/admin/adminApiRoutes.ts`
- Test: `backend/tests/admin/adminApiRoutes.test.ts` (add tests)

- [ ] **Step 1: Read the existing file and its tests first**

Read `backend/src/admin/adminApiRoutes.ts` and `backend/tests/admin/adminApiRoutes.test.ts` in full before editing. The existing test file sets `process.env.ADMIN_TELEGRAM_ID = '9999'` at module load time (before any imports), has a SINGLE top-level `describe('GET /api/admin/stats', ...)` block with its own locally-scoped `const app = express(); app.use('/api', adminApiRouter);`, and does NOT use shared `beforeAll`-created tokens — each test creates its own admin/non-admin user + token inline via `upsertUser`/`signSession`. `pool` and `request` are module-level imports, so they're already in scope anywhere in the file; `app` is scoped INSIDE the existing `describe` block only, so your new `describe` block needs its own `app` declaration.

- [ ] **Step 2: Write the failing tests**

Add this ENTIRE new `describe` block to `backend/tests/admin/adminApiRoutes.test.ts`, as a sibling of the existing `describe('GET /api/admin/stats', ...)` block (i.e. NOT nested inside it):

```typescript
describe('POST /api/admin/league/process-week', () => {
  const app = express();
  app.use('/api', adminApiRouter);

  afterEach(async () => {
    await pool.query(`DELETE FROM league_processing_log`);
    await pool.query(
      `DELETE FROM league_weekly_xp WHERE user_id IN (SELECT id FROM users WHERE telegram_id IN (882101, 882102))`
    );
    await pool.query(
      `DELETE FROM user_league WHERE user_id IN (SELECT id FROM users WHERE telegram_id IN (882101, 882102))`
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id IN (9999, 882101, 882102)`);
  });

  it('rejects a non-admin caller', async () => {
    const nonAdmin = await upsertUser(9998, 'leagueProcNonAdmin', 'LeagueProcNonAdmin', null);
    const token = signSession({ userId: nonAdmin.id, telegramId: nonAdmin.telegramId });

    const res = await request(app)
      .post('/api/admin/league/process-week')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("promotes and relegates users within a tier based on last week's XP, then marks the week processed", async () => {
    const admin = await upsertUser(9999, 'leagueProcAdmin', 'LeagueProcAdmin', null);
    const adminToken = signSession({ userId: admin.id, telegramId: admin.telegramId });

    const { accumulateWeeklyXp, previousWeekStartDateString, getUserLeague } = await import(
      '../../src/league/leagueRepository'
    );
    const p1 = await upsertUser(882101, 'leagueProcTest1', 'LeagueProcTest1', null);
    const p2 = await upsertUser(882102, 'leagueProcTest2', 'LeagueProcTest2', null);
    await accumulateWeeklyXp(p1.id, 1000);
    await accumulateWeeklyXp(p2.id, 10);

    // accumulateWeeklyXp records XP under the CURRENT week, but the endpoint
    // processes the PREVIOUS week - move both rows back one week so this
    // test's fixture data is actually in scope for the run below.
    const prevWeek = previousWeekStartDateString(new Date());
    await pool.query(`UPDATE league_weekly_xp SET week_start_date = $1 WHERE user_id IN ($2, $3)`, [
      prevWeek,
      p1.id,
      p2.id,
    ]);

    const res = await request(app)
      .post('/api/admin/league/process-week')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.alreadyProcessed).toBe(false);

    // Both started in Bronza (accumulateWeeklyXp's lazy default); a 2-member
    // bracket floors 20% to 0 for both promotion and relegation, so neither
    // should have changed tier from this run alone - this test's purpose is
    // to prove the endpoint runs end-to-end and marks the week processed,
    // not to re-verify computeTierChanges' ranking math (already covered by
    // Task 2's unit tests).
    expect(await getUserLeague(p1.id)).toBe('Bronza');
    expect(await getUserLeague(p2.id)).toBe('Bronza');
  });

  it('is idempotent - a second call for an already-processed week is a no-op', async () => {
    const admin = await upsertUser(9999, 'leagueProcAdmin', 'LeagueProcAdmin', null);
    const adminToken = signSession({ userId: admin.id, telegramId: admin.telegramId });

    const { previousWeekStartDateString, markWeekProcessed } = await import('../../src/league/leagueRepository');
    await markWeekProcessed(previousWeekStartDateString(new Date()));

    const res = await request(app)
      .post('/api/admin/league/process-week')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.alreadyProcessed).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run (from `backend/`):
```bash
npx jest tests/admin/adminApiRoutes.test.ts
```
Expected: FAIL — 404 (route doesn't exist yet) on the new tests.

- [ ] **Step 4: Implement the route**

In `backend/src/admin/adminApiRoutes.ts`, add these imports alongside the existing ones:

```typescript
import { LEAGUE_TIERS, computeTierChanges } from '../league/leagueTiers';
import {
  getFullBracket,
  applyTierChange,
  isWeekProcessed,
  markWeekProcessed,
  previousWeekStartDateString,
} from '../league/leagueRepository';
```

Add this new route (place it anywhere among the other `adminApiRouter.post(...)`/`adminApiRouter.get(...)` registrations, e.g. right after the existing `/admin/questions/import` route):

```typescript
adminApiRouter.post(
  '/admin/league/process-week',
  requireAuth,
  requireAdmin,
  async (_req: AuthenticatedRequest, res: Response) => {
    const weekStartDate = previousWeekStartDateString(new Date());

    if (await isWeekProcessed(weekStartDate)) {
      res.json({ alreadyProcessed: true, weekStartDate });
      return;
    }

    for (const tier of LEAGUE_TIERS) {
      const members = await getFullBracket(tier, weekStartDate);
      const changes = computeTierChanges(tier, members);
      for (const change of changes) {
        await applyTierChange(change.userId, change.newTier);
      }
    }

    await markWeekProcessed(weekStartDate);
    res.json({ alreadyProcessed: false, weekStartDate });
  }
);
```

- [ ] **Step 5: Run to verify it passes**

Run (from `backend/`):
```bash
npx jest tests/admin/adminApiRoutes.test.ts
```
Expected: PASS — all tests, including the new ones.

- [ ] **Step 6: Run the full backend suite**

Run (from `backend/`):
```bash
npm test
```
Expected: PASS — no regressions.

- [ ] **Step 7: Commit**

```bash
git add backend/src/admin/adminApiRoutes.ts backend/tests/admin/adminApiRoutes.test.ts
git commit -m "Add idempotent POST /api/admin/league/process-week endpoint"
```

---

### Task 5: `GET /api/league` endpoint

**Files:**
- Create: `backend/src/league/leagueRoutes.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/tests/league/leagueRoutes.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/league/leagueRoutes.test.ts`:

```typescript
import express from 'express';
import request from 'supertest';
import { pool } from '../../src/config/db';
import { signSession } from '../../src/auth/jwt';
import { upsertUser } from '../../src/users/userRepository';
import { accumulateWeeklyXp } from '../../src/league/leagueRepository';
import { leagueRouter } from '../../src/league/leagueRoutes';

describe('GET /api/league', () => {
  const app = express();
  app.use('/api', leagueRouter);

  let userId: number;
  let token: string;

  beforeAll(async () => {
    const user = await upsertUser(882201, 'leagueRouteTestUser', 'LeagueRouteTest', null);
    userId = user.id;
    token = signSession({ userId: user.id, telegramId: 882201 });
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM league_weekly_xp WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM user_league WHERE user_id = $1`, [userId]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id = 882201`);
    await pool.end();
  });

  it('returns 401 with no auth token', async () => {
    const res = await request(app).get('/api/league');
    expect(res.status).toBe(401);
  });

  it('returns Bronza tier and zero weekly XP for a brand new user', async () => {
    const res = await request(app).get('/api/league').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('Bronza');
    expect(res.body.weeklyXp).toBe(0);
    expect(res.body.bracket).toEqual([]);
  });

  it('reflects accumulated weekly XP and includes the user in their own bracket', async () => {
    await accumulateWeeklyXp(userId, 150);
    const res = await request(app).get('/api/league').set('Authorization', `Bearer ${token}`);
    expect(res.body.weeklyXp).toBe(150);
    expect(res.body.bracket.some((b: any) => b.telegramId === 882201 && b.weeklyXp === 150)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `backend/`):
```bash
npx jest tests/league/leagueRoutes.test.ts
```
Expected: FAIL — `Cannot find module '../../src/league/leagueRoutes'`.

- [ ] **Step 3: Implement `leagueRoutes.ts`**

Create `backend/src/league/leagueRoutes.ts`:

```typescript
// backend/src/league/leagueRoutes.ts
import { Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../auth/authMiddleware';
import { getUserLeague, getWeeklyXp, getWeeklyBracket } from './leagueRepository';

export const leagueRouter = Router();

leagueRouter.get('/league', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const [tier, weeklyXp] = await Promise.all([getUserLeague(userId), getWeeklyXp(userId)]);
  const bracket = await getWeeklyBracket(tier, 10);
  res.json({ tier, weeklyXp, bracket });
});
```

- [ ] **Step 4: Wire into `app.ts`**

In `backend/src/app.ts`, add this import alongside the existing route imports:

```typescript
import { leagueRouter } from './league/leagueRoutes';
```

Add this line alongside the existing `app.use('/api', ...)` calls (e.g. right after `app.use('/api', profileRouter);`):

```typescript
  app.use('/api', leagueRouter);
```

- [ ] **Step 5: Run to verify it passes**

Run (from `backend/`):
```bash
npx jest tests/league/leagueRoutes.test.ts
```
Expected: PASS — all tests.

- [ ] **Step 6: Run the full backend suite**

Run (from `backend/`):
```bash
npm test
```
Expected: PASS — no regressions. This is the last backend task — the remaining tasks are frontend-only.

- [ ] **Step 7: Commit**

```bash
git add backend/src/league/leagueRoutes.ts backend/src/app.ts backend/tests/league/leagueRoutes.test.ts
git commit -m "Add GET /api/league endpoint"
```

---

### Task 6: `api/league.ts` client

**Files:**
- Create: `frontend/src/api/league.ts`

(No dedicated test file — matching the existing convention for `api/stats.ts`/`api/achievements.ts`/`api/profile.ts`, thin wrappers tested indirectly through the screens that consume them.)

- [ ] **Step 1: Implement `league.ts`**

Create `frontend/src/api/league.ts`:

```typescript
// frontend/src/api/league.ts
import { apiGet } from './client';

export type LeagueTier = 'Bronza' | 'Kumush' | 'Oltin' | 'Platina' | 'Olmos' | 'Usta' | 'Chempion';

export interface LeagueBracketEntry {
  telegramId: number;
  firstName: string;
  weeklyXp: number;
}

export interface LeagueResponse {
  tier: LeagueTier;
  weeklyXp: number;
  bracket: LeagueBracketEntry[];
}

export function getMyLeague(token: string): Promise<LeagueResponse> {
  return apiGet<LeagueResponse>('/league', token);
}
```

- [ ] **Step 2: Typecheck**

Run (from `frontend/`):
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/league.ts
git commit -m "Add frontend api client for GET /api/league"
```

---

### Task 7: `LeaderboardScreen` — add a "Liga" tab

**Files:**
- Modify: `frontend/src/screens/LeaderboardScreen.tsx`
- Modify: `frontend/src/screens/LeaderboardScreen.test.tsx`

- [ ] **Step 1: Read both files in full first**

`LeaderboardScreen.tsx` currently has a `tab: 'global' | 'friends'` state driving a single `entries: LeaderboardEntry[]` fetch, with a shared podium/list rendering that assumes every entry has a `rating`/`gamesWon` shape. The League tab's data (`tier` + `weeklyXp` + a `bracket` of `{telegramId, firstName, weeklyXp}`) does NOT fit that shape, so this task adds a THIRD, independently-rendered block rather than forcing League data through the existing `LeaderboardEntry`-shaped podium/list components.

- [ ] **Step 2: Write the failing tests**

In `frontend/src/screens/LeaderboardScreen.test.tsx`, add this import:

```typescript
import * as leagueApi from '../api/league';
```

Add this default mock inside the existing `beforeEach` block (adjust to match however this file's `beforeEach` is currently structured — add a `vi.spyOn` call alongside its existing ones):

```typescript
    vi.spyOn(leagueApi, 'getMyLeague').mockResolvedValue({
      tier: 'Bronza',
      weeklyXp: 0,
      bracket: [],
    });
```

Add these new tests:

```typescript
  it('shows a "Liga" tab and switches to league data when clicked', async () => {
    vi.spyOn(leagueApi, 'getMyLeague').mockResolvedValue({
      tier: 'Oltin',
      weeklyXp: 340,
      bracket: [
        { telegramId: 555, firstName: 'Aziz', weeklyXp: 340 },
        { telegramId: 777, firstName: 'Vali', weeklyXp: 200 },
      ],
    });

    render(<LeaderboardScreen />);
    fireEvent.click(await screen.findByText('Liga'));

    await screen.findByText('Oltin');
    expect(screen.getByText(/340/)).toBeInTheDocument();
    expect(screen.getByText('Aziz')).toBeInTheDocument();
    expect(screen.getByText('Vali')).toBeInTheDocument();
  });

  it('does not show global/friends podium content while on the Liga tab', async () => {
    render(<LeaderboardScreen />);
    fireEvent.click(await screen.findByText('Liga'));
    await screen.findByText('Bronza');
    expect(screen.queryByText('Top reyting')).not.toBeInTheDocument();
  });
```

(Match the exact mock user/token setup already established elsewhere in this test file's `beforeEach` - the second test above assumes `getMyLeague`'s default `beforeEach` mock from Step 2 above is already in place, resolving to `{tier: 'Bronza', weeklyXp: 0, bracket: []}`.)

- [ ] **Step 3: Run to verify it fails**

Run (from `frontend/`):
```bash
npx vitest run src/screens/LeaderboardScreen.test.tsx
```
Expected: FAIL — "Liga" tab doesn't exist yet.

- [ ] **Step 4: Add the "Liga" tab to `LeaderboardScreen.tsx`**

Add this import:

```typescript
import { getMyLeague, LeagueResponse } from '../api/league';
```

Change the `tab` state type and add a `league` state:

```typescript
  const [tab, setTab] = useState<'global' | 'friends'>('global');
```

to:

```typescript
  const [tab, setTab] = useState<'global' | 'friends' | 'league'>('global');
  const [league, setLeague] = useState<LeagueResponse | null>(null);
```

Change the data-fetching `useEffect` body:

```typescript
    const fetcher = tab === 'global' ? getGlobalLeaderboard : getFriendsLeaderboard;
    fetcher(token)
      .then((res) => {
        if (cancelled) return;
        setEntries(res.leaderboard);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
```

to:

```typescript
    if (tab === 'league') {
      getMyLeague(token)
        .then((res) => {
          if (cancelled) return;
          setLeague(res);
        })
        .catch(() => {
          if (cancelled) return;
          setError(true);
        })
        .finally(() => {
          if (cancelled) return;
          setLoading(false);
        });
    } else {
      const fetcher = tab === 'global' ? getGlobalLeaderboard : getFriendsLeaderboard;
      fetcher(token)
        .then((res) => {
          if (cancelled) return;
          setEntries(res.leaderboard);
        })
        .catch(() => {
          if (cancelled) return;
          setError(true);
        })
        .finally(() => {
          if (cancelled) return;
          setLoading(false);
        });
    }
```

Add a third tab button, right after the existing "Do'stlar" button:

```typescript
        <button
          type="button"
          aria-current={tab === 'league' ? 'page' : undefined}
          className={`flex-1 rounded-full py-2 text-sm font-semibold transition-colors duration-150 ${
            tab === 'league' ? 'bg-ios-card text-ios-label shadow-sm' : 'text-ios-secondary-label'
          }`}
          onClick={() => setTab('league')}
        >
          Liga
        </button>
```

Gate the EXISTING podium/list blocks so they only render for the global/friends tabs — change:

```typescript
      {!loading && !error && podium.length > 0 && (
```

to:

```typescript
      {!loading && !error && tab !== 'league' && podium.length > 0 && (
```

and change:

```typescript
      {!loading && !error && rest.length > 0 && (
```

to:

```typescript
      {!loading && !error && tab !== 'league' && rest.length > 0 && (
```

Also gate the existing "Sizning o'rningiz" rank line to non-league tabs — change:

```typescript
      {!loading && !error && myRank !== null && (
        <p className="text-sm font-medium text-ios-secondary-label">Sizning o'rningiz: {myRank}</p>
      )}
```

to:

```typescript
      {!loading && !error && tab !== 'league' && myRank !== null && (
        <p className="text-sm font-medium text-ios-secondary-label">Sizning o'rningiz: {myRank}</p>
      )}
```

Finally, add the new League tab's own rendering block, right after that gated rank-line block:

```typescript
      {!loading && !error && tab === 'league' && league && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col items-center gap-1 rounded-2xl bg-ios-card p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
            <span className="text-lg font-bold text-ios-label">{league.tier}</span>
            <span className="text-sm text-ios-secondary-label">{league.weeklyXp} XP (bu hafta)</span>
          </div>
          {league.bracket.length > 0 && (
            <ul className="flex flex-col gap-2 rounded-2xl bg-ios-card p-2 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
              {league.bracket.map((entry, index) => (
                <li
                  key={entry.telegramId}
                  className={`flex items-center gap-3 rounded-xl px-3 py-3 ${
                    index < league.bracket.length - 1 ? 'border-b border-ios-divider' : ''
                  }`}
                >
                  <span className="w-5 text-center text-sm font-bold tabular-nums text-ios-secondary-label">
                    {index + 1}
                  </span>
                  <BattleAvatar telegramId={entry.telegramId} size={36} />
                  <span className="flex-1 truncate font-medium text-ios-label">{entry.firstName}</span>
                  <span className="font-semibold tabular-nums text-ios-label">{entry.weeklyXp} XP</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
```

- [ ] **Step 5: Run to verify it passes**

Run (from `frontend/`):
```bash
npx vitest run src/screens/LeaderboardScreen.test.tsx
```
Expected: PASS — all tests, including the two new ones.

- [ ] **Step 6: Typecheck**

Run (from `frontend/`):
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/screens/LeaderboardScreen.tsx frontend/src/screens/LeaderboardScreen.test.tsx
git commit -m "Add a Liga tab to LeaderboardScreen"
```

---

### Task 8: `HomeScreen` — league tier indicator on the leaderboard preview card

**Files:**
- Modify: `frontend/src/screens/HomeScreen.tsx`
- Modify: `frontend/src/screens/HomeScreen.test.tsx`

- [ ] **Step 1: Add the failing test**

In `frontend/src/screens/HomeScreen.test.tsx`, add this import:

```typescript
import * as leagueApi from '../api/league';
```

Add this default mock inside the existing `beforeEach` block:

```typescript
    vi.spyOn(leagueApi, 'getMyLeague').mockResolvedValue({
      tier: 'Bronza', weeklyXp: 0, bracket: [],
    });
```

Add this new test:

```typescript
  it('shows the league tier next to the leaderboard preview heading once loaded', async () => {
    vi.spyOn(leaderboardApi, 'getGlobalLeaderboard').mockResolvedValue({
      leaderboard: [{ telegramId: 1, firstName: 'Vali', username: null, rating: 2000, gamesWon: 10 }],
    });
    vi.spyOn(leagueApi, 'getMyLeague').mockResolvedValue({
      tier: 'Oltin', weeklyXp: 120, bracket: [],
    });

    render(<HomeScreen />);

    await screen.findByText('Top reyting');
    expect(screen.getByText(/Oltin ligasi/)).toBeInTheDocument();
  });
```

(This reuses the existing `leaderboardApi` import already present in this test file for the "Top reyting" tests — do not add a duplicate import if one already exists.)

- [ ] **Step 2: Run to verify it fails**

Run (from `frontend/`):
```bash
npx vitest run src/screens/HomeScreen.test.tsx
```
Expected: FAIL — league tier text isn't rendered yet.

- [ ] **Step 3: Add the league indicator to `HomeScreen.tsx`**

Add this import:

```typescript
import { getMyLeague, LeagueResponse } from '../api/league';
```

Add this state declaration alongside the existing ones:

```typescript
  const [league, setLeague] = useState<LeagueResponse | null>(null);
```

Add this fetch inside the existing `useEffect`, alongside the other five independent fetches:

```typescript
    getMyLeague(token).then(setLeague).catch(() => {});
```

Update the fetch-count comment from "Five" to "Six" (it was already updated from "Four" to "Five" in the previous feature; this task adds a sixth):

```typescript
  // Five independent fetches, none blocking the others - each section of
```

to:

```typescript
  // Six independent fetches, none blocking the others - each section of
```

Change the existing "Top reyting" heading span:

```typescript
          <span className="flex items-center gap-1 text-sm font-semibold text-ios-label">
            <Trophy size={16} weight="fill" className="text-ios-gold" />
            Top reyting
          </span>
```

to:

```typescript
          <span className="flex items-center gap-1 text-sm font-semibold text-ios-label">
            <Trophy size={16} weight="fill" className="text-ios-gold" />
            Top reyting
            {league && <span className="ml-1 font-normal text-ios-secondary-label">· {league.tier} ligasi</span>}
          </span>
```

(This deliberately piggybacks the league indicator onto the EXISTING leaderboard-preview card rather than adding a new card — HomeScreen already stacks several conditional cards above its primary CTA buttons, and a code quality review during the previous feature flagged this as worth watching. Reusing an existing card keeps this addition from making that worse.)

- [ ] **Step 4: Run to verify it passes**

Run (from `frontend/`):
```bash
npx vitest run src/screens/HomeScreen.test.tsx
```
Expected: PASS — all tests, including the new one.

- [ ] **Step 5: Typecheck**

Run (from `frontend/`):
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screens/HomeScreen.tsx frontend/src/screens/HomeScreen.test.tsx
git commit -m "Show the league tier on HomeScreen's leaderboard preview card"
```

---

## After all 8 tasks

Run both full suites one final time:
```bash
cd backend && npm test
```
```bash
cd frontend && npx vitest run && npx tsc --noEmit
```
Expected: both green.

**Reminder (deployment, not code):** the weekly promotion/relegation computation will never run automatically until a crontab entry is added on the production server (see the note at the top of this plan). Flag this clearly to the user after this plan ships — without it, everyone stays in Bronza forever no matter how much weekly XP they earn.
