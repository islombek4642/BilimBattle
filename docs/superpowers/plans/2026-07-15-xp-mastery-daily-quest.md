# XP, Mastery, Daily Quest va Kunlik Streak Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an English-only (`ingliz_tili`) XP + Mastery Rank system, three Daily Quests, and a daily-activity streak (distinct from the existing win-streak), plus a new dedicated `ProfileScreen` that showcases them — all without any new background-job infrastructure (lazy, on-read reset).

**Architecture:** A new `backend/src/progression/` module owns all new logic (mastery tiers, XP/mastery-points repository, daily quest catalog + progress repository, streak pure-logic + DB wiring, and the orchestrator that hooks into `gameEngine.ts`'s existing `finishGame`/`forfeitIfStillDisconnected` right after the existing achievement-awarding call — same pattern, same call site). A single new `GET /api/profile` endpoint aggregates everything for the frontend. On the frontend, a new `ProfileScreen` (reachable from a new "Mening profilim" entry point in `SettingsScreen`, which loses its old profile card) shows Mastery/XP/Streak/a short achievements preview; `HomeScreen` gets a Daily Quest card + daily-streak indicator; `LevelSelectScreen` gets a Mastery badge.

**Tech Stack:** Backend: Node/TypeScript/Express/PostgreSQL (raw `pg`, no ORM)/Redis, Jest against a real local Postgres+Redis. Frontend: Vite/React/TypeScript/Tailwind v4, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-15-xp-mastery-daily-quest-design.md`

---

### Task 1: Database schema — subject_xp, daily_quest_progress, users streak columns

**Files:**
- Modify: `backend/src/db/schema.sql`

- [ ] **Step 1: Add the new tables and columns**

Insert the following block into `backend/src/db/schema.sql` immediately after the existing `user_achievements` table definition (i.e. right before the `CREATE INDEX IF NOT EXISTS idx_questions_category_id` line):

```sql
-- One row per (user, category) - only 'ingliz_tili' is populated in this
-- first version (see the design spec's Scope section). xp only ever grows
-- (both a win and a loss add points); mastery_points only grows from
-- correct answers, weighted by the question's CEFR difficulty tier.
CREATE TABLE IF NOT EXISTS subject_xp (
  user_id INTEGER NOT NULL REFERENCES users(id),
  category TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  mastery_points INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, category)
);

-- One row per (user, calendar day). Keying by quest_date instead of storing
-- a single mutable "today" row per user is what makes Daily Quest reset
-- "lazy" (see the design spec) - a new calendar day simply has no row yet,
-- so every counter naturally reads back as zero via getTodayProgress's
-- COALESCE-to-zero, with no explicit reset step required anywhere.
CREATE TABLE IF NOT EXISTS daily_quest_progress (
  user_id INTEGER NOT NULL REFERENCES users(id),
  quest_date DATE NOT NULL,
  matches_played INTEGER NOT NULL DEFAULT 0,
  correct_answers INTEGER NOT NULL DEFAULT 0,
  best_stars_today SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, quest_date)
);
```

Then add these four `ALTER TABLE` statements directly below the block above (same file, same pattern as the existing `cefr_level`/`extra_definitions` `ALTER TABLE ADD COLUMN IF NOT EXISTS` statements elsewhere in this file — `migrate.ts` re-runs this whole file on every deploy, and `CREATE TABLE IF NOT EXISTS` never picks up new columns on an already-existing table on its own):

```sql
-- Daily-activity streak (distinct from users.current_streak, which counts
-- consecutive match WINS, not consecutive days with any activity). Nullable
-- date columns since a brand new user has never been active nor spent a
-- freeze yet.
ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS best_daily_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_freeze_used_at DATE;
```

- [ ] **Step 2: Apply the migration to your local dev database**

Run (from `backend/`):
```bash
npm run migrate
```
Expected: exits with no errors, logs the same "migration complete"-style output it already prints for existing tables.

- [ ] **Step 3: Verify the new tables/columns exist**

Run (adjust connection details to your local `.env`):
```bash
psql "$DATABASE_URL" -c "\d subject_xp" -c "\d daily_quest_progress" -c "\d users" | grep -E "subject_xp|daily_quest_progress|daily_streak|best_daily_streak|last_active_date|streak_freeze_used_at"
```
Expected: both new tables listed, and the four new `users` columns present.

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/schema.sql
git commit -m "Add subject_xp, daily_quest_progress tables and daily-streak columns on users"
```

---

### Task 2: Expose `cefrLevel` on `QuestionRecord`

**Files:**
- Modify: `backend/src/questions/questionRepository.ts`
- Test: `backend/tests/questions/questionRepository.test.ts`

- [ ] **Step 1: Write the failing tests**

Add this new `describe` block to `backend/tests/questions/questionRepository.test.ts`, placed as a sibling of the existing `describe('getLevelTierBoundaries', ...)` block (anywhere inside the outer `describe('questionRepository', ...)`):

```typescript
  describe('cefrLevel on QuestionRecord', () => {
    const FIXTURE_CATEGORY = 'test_repo_cefr_field_xyz';

    afterEach(async () => {
      await pool.query(`DELETE FROM questions WHERE category = $1`, [FIXTURE_CATEGORY]);
    });

    it('exposes cefr_level as cefrLevel on the returned QuestionRecord', async () => {
      await pool.query(
        `INSERT INTO questions (category, question_text, options, correct_index, cefr_level)
         VALUES ($1, $2, $3, $4, $5)`,
        [FIXTURE_CATEGORY, 'CEFR_FIELD_TEST_Q', JSON.stringify(['a', 'b']), 0, 'B1']
      );

      const questions = await getRandomQuestions(FIXTURE_CATEGORY, 1);
      expect(questions[0].cefrLevel).toBe('B1');
    });

    it('omits cefrLevel entirely for a row with no cefr_level set', async () => {
      await pool.query(
        `INSERT INTO questions (category, question_text, options, correct_index)
         VALUES ($1, $2, $3, $4)`,
        [FIXTURE_CATEGORY, 'CEFR_FIELD_TEST_Q_NULL', JSON.stringify(['a', 'b']), 0]
      );

      const questions = await getRandomQuestions(FIXTURE_CATEGORY, 1);
      expect(questions[0].cefrLevel).toBeUndefined();
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `backend/`):
```bash
npx jest tests/questions/questionRepository.test.ts -t "cefrLevel on QuestionRecord"
```
Expected: FAIL — `questions[0].cefrLevel` is `undefined` in the first test (should be `'B1'`).

- [ ] **Step 3: Add `cefrLevel` to `QuestionRecord`, `QuestionRow`, and `toQuestionRecord`**

In `backend/src/questions/questionRepository.ts`, change:

```typescript
export interface QuestionRecord {
  id: number;
  text: string;
  options: string[];
  correctIndex: number;
  extraDefinitions?: string[];
}
```

to:

```typescript
export interface QuestionRecord {
  id: number;
  text: string;
  options: string[];
  correctIndex: number;
  extraDefinitions?: string[];
  cefrLevel?: string;
}
```

Change:

```typescript
interface QuestionRow {
  id: number;
  question_text: string;
  options: string[];
  correct_index: number;
  extra_definitions: string[] | null;
}
```

to:

```typescript
interface QuestionRow {
  id: number;
  question_text: string;
  options: string[];
  correct_index: number;
  extra_definitions: string[] | null;
  cefr_level: string | null;
}
```

Change:

```typescript
function toQuestionRecord(row: QuestionRow): QuestionRecord {
  return {
    id: row.id,
    text: row.question_text,
    options: row.options,
    correctIndex: row.correct_index,
    ...(row.extra_definitions && row.extra_definitions.length > 0 ? { extraDefinitions: row.extra_definitions } : {}),
  };
}
```

to:

```typescript
function toQuestionRecord(row: QuestionRow): QuestionRecord {
  return {
    id: row.id,
    text: row.question_text,
    options: row.options,
    correctIndex: row.correct_index,
    ...(row.extra_definitions && row.extra_definitions.length > 0 ? { extraDefinitions: row.extra_definitions } : {}),
    ...(row.cefr_level ? { cefrLevel: row.cefr_level } : {}),
  };
}
```

- [ ] **Step 4: Add `cefr_level` to the three SQL `SELECT`s**

In the same file, change all three occurrences of the column list `id, question_text, options, correct_index, extra_definitions` (there are three: the forward query and wrap-around query inside `getRandomQuestions`, and the query inside `getQuestionsForLevel`) to `id, question_text, options, correct_index, extra_definitions, cefr_level`.

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `backend/`):
```bash
npx jest tests/questions/questionRepository.test.ts
```
Expected: PASS — all tests in this file, including the two new ones.

- [ ] **Step 6: Commit**

```bash
git add backend/src/questions/questionRepository.ts backend/tests/questions/questionRepository.test.ts
git commit -m "Expose cefr_level as cefrLevel on QuestionRecord"
```

---

### Task 3: Pure progression logic — Mastery tiers and streak computation

**Files:**
- Create: `backend/src/progression/masteryTiers.ts`
- Create: `backend/src/progression/streakLogic.ts`
- Test: `backend/tests/progression/masteryTiers.test.ts`
- Test: `backend/tests/progression/streakLogic.test.ts`

- [ ] **Step 1: Write the failing tests for `masteryTiers.ts`**

Create `backend/tests/progression/masteryTiers.test.ts`:

```typescript
import { cefrWeight, masteryRankForPoints } from '../../src/progression/masteryTiers';

describe('cefrWeight', () => {
  it('maps each CEFR tier to its increasing weight', () => {
    expect(cefrWeight('A1')).toBe(1);
    expect(cefrWeight('A2')).toBe(2);
    expect(cefrWeight('B1')).toBe(3);
    expect(cefrWeight('B2')).toBe(4);
    expect(cefrWeight('C1')).toBe(5);
    expect(cefrWeight('C2')).toBe(6);
  });

  it('defaults to the easiest weight for a missing or unknown tag', () => {
    expect(cefrWeight(null)).toBe(1);
    expect(cefrWeight(undefined)).toBe(1);
    expect(cefrWeight('unknown')).toBe(1);
  });
});

describe('masteryRankForPoints', () => {
  it('returns Boshlangich below the Orta threshold', () => {
    expect(masteryRankForPoints(0)).toBe('Boshlangich');
    expect(masteryRankForPoints(149)).toBe('Boshlangich');
  });

  it('returns each tier at its exact lower boundary', () => {
    expect(masteryRankForPoints(150)).toBe('Orta');
    expect(masteryRankForPoints(450)).toBe('Yuqori');
    expect(masteryRankForPoints(1200)).toBe('Usta');
    expect(masteryRankForPoints(3000)).toBe('Professor');
  });

  it('returns Professor for very high point totals', () => {
    expect(masteryRankForPoints(999999)).toBe('Professor');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `backend/`):
```bash
npx jest tests/progression/masteryTiers.test.ts
```
Expected: FAIL — `Cannot find module '../../src/progression/masteryTiers'`.

- [ ] **Step 3: Implement `masteryTiers.ts`**

Create `backend/src/progression/masteryTiers.ts`:

```typescript
// backend/src/progression/masteryTiers.ts
export type MasteryRank = 'Boshlangich' | 'Orta' | 'Yuqori' | 'Usta' | 'Professor';

const CEFR_WEIGHTS: Record<string, number> = {
  A1: 1,
  A2: 2,
  B1: 3,
  B2: 4,
  C1: 5,
  C2: 6,
};

// Unknown/missing CEFR tags default to the easiest weight rather than
// throwing - defensive against any row that might lack a tag (see
// questionRepository.ts's cefr_level column, which is nullable).
export function cefrWeight(cefrLevel: string | null | undefined): number {
  if (!cefrLevel) return 1;
  return CEFR_WEIGHTS[cefrLevel] ?? 1;
}

interface MasteryTierBoundary {
  rank: MasteryRank;
  minPoints: number;
}

// Checked from highest to lowest so the first match wins. Thresholds are a
// deliberate design choice (see the design spec) tuned so ~30 days of
// regular play reaches Orta, ~90 days reaches Yuqori/Usta, and ~1 year
// reaches Professor - not derived from real play data yet.
const MASTERY_TIERS: MasteryTierBoundary[] = [
  { rank: 'Professor', minPoints: 3000 },
  { rank: 'Usta', minPoints: 1200 },
  { rank: 'Yuqori', minPoints: 450 },
  { rank: 'Orta', minPoints: 150 },
  { rank: 'Boshlangich', minPoints: 0 },
];

export function masteryRankForPoints(masteryPoints: number): MasteryRank {
  const tier = MASTERY_TIERS.find((t) => masteryPoints >= t.minPoints);
  return tier?.rank ?? 'Boshlangich';
}
```

- [ ] **Step 4: Run to verify it passes**

Run (from `backend/`):
```bash
npx jest tests/progression/masteryTiers.test.ts
```
Expected: PASS — all tests.

- [ ] **Step 5: Write the failing tests for `streakLogic.ts`**

Create `backend/tests/progression/streakLogic.test.ts`:

```typescript
import { computeStreakUpdate, mostRecentMonday } from '../../src/progression/streakLogic';

const DAY = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe('computeStreakUpdate', () => {
  it('starts a fresh streak at 1 for a user with no prior activity', () => {
    const result = computeStreakUpdate(DAY(2026, 7, 15), {
      dailyStreak: 0,
      bestDailyStreak: 0,
      lastActiveDate: null,
      streakFreezeUsedAt: null,
    });
    expect(result.dailyStreak).toBe(1);
    expect(result.bestDailyStreak).toBe(1);
    expect(result.alreadyRecordedToday).toBe(false);
  });

  it('does not double-count a second activity on the same day', () => {
    const result = computeStreakUpdate(DAY(2026, 7, 15), {
      dailyStreak: 4,
      bestDailyStreak: 4,
      lastActiveDate: DAY(2026, 7, 15),
      streakFreezeUsedAt: null,
    });
    expect(result.dailyStreak).toBe(4);
    expect(result.alreadyRecordedToday).toBe(true);
  });

  it('increments the streak when activity continues on the very next day', () => {
    const result = computeStreakUpdate(DAY(2026, 7, 15), {
      dailyStreak: 4,
      bestDailyStreak: 4,
      lastActiveDate: DAY(2026, 7, 14),
      streakFreezeUsedAt: null,
    });
    expect(result.dailyStreak).toBe(5);
    expect(result.bestDailyStreak).toBe(5);
  });

  it('resets the streak to 1 after a gap with no freeze available', () => {
    const result = computeStreakUpdate(DAY(2026, 7, 15), {
      dailyStreak: 10,
      bestDailyStreak: 10,
      lastActiveDate: DAY(2026, 7, 10),
      streakFreezeUsedAt: null,
    });
    expect(result.dailyStreak).toBe(1);
    expect(result.bestDailyStreak).toBe(10);
  });

  it('preserves the streak across a single missed day by spending the weekly freeze', () => {
    // 2026-07-13 is a Monday, 2026-07-15 is the following Wednesday - exactly
    // one day (Tuesday) was missed.
    const result = computeStreakUpdate(DAY(2026, 7, 15), {
      dailyStreak: 6,
      bestDailyStreak: 6,
      lastActiveDate: DAY(2026, 7, 13),
      streakFreezeUsedAt: null,
    });
    expect(result.dailyStreak).toBe(7);
    expect(result.streakFreezeUsedAt).toEqual(DAY(2026, 7, 15));
  });

  it('does not apply a second freeze within the same week', () => {
    const result = computeStreakUpdate(DAY(2026, 7, 16), {
      dailyStreak: 7,
      bestDailyStreak: 7,
      lastActiveDate: DAY(2026, 7, 14),
      streakFreezeUsedAt: DAY(2026, 7, 15),
    });
    expect(result.dailyStreak).toBe(1);
  });
});

describe('mostRecentMonday', () => {
  it('returns the same date when given a Monday', () => {
    expect(mostRecentMonday(DAY(2026, 7, 13))).toEqual(DAY(2026, 7, 13));
  });

  it('returns the preceding Monday for a Sunday', () => {
    expect(mostRecentMonday(DAY(2026, 7, 19))).toEqual(DAY(2026, 7, 13));
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run (from `backend/`):
```bash
npx jest tests/progression/streakLogic.test.ts
```
Expected: FAIL — `Cannot find module '../../src/progression/streakLogic'`.

- [ ] **Step 7: Implement `streakLogic.ts`**

Create `backend/src/progression/streakLogic.ts`:

```typescript
// backend/src/progression/streakLogic.ts

// All date arithmetic here operates on UTC calendar dates (not the user's
// local time zone) - a documented simplification (see the design spec) that
// avoids needing per-user timezone data for a first version of daily streaks.
function toUtcDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysBetween(a: Date, b: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((toUtcDateOnly(a).getTime() - toUtcDateOnly(b).getTime()) / MS_PER_DAY);
}

// Monday-start week boundary, matching the wider product's weekly cadence
// (Daily Quest/League design docs both reset weekly) - used only to decide
// whether a streak-freeze was already spent "this week".
export function mostRecentMonday(date: Date): Date {
  const d = toUtcDateOnly(date);
  const day = d.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
  const diffToMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  return d;
}

export interface StreakState {
  dailyStreak: number;
  bestDailyStreak: number;
  lastActiveDate: Date | null;
  streakFreezeUsedAt: Date | null;
}

export interface StreakUpdateResult extends StreakState {
  alreadyRecordedToday: boolean;
}

// Pure function - no DB access - so it's fully unit-testable without
// Postgres. The caller (users/userRepository.ts's recordDailyActivity) is
// responsible for reading the current state and persisting the result.
export function computeStreakUpdate(today: Date, current: StreakState): StreakUpdateResult {
  if (current.lastActiveDate && daysBetween(today, current.lastActiveDate) === 0) {
    // Already recorded activity today (e.g. a second match same day) -
    // streak must not be incremented twice for one day.
    return { ...current, alreadyRecordedToday: true };
  }

  const gap = current.lastActiveDate ? daysBetween(today, current.lastActiveDate) : null;

  if (gap === 1) {
    const newStreak = current.dailyStreak + 1;
    return {
      dailyStreak: newStreak,
      bestDailyStreak: Math.max(current.bestDailyStreak, newStreak),
      lastActiveDate: today,
      streakFreezeUsedAt: current.streakFreezeUsedAt,
      alreadyRecordedToday: false,
    };
  }

  const freezeAvailable =
    !current.streakFreezeUsedAt || daysBetween(mostRecentMonday(today), current.streakFreezeUsedAt) > 0;
  if (gap === 2 && freezeAvailable) {
    const newStreak = current.dailyStreak + 1;
    return {
      dailyStreak: newStreak,
      bestDailyStreak: Math.max(current.bestDailyStreak, newStreak),
      lastActiveDate: today,
      streakFreezeUsedAt: today,
      alreadyRecordedToday: false,
    };
  }

  // No prior activity, or too large a gap with no freeze available - streak
  // restarts at 1 (today's own activity).
  return {
    dailyStreak: 1,
    bestDailyStreak: Math.max(current.bestDailyStreak, 1),
    lastActiveDate: today,
    streakFreezeUsedAt: current.streakFreezeUsedAt,
    alreadyRecordedToday: false,
  };
}
```

- [ ] **Step 8: Run to verify it passes**

Run (from `backend/`):
```bash
npx jest tests/progression/streakLogic.test.ts
```
Expected: PASS — all tests.

- [ ] **Step 9: Commit**

```bash
git add backend/src/progression/masteryTiers.ts backend/src/progression/streakLogic.ts backend/tests/progression/masteryTiers.test.ts backend/tests/progression/streakLogic.test.ts
git commit -m "Add pure Mastery-tier and daily-streak computation logic"
```

---

### Task 4: XP/Mastery-points and Daily Quest data repositories

**Files:**
- Create: `backend/src/progression/xpRepository.ts`
- Create: `backend/src/progression/dailyQuests.ts`
- Create: `backend/src/progression/dailyProgressRepository.ts`
- Test: `backend/tests/progression/xpRepository.test.ts`
- Test: `backend/tests/progression/dailyProgressRepository.test.ts`

- [ ] **Step 1: Write the failing tests for `xpRepository.ts`**

Create `backend/tests/progression/xpRepository.test.ts`:

```typescript
import { pool } from '../../src/config/db';
import { upsertUser } from '../../src/users/userRepository';
import { getSubjectProgress, addSubjectProgress } from '../../src/progression/xpRepository';

describe('xpRepository', () => {
  let userId: number;

  beforeAll(async () => {
    const user = await upsertUser(881201, 'xpRepoTestUser', 'XpRepoTest', null);
    userId = user.id;
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM subject_xp WHERE user_id = $1`, [userId]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id = 881201`);
    await pool.end();
  });

  it('returns zero xp and mastery points for a category with no rows yet', async () => {
    const progress = await getSubjectProgress(userId, 'ingliz_tili');
    expect(progress).toEqual({ xp: 0, masteryPoints: 0 });
  });

  it('creates a row on first add and accumulates on subsequent adds', async () => {
    await addSubjectProgress(userId, 'ingliz_tili', 120, 4);
    await addSubjectProgress(userId, 'ingliz_tili', 80, 2);
    const progress = await getSubjectProgress(userId, 'ingliz_tili');
    expect(progress).toEqual({ xp: 200, masteryPoints: 6 });
  });

  it('keeps separate categories independent', async () => {
    await addSubjectProgress(userId, 'ingliz_tili', 100, 3);
    await addSubjectProgress(userId, 'umumiy_bilim', 999, 999);
    const ingliz = await getSubjectProgress(userId, 'ingliz_tili');
    expect(ingliz).toEqual({ xp: 100, masteryPoints: 3 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `backend/`):
```bash
npx jest tests/progression/xpRepository.test.ts
```
Expected: FAIL — `Cannot find module '../../src/progression/xpRepository'`.

- [ ] **Step 3: Implement `xpRepository.ts`**

Create `backend/src/progression/xpRepository.ts`:

```typescript
// backend/src/progression/xpRepository.ts
import { pool } from '../config/db';

export interface SubjectProgress {
  xp: number;
  masteryPoints: number;
}

export async function getSubjectProgress(userId: number, category: string): Promise<SubjectProgress> {
  const result = await pool.query<{ xp: number; mastery_points: number }>(
    `SELECT xp, mastery_points FROM subject_xp WHERE user_id = $1 AND category = $2`,
    [userId, category]
  );
  const row = result.rows[0];
  return { xp: row?.xp ?? 0, masteryPoints: row?.mastery_points ?? 0 };
}

// Both deltas only ever accumulate - a match's XP is added regardless of
// win/loss, and mastery points only grow from correct answers (see
// progressionService.ts) - so this never needs to subtract.
export async function addSubjectProgress(
  userId: number,
  category: string,
  xpDelta: number,
  masteryPointsDelta: number
): Promise<void> {
  await pool.query(
    `INSERT INTO subject_xp (user_id, category, xp, mastery_points)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, category) DO UPDATE SET
       xp = subject_xp.xp + EXCLUDED.xp,
       mastery_points = subject_xp.mastery_points + EXCLUDED.mastery_points`,
    [userId, category, xpDelta, masteryPointsDelta]
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run (from `backend/`):
```bash
npx jest tests/progression/xpRepository.test.ts
```
Expected: PASS — all tests.

- [ ] **Step 5: Write the failing tests for `dailyProgressRepository.ts`**

Create `backend/src/progression/dailyQuests.ts` first (the catalog `dailyProgressRepository`'s tests don't need it directly, but `profileRoutes.ts` in Task 7 does — creating it now keeps this task self-contained):

```typescript
// backend/src/progression/dailyQuests.ts

export type DailyQuestMetric = 'matchesPlayed' | 'correctAnswers' | 'bestStarsToday';

export interface DailyQuestDefinition {
  key: string;
  label: string;
  target: number;
  metric: DailyQuestMetric;
}

// Static catalog, same pattern as achievements.ts's ACHIEVEMENTS - fixed,
// versioned with the code. Scoped to ingliz_tili activity only (see the
// design spec) since XP/Mastery tracking itself is English-only in this
// first version.
export const DAILY_QUESTS: DailyQuestDefinition[] = [
  { key: 'matches_3', label: "Bugun 3 ta jang o'ynang", target: 3, metric: 'matchesPlayed' },
  { key: 'correct_10', label: "10 ta savolga to'g'ri javob bering", target: 10, metric: 'correctAnswers' },
  { key: 'stars_2', label: 'Kamida bitta darajada 2+ yulduz oling', target: 2, metric: 'bestStarsToday' },
];
```

Create `backend/tests/progression/dailyProgressRepository.test.ts`:

```typescript
import { pool } from '../../src/config/db';
import { upsertUser } from '../../src/users/userRepository';
import { getTodayProgress, recordDailyMatch, todayDateString } from '../../src/progression/dailyProgressRepository';

describe('dailyProgressRepository', () => {
  let userId: number;

  beforeAll(async () => {
    const user = await upsertUser(881202, 'dailyProgressTestUser', 'DailyProgressTest', null);
    userId = user.id;
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM daily_quest_progress WHERE user_id = $1`, [userId]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id = 881202`);
    await pool.end();
  });

  it('returns all-zero progress before any match is recorded today', async () => {
    const progress = await getTodayProgress(userId);
    expect(progress).toEqual({ matchesPlayed: 0, correctAnswers: 0, bestStarsToday: 0 });
  });

  it('accumulates matches and correct answers across several quick matches', async () => {
    await recordDailyMatch(userId, 8, null);
    await recordDailyMatch(userId, 5, null);
    const progress = await getTodayProgress(userId);
    expect(progress).toEqual({ matchesPlayed: 2, correctAnswers: 13, bestStarsToday: 0 });
  });

  it('tracks the best stars across several level-mode matches, not the latest', async () => {
    await recordDailyMatch(userId, 14, 3);
    await recordDailyMatch(userId, 8, 1);
    const progress = await getTodayProgress(userId);
    expect(progress.bestStarsToday).toBe(3);
  });

  it("stores the row under today's UTC date", async () => {
    await recordDailyMatch(userId, 1, null);
    const result = await pool.query(`SELECT quest_date FROM daily_quest_progress WHERE user_id = $1`, [userId]);
    expect(result.rows[0].quest_date.toISOString().slice(0, 10)).toBe(todayDateString());
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run (from `backend/`):
```bash
npx jest tests/progression/dailyProgressRepository.test.ts
```
Expected: FAIL — `Cannot find module '../../src/progression/dailyProgressRepository'`.

- [ ] **Step 7: Implement `dailyProgressRepository.ts`**

Create `backend/src/progression/dailyProgressRepository.ts`:

```typescript
// backend/src/progression/dailyProgressRepository.ts
import { pool } from '../config/db';

export interface DailyProgress {
  matchesPlayed: number;
  correctAnswers: number;
  bestStarsToday: number;
}

// UTC calendar date, matching streakLogic.ts's date handling - a documented
// simplification, not the user's local time zone.
export function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getTodayProgress(userId: number): Promise<DailyProgress> {
  const result = await pool.query<{ matches_played: number; correct_answers: number; best_stars_today: number }>(
    `SELECT matches_played, correct_answers, best_stars_today
     FROM daily_quest_progress WHERE user_id = $1 AND quest_date = $2`,
    [userId, todayDateString()]
  );
  const row = result.rows[0];
  return {
    matchesPlayed: row?.matches_played ?? 0,
    correctAnswers: row?.correct_answers ?? 0,
    bestStarsToday: row?.best_stars_today ?? 0,
  };
}

// Called once per finished match (see progressionService.ts). `starsToday`
// is null for non-level (quick-match) games, since stars only exist in
// level mode - GREATEST() below then simply leaves today's existing best
// unchanged. Keyed by (user_id, quest_date), so a brand new calendar day
// naturally starts every counter at zero via INSERT rather than needing an
// explicit reset step - this is the "lazy reset" the design spec describes.
export async function recordDailyMatch(userId: number, correctAnswers: number, starsToday: number | null): Promise<void> {
  await pool.query(
    `INSERT INTO daily_quest_progress (user_id, quest_date, matches_played, correct_answers, best_stars_today)
     VALUES ($1, $2, 1, $3, $4)
     ON CONFLICT (user_id, quest_date) DO UPDATE SET
       matches_played = daily_quest_progress.matches_played + 1,
       correct_answers = daily_quest_progress.correct_answers + EXCLUDED.correct_answers,
       best_stars_today = GREATEST(daily_quest_progress.best_stars_today, EXCLUDED.best_stars_today)`,
    [userId, todayDateString(), correctAnswers, starsToday ?? 0]
  );
}
```

- [ ] **Step 8: Run to verify it passes**

Run (from `backend/`):
```bash
npx jest tests/progression/dailyProgressRepository.test.ts
```
Expected: PASS — all tests.

- [ ] **Step 9: Commit**

```bash
git add backend/src/progression/xpRepository.ts backend/src/progression/dailyQuests.ts backend/src/progression/dailyProgressRepository.ts backend/tests/progression/xpRepository.test.ts backend/tests/progression/dailyProgressRepository.test.ts
git commit -m "Add XP/Mastery-points and Daily Quest data repositories"
```

---

### Task 5: Daily-activity streak fields and `recordDailyActivity` on `userRepository`

**Files:**
- Modify: `backend/src/users/userRepository.ts`
- Test: `backend/tests/users/dailyActivity.test.ts` (new file)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/users/dailyActivity.test.ts`:

```typescript
import { pool } from '../../src/config/db';
import { upsertUser, getUserById, recordDailyActivity } from '../../src/users/userRepository';

describe('recordDailyActivity', () => {
  let userId: number;

  beforeAll(async () => {
    const user = await upsertUser(881203, 'dailyActivityTestUser', 'DailyActivityTest', null);
    userId = user.id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id = 881203`);
    await pool.end();
  });

  it('starts a new streak at 1 for a user with no prior activity', async () => {
    const result = await recordDailyActivity(userId);
    expect(result.dailyStreak).toBe(1);
    expect(result.bestDailyStreak).toBe(1);
    const user = await getUserById(userId);
    expect(user?.dailyStreak).toBe(1);
    expect(user?.lastActiveDate).not.toBeNull();
  });

  it('does not increment the streak again for a second activity the same day', async () => {
    const before = await recordDailyActivity(userId);
    const after = await recordDailyActivity(userId);
    expect(after.dailyStreak).toBe(before.dailyStreak);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `backend/`):
```bash
npx jest tests/users/dailyActivity.test.ts
```
Expected: FAIL — `recordDailyActivity` is not exported from `userRepository`.

- [ ] **Step 3: Extend `User`/`UserRow`/`mapRow` and add `recordDailyActivity`**

In `backend/src/users/userRepository.ts`, change:

```typescript
export interface User {
  id: number;
  telegramId: number;
  username: string | null;
  firstName: string;
  invitedByTelegramId: number | null;
  rating: number;
  gamesPlayed: number;
  gamesWon: number;
  currentStreak: number;
  bestStreak: number;
}
```

to:

```typescript
export interface User {
  id: number;
  telegramId: number;
  username: string | null;
  firstName: string;
  invitedByTelegramId: number | null;
  rating: number;
  gamesPlayed: number;
  gamesWon: number;
  currentStreak: number;
  bestStreak: number;
  dailyStreak: number;
  bestDailyStreak: number;
  lastActiveDate: string | null;
  streakFreezeUsedAt: string | null;
}
```

Change:

```typescript
interface UserRow {
  id: number;
  telegram_id: string;
  username: string | null;
  first_name: string;
  invited_by_telegram_id: string | null;
  rating: number;
  games_played: number;
  games_won: number;
  current_streak: number;
  best_streak: number;
}
```

to:

```typescript
interface UserRow {
  id: number;
  telegram_id: string;
  username: string | null;
  first_name: string;
  invited_by_telegram_id: string | null;
  rating: number;
  games_played: number;
  games_won: number;
  current_streak: number;
  best_streak: number;
  daily_streak: number;
  best_daily_streak: number;
  last_active_date: string | null;
  streak_freeze_used_at: string | null;
}
```

Change:

```typescript
function mapRow(row: UserRow): User {
  return {
    id: row.id,
    telegramId: Number(row.telegram_id),
    username: row.username,
    firstName: row.first_name,
    invitedByTelegramId: row.invited_by_telegram_id ? Number(row.invited_by_telegram_id) : null,
    rating: row.rating,
    gamesPlayed: row.games_played,
    gamesWon: row.games_won,
    currentStreak: row.current_streak,
    bestStreak: row.best_streak,
  };
}
```

to:

```typescript
function mapRow(row: UserRow): User {
  return {
    id: row.id,
    telegramId: Number(row.telegram_id),
    username: row.username,
    firstName: row.first_name,
    invitedByTelegramId: row.invited_by_telegram_id ? Number(row.invited_by_telegram_id) : null,
    rating: row.rating,
    gamesPlayed: row.games_played,
    gamesWon: row.games_won,
    currentStreak: row.current_streak,
    bestStreak: row.best_streak,
    dailyStreak: row.daily_streak,
    bestDailyStreak: row.best_daily_streak,
    lastActiveDate: row.last_active_date,
    streakFreezeUsedAt: row.streak_freeze_used_at,
  };
}
```

Add this import at the top of the file (alongside the existing `import { pool } from '../config/db';`):

```typescript
import { computeStreakUpdate } from '../progression/streakLogic';
```

Add this new function at the end of the file:

```typescript
// Called once per finished match for each real (non-bot) player (see
// progression/progressionService.ts). Idempotent within a single day: a
// second call the same UTC day is a no-op write (computeStreakUpdate's
// alreadyRecordedToday short-circuits before any UPDATE).
export async function recordDailyActivity(userId: number): Promise<{ dailyStreak: number; bestDailyStreak: number }> {
  const user = await getUserById(userId);
  if (!user) throw new Error(`recordDailyActivity: no such user ${userId}`);

  const today = new Date();
  const result = computeStreakUpdate(today, {
    dailyStreak: user.dailyStreak,
    bestDailyStreak: user.bestDailyStreak,
    lastActiveDate: user.lastActiveDate ? new Date(user.lastActiveDate) : null,
    streakFreezeUsedAt: user.streakFreezeUsedAt ? new Date(user.streakFreezeUsedAt) : null,
  });

  if (result.alreadyRecordedToday) {
    return { dailyStreak: result.dailyStreak, bestDailyStreak: result.bestDailyStreak };
  }

  await pool.query(
    `UPDATE users SET daily_streak = $1, best_daily_streak = $2, last_active_date = $3, streak_freeze_used_at = $4 WHERE id = $5`,
    [
      result.dailyStreak,
      result.bestDailyStreak,
      result.lastActiveDate?.toISOString().slice(0, 10) ?? null,
      result.streakFreezeUsedAt?.toISOString().slice(0, 10) ?? null,
      userId,
    ]
  );

  return { dailyStreak: result.dailyStreak, bestDailyStreak: result.bestDailyStreak };
}
```

- [ ] **Step 4: Run to verify it passes**

Run (from `backend/`):
```bash
npx jest tests/users/dailyActivity.test.ts
```
Expected: PASS — both tests.

- [ ] **Step 5: Run the full backend suite to check for regressions**

Run (from `backend/`):
```bash
npm test
```
Expected: PASS — all existing tests still pass (the new `User`/`UserRow` fields are additive; nothing existing reads or writes them).

- [ ] **Step 6: Commit**

```bash
git add backend/src/users/userRepository.ts backend/tests/users/dailyActivity.test.ts
git commit -m "Add daily-activity streak fields and recordDailyActivity to userRepository"
```

---

### Task 6: Progression orchestrator — wire XP/Mastery/Daily Quest/Streak into `gameEngine.ts`

**Files:**
- Create: `backend/src/progression/progressionService.ts`
- Modify: `backend/src/game/gameEngine.ts`
- Test: `backend/tests/game/gameEngineProgression.test.ts` (new file)

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/game/gameEngineProgression.test.ts`:

```typescript
import { pool } from '../../src/config/db';
import { closeRedis } from '../../src/config/redis';
import { setIOForTesting } from '../../src/socket/socketServer';
import { startGame, submitAnswer } from '../../src/game/gameEngine';
import { upsertUser } from '../../src/users/userRepository';
import { randomUUID } from 'crypto';
import * as questionRepository from '../../src/questions/questionRepository';
import { getSubjectProgress } from '../../src/progression/xpRepository';
import { getTodayProgress } from '../../src/progression/dailyProgressRepository';

function createFakeIO() {
  const sockets = new Map<string, { id: string; data: Record<string, unknown>; emit: () => void }>();
  const fakeIO = {
    sockets: {
      sockets: {
        get(id: string) {
          if (!sockets.has(id)) {
            sockets.set(id, { id, data: {}, emit() {} });
          }
          return sockets.get(id);
        },
      },
    },
    to() {
      return { emit() {} };
    },
  };
  return { fakeIO };
}

describe('gameEngine progression integration', () => {
  let player1Id: number;
  let player2Id: number;

  beforeAll(async () => {
    const p1 = await upsertUser(7101, 'progressionP1', 'ProgressionP1', null);
    const p2 = await upsertUser(7102, 'progressionP2', 'ProgressionP2', null);
    player1Id = p1.id;
    player2Id = p2.id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM subject_xp WHERE user_id IN ($1, $2)`, [player1Id, player2Id]);
    await pool.query(`DELETE FROM daily_quest_progress WHERE user_id IN ($1, $2)`, [player1Id, player2Id]);
    await pool.query(`DELETE FROM level_progress WHERE user_id IN ($1, $2)`, [player1Id, player2Id]);
    await pool.query(`DELETE FROM matches WHERE player1_id IN ($1, $2) OR player2_id IN ($1, $2)`, [player1Id, player2Id]);
    await pool.query(`DELETE FROM users WHERE telegram_id IN (7101, 7102)`);
    await pool.end();
    await closeRedis();
  });

  it('awards XP and CEFR-weighted mastery points to both real players after an ingliz_tili level match', async () => {
    const gameId = randomUUID();
    const { fakeIO } = createFakeIO();
    setIOForTesting(fakeIO as any);

    // Mixed CEFR tiers so the mastery-points assertion below actually
    // exercises the weighting, not just a flat per-question count.
    const fixtureQuestions = [
      { id: 910100, text: 'Q0', options: ['a', 'b'], correctIndex: 0, cefrLevel: 'A1' },
      { id: 910101, text: 'Q1', options: ['a', 'b'], correctIndex: 0, cefrLevel: 'C2' },
    ];
    const getQuestionsForLevelSpy = jest
      .spyOn(questionRepository, 'getQuestionsForLevel')
      .mockResolvedValueOnce(fixtureQuestions as any);

    await startGame(gameId, 'ingliz_tili', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' }, undefined, 77);

    // player1 answers both correctly (A1 weight 1 + C2 weight 6 = 7 mastery points).
    await submitAnswer(gameId, player1Id, 0, 0);
    await submitAnswer(gameId, player2Id, 1, 0);
    await submitAnswer(gameId, player1Id, 0, 1);
    await submitAnswer(gameId, player2Id, 1, 1);

    const progress1 = await getSubjectProgress(player1Id, 'ingliz_tili');
    expect(progress1.masteryPoints).toBe(7);
    expect(progress1.xp).toBeGreaterThan(0);

    const progress2 = await getSubjectProgress(player2Id, 'ingliz_tili');
    expect(progress2.masteryPoints).toBe(0); // answered every question wrong

    getQuestionsForLevelSpy.mockRestore();
  });

  it("counts the match toward today's Daily Quest progress for the real player", async () => {
    const gameId = randomUUID();
    const { fakeIO } = createFakeIO();
    setIOForTesting(fakeIO as any);

    const fixtureQuestions = Array.from({ length: 15 }, (_, i) => ({
      id: 910200 + i,
      text: `DAILY_Q${i}`,
      options: ['a', 'b'],
      correctIndex: 0,
      cefrLevel: 'A1',
    }));
    const getQuestionsForLevelSpy = jest
      .spyOn(questionRepository, 'getQuestionsForLevel')
      .mockResolvedValueOnce(fixtureQuestions as any);

    await startGame(gameId, 'ingliz_tili', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' }, undefined, 78);

    for (let round = 0; round < 15; round += 1) {
      await submitAnswer(gameId, player1Id, 0, round); // always correct -> 3 stars
      await submitAnswer(gameId, player2Id, 1, round); // always wrong
    }

    const daily1 = await getTodayProgress(player1Id);
    expect(daily1.matchesPlayed).toBeGreaterThanOrEqual(1);
    expect(daily1.bestStarsToday).toBe(3);

    getQuestionsForLevelSpy.mockRestore();
  });

  it('does not create a subject_xp row for a bot opponent', async () => {
    const gameId = randomUUID();
    const { fakeIO } = createFakeIO();
    setIOForTesting(fakeIO as any);

    const fixtureQuestions = [{ id: 910300, text: 'Q0', options: ['a', 'b'], correctIndex: 0, cefrLevel: 'A1' }];
    const getQuestionsForLevelSpy = jest
      .spyOn(questionRepository, 'getQuestionsForLevel')
      .mockResolvedValueOnce(fixtureQuestions as any);

    await startGame(
      gameId,
      'ingliz_tili',
      { userId: player1Id, socketId: 'sock1' },
      { userId: player2Id, socketId: 'sock2', isBot: true },
      undefined,
      79
    );

    await submitAnswer(gameId, player1Id, 0, 0);
    await submitAnswer(gameId, player2Id, 1, 0);

    const botProgress = await getSubjectProgress(player2Id, 'ingliz_tili');
    expect(botProgress).toEqual({ xp: 0, masteryPoints: 0 });

    getQuestionsForLevelSpy.mockRestore();
  });

  it('does not track progression for non-English categories', async () => {
    const gameId = randomUUID();
    const { fakeIO } = createFakeIO();
    setIOForTesting(fakeIO as any);

    const fixtureQuestions = [{ id: 910400, text: 'Q0', options: ['a', 'b'], correctIndex: 0 }];
    const getRandomQuestionsSpy = jest
      .spyOn(questionRepository, 'getRandomQuestions')
      .mockResolvedValueOnce(fixtureQuestions as any);

    await startGame(gameId, 'umumiy_bilim', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' });

    await submitAnswer(gameId, player1Id, 0, 0);
    await submitAnswer(gameId, player2Id, 1, 0);

    const progress = await getSubjectProgress(player1Id, 'umumiy_bilim');
    expect(progress).toEqual({ xp: 0, masteryPoints: 0 });

    getRandomQuestionsSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `backend/`):
```bash
npx jest tests/game/gameEngineProgression.test.ts
```
Expected: FAIL — every assertion on `subject_xp`/`daily_quest_progress` fails (nothing writes to them yet).

- [ ] **Step 3: Implement `progressionService.ts`**

Create `backend/src/progression/progressionService.ts`:

```typescript
// backend/src/progression/progressionService.ts
import { GameState } from '../game/gameState';
import { cefrWeight } from './masteryTiers';
import { addSubjectProgress } from './xpRepository';
import { recordDailyMatch } from './dailyProgressRepository';
import { recordDailyActivity } from '../users/userRepository';
import { calculateLevelStars } from '../game/levelProgress';

const TRACKED_CATEGORY = 'ingliz_tili';

// Called once per finished match (see gameEngine.ts's finishGame and
// forfeitIfStillDisconnected, right after their existing
// awardMatchAchievementsForRealPlayers call). Scoped to ingliz_tili only
// (see the design spec) - other categories are a future expansion, not a
// missing feature here. Bots are skipped first thing, same guard as
// awardMatchAchievementsForRealPlayers.
export async function updateProgressionForRealPlayers(game: GameState): Promise<void> {
  if (game.category !== TRACKED_CATEGORY) return;

  for (const player of game.players) {
    if (player.isBot) continue;

    const correctCount = player.answers.filter((a) => a && a.points > 0).length;
    const masteryPointsDelta = game.questions.reduce((sum, question, index) => {
      const answer = player.answers[index];
      if (!answer || answer.points <= 0) return sum;
      return sum + cefrWeight(question.cefrLevel);
    }, 0);

    await addSubjectProgress(player.userId, game.category, player.score, masteryPointsDelta);

    const starsToday = game.level != null ? calculateLevelStars(correctCount) : null;
    await recordDailyMatch(player.userId, correctCount, starsToday);

    await recordDailyActivity(player.userId);
  }
}
```

- [ ] **Step 4: Wire it into `gameEngine.ts`**

In `backend/src/game/gameEngine.ts`, add this import alongside the existing achievement import:

```typescript
import { checkAndAwardMatchAchievements, checkAndAwardLevelAchievements } from '../achievements/achievements';
import { updateProgressionForRealPlayers } from '../progression/progressionService';
```

In `finishGame`, change:

```typescript
  await awardMatchAchievementsForRealPlayers(game.players);

  const timer = activeTimers.get(gameId);
```

to:

```typescript
  await awardMatchAchievementsForRealPlayers(game.players);
  await updateProgressionForRealPlayers(game);

  const timer = activeTimers.get(gameId);
```

In `forfeitIfStillDisconnected`, change:

```typescript
  await awardMatchAchievementsForRealPlayers(game.players);

  clearSocketGameId(game.players);
```

to:

```typescript
  await awardMatchAchievementsForRealPlayers(game.players);
  await updateProgressionForRealPlayers(game);

  clearSocketGameId(game.players);
```

- [ ] **Step 5: Run to verify it passes**

Run (from `backend/`):
```bash
npx jest tests/game/gameEngineProgression.test.ts
```
Expected: PASS — all four tests.

- [ ] **Step 6: Run the full backend suite to check for regressions**

Run (from `backend/`):
```bash
npm test
```
Expected: PASS — all existing tests (including `gameEngine.test.ts` and `gameEngineDisconnect.test.ts`) still pass; the new call is purely additive at the same hook points the achievement call already uses.

- [ ] **Step 7: Commit**

```bash
git add backend/src/progression/progressionService.ts backend/src/game/gameEngine.ts backend/tests/game/gameEngineProgression.test.ts
git commit -m "Wire XP, Mastery, Daily Quest and streak updates into gameEngine's finishGame/forfeit paths"
```

---

### Task 7: `GET /api/profile` endpoint

**Files:**
- Create: `backend/src/progression/profileRoutes.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/tests/progression/profileRoutes.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/progression/profileRoutes.test.ts`:

```typescript
import express from 'express';
import request from 'supertest';
import { pool } from '../../src/config/db';
import { signSession } from '../../src/auth/jwt';
import { upsertUser } from '../../src/users/userRepository';
import { addSubjectProgress } from '../../src/progression/xpRepository';
import { recordDailyMatch } from '../../src/progression/dailyProgressRepository';
import { profileRouter } from '../../src/progression/profileRoutes';

describe('GET /api/profile', () => {
  const app = express();
  app.use('/api', profileRouter);

  let userId: number;
  let token: string;

  beforeAll(async () => {
    const user = await upsertUser(881301, 'profileRouteTestUser', 'ProfileRouteTest', null);
    userId = user.id;
    token = signSession({ userId: user.id, telegramId: 881301 });
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM subject_xp WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM daily_quest_progress WHERE user_id = $1`, [userId]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id = 881301`);
    await pool.end();
  });

  it('returns 401 with no auth token', async () => {
    const res = await request(app).get('/api/profile');
    expect(res.status).toBe(401);
  });

  it('returns zeroed progress and Boshlangich rank for a brand new user', async () => {
    const res = await request(app).get('/api/profile').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.xp).toBe(0);
    expect(res.body.masteryRank).toBe('Boshlangich');
    expect(res.body.category).toBe('ingliz_tili');
    expect(res.body.dailyQuests.length).toBe(3);
    expect(res.body.dailyQuests.every((q: any) => !q.completed)).toBe(true);
    expect(res.body.streak.freezeAvailable).toBe(true);
  });

  it('reflects accumulated XP, mastery points and a completed daily quest', async () => {
    await addSubjectProgress(userId, 'ingliz_tili', 500, 200);
    await recordDailyMatch(userId, 10, null);
    const res = await request(app).get('/api/profile').set('Authorization', `Bearer ${token}`);
    expect(res.body.xp).toBe(500);
    expect(res.body.masteryRank).toBe('Orta');
    const correctQuest = res.body.dailyQuests.find((q: any) => q.key === 'correct_10');
    expect(correctQuest.completed).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `backend/`):
```bash
npx jest tests/progression/profileRoutes.test.ts
```
Expected: FAIL — `Cannot find module '../../src/progression/profileRoutes'`.

- [ ] **Step 3: Implement `profileRoutes.ts`**

Create `backend/src/progression/profileRoutes.ts`:

```typescript
// backend/src/progression/profileRoutes.ts
import { Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../auth/authMiddleware';
import { getUserById } from '../users/userRepository';
import { getSubjectProgress } from './xpRepository';
import { masteryRankForPoints } from './masteryTiers';
import { DAILY_QUESTS } from './dailyQuests';
import { getTodayProgress } from './dailyProgressRepository';
import { mostRecentMonday } from './streakLogic';

export const profileRouter = Router();

const TRACKED_CATEGORY = 'ingliz_tili';

profileRouter.get('/profile', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = await getUserById(req.userId!);
  if (!user) {
    res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    return;
  }

  const subjectProgress = await getSubjectProgress(user.id, TRACKED_CATEGORY);
  const todayProgress = await getTodayProgress(user.id);
  const dailyQuests = DAILY_QUESTS.map((quest) => {
    const progress = todayProgress[quest.metric];
    return {
      key: quest.key,
      label: quest.label,
      progress,
      target: quest.target,
      completed: progress >= quest.target,
    };
  });

  const freezeAvailable =
    !user.streakFreezeUsedAt || mostRecentMonday(new Date()) > new Date(user.streakFreezeUsedAt);

  res.json({
    xp: subjectProgress.xp,
    masteryPoints: subjectProgress.masteryPoints,
    masteryRank: masteryRankForPoints(subjectProgress.masteryPoints),
    category: TRACKED_CATEGORY,
    dailyQuests,
    streak: {
      current: user.dailyStreak,
      best: user.bestDailyStreak,
      freezeAvailable,
    },
  });
});
```

- [ ] **Step 4: Wire it into `app.ts`**

In `backend/src/app.ts`, add this import alongside the existing route imports:

```typescript
import { achievementsRouter } from './achievements/achievementsRoutes';
import { profileRouter } from './progression/profileRoutes';
```

And add this line alongside the existing `app.use('/api', ...)` calls:

```typescript
  app.use('/api', achievementsRouter);
  app.use('/api', profileRouter);
```

- [ ] **Step 5: Run to verify it passes**

Run (from `backend/`):
```bash
npx jest tests/progression/profileRoutes.test.ts
```
Expected: PASS — all tests.

- [ ] **Step 6: Run the full backend suite**

Run (from `backend/`):
```bash
npm test
```
Expected: PASS — all tests, no regressions.

- [ ] **Step 7: Commit**

```bash
git add backend/src/progression/profileRoutes.ts backend/src/app.ts backend/tests/progression/profileRoutes.test.ts
git commit -m "Add GET /api/profile aggregating XP, Mastery, Daily Quests and streak"
```

This is the last backend task — the remaining tasks are frontend-only.

---

### Task 8: `api/profile.ts` client

**Files:**
- Create: `frontend/src/api/profile.ts`

(No dedicated test file — matching the existing convention for `api/stats.ts`/`api/achievements.ts`, which are thin wrappers tested indirectly through the screens that consume them, not standalone.)

- [ ] **Step 1: Implement `profile.ts`**

Create `frontend/src/api/profile.ts`:

```typescript
// frontend/src/api/profile.ts
import { apiGet } from './client';

export type MasteryRank = 'Boshlangich' | 'Orta' | 'Yuqori' | 'Usta' | 'Professor';

export interface DailyQuestStatus {
  key: string;
  label: string;
  progress: number;
  target: number;
  completed: boolean;
}

export interface ProfileResponse {
  xp: number;
  masteryPoints: number;
  masteryRank: MasteryRank;
  category: string;
  dailyQuests: DailyQuestStatus[];
  streak: { current: number; best: number; freezeAvailable: boolean };
}

export function getProfile(token: string): Promise<ProfileResponse> {
  return apiGet<ProfileResponse>('/profile', token);
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
git add frontend/src/api/profile.ts
git commit -m "Add frontend api client for GET /api/profile"
```

---

### Task 9: `MasteryBadge` shared component

**Files:**
- Create: `frontend/src/components/MasteryBadge.tsx`
- Test: `frontend/src/components/MasteryBadge.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/MasteryBadge.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MasteryBadge } from './MasteryBadge';

describe('MasteryBadge', () => {
  it('renders the Uzbek label for each mastery rank', () => {
    const { rerender } = render(<MasteryBadge rank="Boshlangich" />);
    expect(screen.getByText("Boshlang'ich")).toBeInTheDocument();

    rerender(<MasteryBadge rank="Professor" />);
    expect(screen.getByText('Professor')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `frontend/`):
```bash
npx vitest run src/components/MasteryBadge.test.tsx
```
Expected: FAIL — cannot find module `./MasteryBadge`.

- [ ] **Step 3: Implement `MasteryBadge.tsx`**

Create `frontend/src/components/MasteryBadge.tsx`:

```typescript
// frontend/src/components/MasteryBadge.tsx
import { MasteryRank } from '../api/profile';

const RANK_LABEL: Record<MasteryRank, string> = {
  Boshlangich: "Boshlang'ich",
  Orta: "O'rta",
  Yuqori: 'Yuqori',
  Usta: 'Usta',
  Professor: 'Professor',
};

// Reuses the app's existing iOS color tokens rather than inventing new ones
// - a deliberate "light intensity" progression from neutral gray up to a
// glowing gold at the top tier (see the design spec's Art Direction
// reference), each tier one step further along the SAME palette the rest of
// the app already uses.
const RANK_CLASSNAME: Record<MasteryRank, string> = {
  Boshlangich: 'bg-ios-bg text-ios-secondary-label',
  Orta: 'bg-ios-blue/10 text-ios-blue',
  Yuqori: 'bg-ios-green/10 text-ios-green',
  Usta: 'bg-ios-purple/10 text-ios-purple',
  Professor: 'bg-ios-gold/10 text-ios-gold shadow-[0_0_12px_rgba(255,192,46,0.5)]',
};

export function MasteryBadge({ rank }: { rank: MasteryRank }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ${RANK_CLASSNAME[rank]}`}>
      {RANK_LABEL[rank]}
    </span>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run (from `frontend/`):
```bash
npx vitest run src/components/MasteryBadge.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MasteryBadge.tsx frontend/src/components/MasteryBadge.test.tsx
git commit -m "Add MasteryBadge component with a light-intensity tier progression"
```

---

### Task 10: `'profile'` screen — navigation wiring and `ProfileScreen`

**Files:**
- Modify: `frontend/src/context/NavigationContext.tsx`
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/screens/ProfileScreen.tsx`
- Test: `frontend/src/screens/ProfileScreen.test.tsx`

- [ ] **Step 1: Add `'profile'` to the `Screen` union**

In `frontend/src/context/NavigationContext.tsx`, change:

```typescript
export type Screen =
  | { name: 'home' }
  | { name: 'levelSelect'; intent: 'quick' | 'invite' }
  | { name: 'waiting'; level: number; intent: 'quick' | 'invite' | 'joining' }
  | { name: 'battle'; gameId: string; level: number }
  | { name: 'result'; scores: ScoreEntry[]; winnerId: number | null; forfeited: boolean; knockout: boolean; level: number; levelStars?: number }
  | { name: 'leaderboard' }
  | { name: 'settings' }
  | { name: 'achievements' }
  | { name: 'admin' };
```

to:

```typescript
export type Screen =
  | { name: 'home' }
  | { name: 'levelSelect'; intent: 'quick' | 'invite' }
  | { name: 'waiting'; level: number; intent: 'quick' | 'invite' | 'joining' }
  | { name: 'battle'; gameId: string; level: number }
  | { name: 'result'; scores: ScoreEntry[]; winnerId: number | null; forfeited: boolean; knockout: boolean; level: number; levelStars?: number }
  | { name: 'leaderboard' }
  | { name: 'settings' }
  | { name: 'achievements' }
  | { name: 'profile' }
  | { name: 'admin' };
```

- [ ] **Step 2: Add the `Router` case in `App.tsx`**

In `frontend/src/App.tsx`, add this import alongside the existing screen imports:

```typescript
import { AchievementsScreen } from './screens/AchievementsScreen';
import { ProfileScreen } from './screens/ProfileScreen';
```

And add this case in the `Router` function's `switch`, alongside the existing `case 'achievements':`:

```typescript
    case 'achievements':
      return <AchievementsScreen />;
    case 'profile':
      return <ProfileScreen />;
```

- [ ] **Step 3: Write the failing `ProfileScreen` tests**

Create `frontend/src/screens/ProfileScreen.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProfileScreen } from './ProfileScreen';
import * as authContext from '../context/AuthContext';
import * as navigationContext from '../context/NavigationContext';
import * as profileApi from '../api/profile';
import * as statsApi from '../api/stats';
import * as achievementsApi from '../api/achievements';

describe('ProfileScreen', () => {
  const navigate = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    navigate.mockClear();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1, telegramId: 555, firstName: 'Aziz' } as any, loading: false, error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'profile' },
      navigate, goBack: vi.fn(), replace: vi.fn(), reset: vi.fn(),
    });
    vi.spyOn(profileApi, 'getProfile').mockResolvedValue({
      xp: 340,
      masteryPoints: 90,
      masteryRank: 'Boshlangich',
      category: 'ingliz_tili',
      dailyQuests: [],
      streak: { current: 4, best: 9, freezeAvailable: true },
    });
    vi.spyOn(statsApi, 'getMyStats').mockResolvedValue({
      gamesPlayed: 12, gamesWon: 7, winRate: 58, currentStreak: 2, bestStreak: 5, rating: 1120,
    });
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({ catalog: [], earned: [] });
  });

  it('renders nothing while the user is not yet loaded', () => {
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: null, user: null, loading: false, error: null,
    });
    const { container } = render(<ProfileScreen />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the user's XP, mastery rank and daily streak once the profile loads", async () => {
    render(<ProfileScreen />);
    await screen.findByText('340');
    expect(screen.getByText("Boshlang'ich")).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it("shows the user's overall stats once loaded", async () => {
    render(<ProfileScreen />);
    await screen.findByText('1120');
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('shows recently earned achievements and navigates to the full list when clicked', async () => {
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [{ key: 'games_1', category: 'games', label: 'Birinchi qadam', description: "1 ta o'yin o'ynang" }],
      earned: [{ key: 'games_1', earnedAt: '2026-07-14T00:00:00.000Z' }],
    });

    render(<ProfileScreen />);
    await screen.findByText('Birinchi qadam');
    fireEvent.click(screen.getByText("Barcha yutuqlarni ko'rish"));
    expect(navigate).toHaveBeenCalledWith({ name: 'achievements' });
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run (from `frontend/`):
```bash
npx vitest run src/screens/ProfileScreen.test.tsx
```
Expected: FAIL — cannot find module `./ProfileScreen`.

- [ ] **Step 5: Implement `ProfileScreen.tsx`**

Create `frontend/src/screens/ProfileScreen.tsx`:

```typescript
// frontend/src/screens/ProfileScreen.tsx
import { useEffect, useState } from 'react';
import { Flame, Trophy } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import { getProfile, ProfileResponse } from '../api/profile';
import { getMyStats } from '../api/stats';
import { getAchievements, Achievement, EarnedAchievement } from '../api/achievements';
import { Stats } from '../api/types';
import { BattleAvatar } from '../components/BattleAvatar';
import { MasteryBadge } from '../components/MasteryBadge';

const RECENT_ACHIEVEMENT_LIMIT = 3;

export function ProfileScreen() {
  const { user, token } = useAuth();
  const { navigate } = useNavigation();
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [catalog, setCatalog] = useState<Achievement[]>([]);
  const [earned, setEarned] = useState<EarnedAchievement[]>([]);

  useEffect(() => {
    if (!token) return;

    getProfile(token).then(setProfile).catch(() => {});
    getMyStats(token).then(setStats).catch(() => {});
    getAchievements(token)
      .then((res) => {
        setCatalog(res.catalog);
        setEarned(res.earned);
      })
      .catch(() => {});
  }, [token]);

  if (!user) return null;

  const catalogByKey = new Map(catalog.map((a) => [a.key, a]));
  const recentEarned = [...earned]
    .sort((a, b) => new Date(b.earnedAt).getTime() - new Date(a.earnedAt).getTime())
    .slice(0, RECENT_ACHIEVEMENT_LIMIT);

  return (
    <div className="flex flex-col gap-5 p-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <h2 className="text-lg font-bold text-ios-label">Mening profilim</h2>

      <div className="flex flex-col items-center gap-3 rounded-2xl bg-ios-card p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
        <BattleAvatar telegramId={user.telegramId} size={72} />
        <div className="text-center">
          <p className="font-bold text-ios-label">{user.firstName}</p>
          {user.username && <p className="text-sm text-ios-secondary-label">@{user.username}</p>}
        </div>
        {profile && <MasteryBadge rank={profile.masteryRank} />}
      </div>

      {profile && (
        <div className="flex items-stretch rounded-2xl bg-ios-card p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
          <div className="flex flex-1 flex-col items-center gap-0.5">
            <span className="text-lg font-bold tabular-nums text-ios-label">{profile.xp}</span>
            <span className="text-xs text-ios-secondary-label">XP</span>
          </div>
          <div className="w-px bg-ios-divider" />
          <div className="flex flex-1 flex-col items-center gap-0.5">
            <span className="flex items-center gap-1 text-lg font-bold tabular-nums text-ios-orange">
              <Flame size={16} weight="fill" />
              {profile.streak.current}
            </span>
            <span className="text-xs text-ios-secondary-label">Kunlik faollik</span>
          </div>
        </div>
      )}

      {stats && (
        <div className="flex flex-col rounded-2xl bg-ios-card px-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
          <div className="flex items-center gap-3 border-b border-ios-divider py-3">
            <span className="flex-1 text-sm text-ios-secondary-label">O'yinlar</span>
            <span className="font-semibold tabular-nums text-ios-label">{stats.gamesPlayed}</span>
          </div>
          <div className="flex items-center gap-3 py-3">
            <span className="flex-1 text-sm text-ios-secondary-label">Reyting</span>
            <span className="font-semibold tabular-nums text-ios-blue">{stats.rating}</span>
          </div>
        </div>
      )}

      {recentEarned.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-ios-secondary-label">So'nggi yutuqlar</h3>
          <div className="flex flex-col rounded-2xl bg-ios-card px-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
            {recentEarned.map((e, index) => (
              <div
                key={e.key}
                className={`flex items-center gap-3 py-3 ${index === recentEarned.length - 1 ? '' : 'border-b border-ios-divider'}`}
              >
                <Trophy size={18} weight="fill" className="text-ios-gold" />
                <span className="flex-1 text-sm font-medium text-ios-label">
                  {catalogByKey.get(e.key)?.label ?? e.key}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => navigate({ name: 'achievements' })}
        className="text-center text-sm font-semibold text-ios-blue"
      >
        Barcha yutuqlarni ko'rish
      </button>
    </div>
  );
}
```

- [ ] **Step 6: Run to verify it passes**

Run (from `frontend/`):
```bash
npx vitest run src/screens/ProfileScreen.test.tsx
```
Expected: PASS — all four tests.

- [ ] **Step 7: Typecheck the whole frontend**

Run (from `frontend/`):
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/context/NavigationContext.tsx frontend/src/App.tsx frontend/src/screens/ProfileScreen.tsx frontend/src/screens/ProfileScreen.test.tsx
git commit -m "Add ProfileScreen with Mastery/XP/streak/achievements, wired into navigation"
```

---

### Task 11: `SettingsScreen` — replace the profile card with a "Mening profilim" entry point

**Files:**
- Modify: `frontend/src/screens/SettingsScreen.tsx`
- Modify: `frontend/src/screens/SettingsScreen.test.tsx`

- [ ] **Step 1: Update the test first**

In `frontend/src/screens/SettingsScreen.test.tsx`, replace this test:

```typescript
  it('shows the profile card with name, username, and headline stats', async () => {
    vi.spyOn(statsApi, 'getMyStats').mockResolvedValue({
      gamesPlayed: 10, gamesWon: 6, winRate: 60, currentStreak: 2, bestStreak: 4, rating: 1080,
    });

    render(<SettingsScreen />);

    await waitFor(() => expect(screen.getByText('Aziz')).toBeInTheDocument());
    expect(screen.getByText('@aziz_handle')).toBeInTheDocument();
    expect(screen.getByText('O\'yinlar')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('Reyting')).toBeInTheDocument();
    expect(screen.getByText('1080')).toBeInTheDocument();
  });
```

with:

```typescript
  it('shows a "Mening profilim" entry point and navigates to the profile screen when clicked', async () => {
    vi.spyOn(statsApi, 'getMyStats').mockResolvedValue({
      gamesPlayed: 10, gamesWon: 6, winRate: 60, currentStreak: 2, bestStreak: 4, rating: 1080,
    });

    render(<SettingsScreen />);

    const button = await screen.findByText('Mening profilim');
    fireEvent.click(button);

    expect(navigate).toHaveBeenCalledWith({ name: 'profile' });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run (from `frontend/`):
```bash
npx vitest run src/screens/SettingsScreen.test.tsx
```
Expected: FAIL — "Mening profilim" text not found yet.

- [ ] **Step 3: Replace the profile card in `SettingsScreen.tsx`**

In `frontend/src/screens/SettingsScreen.tsx`, change:

```typescript
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-ios-card p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
        <BattleAvatar telegramId={user?.telegramId ?? null} size={72} />
        <div className="text-center">
          <p className="font-bold text-ios-label">{user?.firstName}</p>
          {user?.username && <p className="text-sm text-ios-secondary-label">@{user.username}</p>}
        </div>

        <div className="mt-1 flex w-full items-stretch border-t border-ios-divider pt-3">
          <div className="flex flex-1 flex-col items-center gap-0.5">
            <span className="text-lg font-bold tabular-nums text-ios-label">{stats.gamesPlayed}</span>
            <span className="text-xs text-ios-secondary-label">O'yinlar</span>
          </div>
          <div className="w-px bg-ios-divider" />
          <div className="flex flex-1 flex-col items-center gap-0.5">
            <span className="text-lg font-bold tabular-nums text-ios-blue">{stats.rating}</span>
            <span className="text-xs text-ios-secondary-label">Reyting</span>
          </div>
        </div>
      </div>
```

to:

```typescript
      <button
        type="button"
        onClick={() => navigate({ name: 'profile' })}
        className="flex items-center gap-3 rounded-2xl bg-ios-card p-4 text-left shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]"
      >
        <BattleAvatar telegramId={user?.telegramId ?? null} size={48} />
        <span className="flex-1 font-medium text-ios-label">Mening profilim</span>
        <CaretRight size={16} className="text-ios-secondary-label" />
      </button>
```

- [ ] **Step 4: Run to verify it passes**

Run (from `frontend/`):
```bash
npx vitest run src/screens/SettingsScreen.test.tsx
```
Expected: PASS — all tests (the "detailed stat rows" test, which checks `G'alaba foizi`/`Joriy seriya`/`Eng uzun seriya`, is unaffected since those rows are untouched).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/SettingsScreen.tsx frontend/src/screens/SettingsScreen.test.tsx
git commit -m "Move SettingsScreen's profile card into a Mening profilim entry point to ProfileScreen"
```

---

### Task 12: `HomeScreen` — Daily Quest card and daily-activity streak indicator

**Files:**
- Modify: `frontend/src/screens/HomeScreen.tsx`
- Modify: `frontend/src/screens/HomeScreen.test.tsx`

- [ ] **Step 1: Add the failing test**

In `frontend/src/screens/HomeScreen.test.tsx`, add this import alongside the existing api mocks:

```typescript
import * as profileApi from '../api/profile';
```

Add this default mock inside the existing `beforeEach` block, alongside the other `vi.spyOn(...).mockResolvedValue(...)` calls:

```typescript
    vi.spyOn(profileApi, 'getProfile').mockResolvedValue({
      xp: 0, masteryPoints: 0, masteryRank: 'Boshlangich', category: 'ingliz_tili',
      dailyQuests: [], streak: { current: 0, best: 0, freezeAvailable: true },
    });
```

Add this new test at the end of the `describe('HomeScreen', ...)` block:

```typescript
  it('shows the Daily Quest card with progress and the daily activity streak once the profile loads', async () => {
    vi.spyOn(profileApi, 'getProfile').mockResolvedValue({
      xp: 120, masteryPoints: 40, masteryRank: 'Boshlangich', category: 'ingliz_tili',
      dailyQuests: [
        { key: 'matches_3', label: "Bugun 3 ta jang o'ynang", progress: 1, target: 3, completed: false },
      ],
      streak: { current: 5, best: 9, freezeAvailable: true },
    });

    render(<HomeScreen />);

    await screen.findByText("Bugun 3 ta jang o'ynang");
    expect(screen.getByText('1/3')).toBeInTheDocument();
    expect(screen.getByText(/Kunlik faollik: 5 kun/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run (from `frontend/`):
```bash
npx vitest run src/screens/HomeScreen.test.tsx
```
Expected: FAIL — the new test's text isn't rendered yet.

- [ ] **Step 3: Add the Daily Quest card to `HomeScreen.tsx`**

In `frontend/src/screens/HomeScreen.tsx`, add these imports:

```typescript
import { Lightning, UserPlus, Flame, Star, Trophy, CheckCircle, Circle } from '@phosphor-icons/react';
import { getProfile, ProfileResponse } from '../api/profile';
```

(replacing the existing `import { Lightning, UserPlus, Flame, Star, Trophy } from '@phosphor-icons/react';` line).

Add this state declaration alongside the existing ones:

```typescript
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
```

Add this fetch inside the existing `useEffect`, alongside the other four independent fetches:

```typescript
    getProfile(token).then(setProfile).catch(() => {});
```

Add this new block in the JSX, immediately after the closing `</div>` of the avatar/HUD row (i.e. right before the `{recentEarned.length > 0 && (...)}` block):

```typescript
      {profile && (
        <div className="animate-fade-in-up flex flex-col gap-2 rounded-2xl bg-ios-card p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
          <span className="flex items-center gap-1 text-sm font-semibold text-ios-label">
            <Flame size={16} weight="fill" className="text-ios-orange" />
            Kunlik faollik: {profile.streak.current} kun
          </span>
          <div className="flex flex-col gap-1.5">
            {profile.dailyQuests.map((quest) => (
              <div key={quest.key} className="flex items-center gap-2">
                {quest.completed ? (
                  <CheckCircle size={16} weight="fill" className="text-ios-green" />
                ) : (
                  <Circle size={16} className="text-ios-secondary-label" />
                )}
                <span
                  className={`flex-1 text-xs ${
                    quest.completed ? 'text-ios-secondary-label line-through' : 'text-ios-label'
                  }`}
                >
                  {quest.label}
                </span>
                <span className="text-xs font-semibold tabular-nums text-ios-secondary-label">
                  {quest.progress}/{quest.target}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
```

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
git commit -m "Add Daily Quest card and daily-activity streak indicator to HomeScreen"
```

---

### Task 13: `LevelSelectScreen` — Mastery badge

**Files:**
- Modify: `frontend/src/screens/LevelSelectScreen.tsx`
- Modify: `frontend/src/screens/LevelSelectScreen.test.tsx`

- [ ] **Step 1: Add the failing test**

In `frontend/src/screens/LevelSelectScreen.test.tsx`, add this import:

```typescript
import * as profileApi from '../api/profile';
```

Add this default mock inside the existing `beforeEach` block:

```typescript
    vi.spyOn(profileApi, 'getProfile').mockResolvedValue({
      xp: 0, masteryPoints: 0, masteryRank: 'Boshlangich', category: 'ingliz_tili',
      dailyQuests: [], streak: { current: 0, best: 0, freezeAvailable: true },
    });
```

Add this new test:

```typescript
  it("shows the user's Mastery badge next to the heading once the profile loads", async () => {
    vi.spyOn(levelProgressApi, 'getLevelProgress').mockResolvedValue({
      progress: [], maxAvailableLevel: 3, tierBoundaries: [],
    });
    vi.spyOn(profileApi, 'getProfile').mockResolvedValue({
      xp: 500, masteryPoints: 200, masteryRank: 'Orta', category: 'ingliz_tili',
      dailyQuests: [], streak: { current: 3, best: 3, freezeAvailable: true },
    });

    render(<LevelSelectScreen intent="quick" />);

    await screen.findByText("O'rta");
  });
```

- [ ] **Step 2: Run to verify it fails**

Run (from `frontend/`):
```bash
npx vitest run src/screens/LevelSelectScreen.test.tsx
```
Expected: FAIL — `"O'rta"` not found.

- [ ] **Step 3: Add the Mastery badge to `LevelSelectScreen.tsx`**

Add these imports:

```typescript
import { getProfile, MasteryRank } from '../api/profile';
import { MasteryBadge } from '../components/MasteryBadge';
```

Add this state declaration alongside the existing ones:

```typescript
  const [masteryRank, setMasteryRank] = useState<MasteryRank | null>(null);
```

Add this fetch as its own `useEffect` (separate from the existing `getLevelProgress` effect, so a slow/failed profile fetch never blocks the level grid from rendering):

```typescript
  useEffect(() => {
    if (!token) return;
    getProfile(token).then((res) => setMasteryRank(res.masteryRank)).catch(() => {});
  }, [token]);
```

Change:

```typescript
      <h2 className="text-lg font-bold text-ios-label">Bosqichlar</h2>
```

to:

```typescript
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-ios-label">Bosqichlar</h2>
        {masteryRank && <MasteryBadge rank={masteryRank} />}
      </div>
```

- [ ] **Step 4: Run to verify it passes**

Run (from `frontend/`):
```bash
npx vitest run src/screens/LevelSelectScreen.test.tsx
```
Expected: PASS — all tests.

- [ ] **Step 5: Run the full frontend suite and typecheck**

Run (from `frontend/`):
```bash
npx vitest run
npx tsc --noEmit
```
Expected: PASS — full suite green, no type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screens/LevelSelectScreen.tsx frontend/src/screens/LevelSelectScreen.test.tsx
git commit -m "Add Mastery badge to LevelSelectScreen"
```

---

## After all 13 tasks

Run both full suites one final time (backend from `backend/`, frontend from `frontend/`):

```bash
npm test
```
```bash
npx vitest run && npx tsc --noEmit
```

Expected: both green. At this point the feature is fully implemented per the design spec: XP + Mastery (Ingliz tili only), 3 Daily Quests, daily-activity streak with a weekly freeze, and a new `ProfileScreen` showcasing all of it — with zero new background-job infrastructure.
