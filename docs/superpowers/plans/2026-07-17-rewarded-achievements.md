# Rewarded Achievements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tiered XP reward (50/100/200/300) to each of the 14 existing achievements, credited to the user's current-week league XP (`league_weekly_xp`) the first time an achievement is earned, and surface the reward amount on both achievement-related frontend screens.

**Architecture:** No new tables. `Achievement`'s catalog entries (`backend/src/achievements/achievements.ts`) gain an `xpReward` field. `awardAchievements()` — which already returns only the genuinely-newly-earned keys via SQL's `ON CONFLICT DO NOTHING RETURNING` — is extended to call the existing `accumulateWeeklyXp()` (from the League feature) for each newly-earned key's reward. No other call site changes: `checkAndAwardMatchAchievements`/`checkAndAwardLevelAchievements`/`gameEngine.ts` already funnel through `awardAchievements`, so the new XP crediting happens transparently underneath them.

**Tech Stack:** Backend: Node/TypeScript/Express/PostgreSQL, Jest against a real local Postgres+Redis. Frontend: Vite/React/TypeScript/Tailwind v4, Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-07-17-rewarded-achievements-design.md`

---

### Task 1: Backend — `xpReward` field, crediting logic, tests

**Files:**
- Modify: `backend/src/achievements/achievements.ts`
- Modify: `backend/tests/achievements/achievements.test.ts`
- Modify: `backend/tests/achievements/achievementsRoutes.test.ts`

- [ ] **Step 1: Write the failing tests**

In `backend/tests/achievements/achievements.test.ts`, replace the `afterEach` block:

```typescript
  afterEach(async () => {
    await pool.query(`DELETE FROM user_achievements WHERE user_id = $1`, [userId]);
  });
```

with (this new cleanup is required because `awardAchievements` will start writing to `league_weekly_xp`/`user_league` via `accumulateWeeklyXp` — without clearing these between tests, `afterAll`'s `DELETE FROM users` would hit a foreign-key violation, and tests asserting an exact weekly-XP total would see totals accumulated across tests instead of a fresh one each time):

```typescript
  afterEach(async () => {
    await pool.query(`DELETE FROM user_achievements WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM league_weekly_xp WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM user_league WHERE user_id = $1`, [userId]);
  });
```

Then add this new `describe` block at the end of the file, just before the final closing `});` of the outer `describe('achievements', ...)` block:

```typescript
  describe('XP reward crediting', () => {
    it('credits the weekly league XP reward for a newly-awarded achievement', async () => {
      const { getWeeklyXp } = await import('../../src/league/leagueRepository');
      await awardAchievements(userId, ['games_1']);
      // games_1's xpReward is 50 (tier 1, see the design spec's reward table).
      expect(await getWeeklyXp(userId)).toBe(50);
    });

    it('does not credit XP again when the same key is awarded a second time', async () => {
      const { getWeeklyXp } = await import('../../src/league/leagueRepository');
      await awardAchievements(userId, ['games_1']);
      await awardAchievements(userId, ['games_1']);
      expect(await getWeeklyXp(userId)).toBe(50);
    });

    it('credits the correct, differing XP amount for achievements of different tiers', async () => {
      const { getWeeklyXp } = await import('../../src/league/leagueRepository');
      await awardAchievements(userId, ['streak_3', 'rating_2000']);
      // streak_3 (tier 1) = 50, rating_2000 (tier 4) = 300 -> 350 total.
      expect(await getWeeklyXp(userId)).toBe(350);
    });
  });
```

In `backend/tests/achievements/achievementsRoutes.test.ts`, replace the `afterEach` block:

```typescript
  afterEach(async () => {
    await pool.query(`DELETE FROM user_achievements WHERE user_id = $1`, [userId]);
  });
```

with (same reasoning as above — this file's one test that calls `awardAchievements` will now also write to these tables):

```typescript
  afterEach(async () => {
    await pool.query(`DELETE FROM user_achievements WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM league_weekly_xp WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM user_league WHERE user_id = $1`, [userId]);
  });
```

- [ ] **Step 2: Run to verify the new tests fail**

Run (from `backend/`):
```bash
npx jest tests/achievements/achievements.test.ts -t "XP reward crediting"
```
Expected: FAIL — `getWeeklyXp` returns `0`, not `50`/`350` (no crediting logic exists yet). (`achievementsRoutes.test.ts`'s modified `afterEach` doesn't itself add a new assertion, so nothing new fails there yet — it's a no-op cleanup addition until Step 4 wires in the side effect.)

- [ ] **Step 3: Add `xpReward` to the `Achievement` interface and catalog**

In `backend/src/achievements/achievements.ts`, replace:

```typescript
export interface Achievement {
  key: string;
  category: AchievementCategory;
  label: string;
  description: string;
  threshold: number;
}
```

with:

```typescript
export interface Achievement {
  key: string;
  category: AchievementCategory;
  label: string;
  description: string;
  threshold: number;
  // Credited once, to league_weekly_xp, the first time this key is
  // genuinely newly-awarded (see awardAchievements below) - never on a
  // re-award of an already-earned key. Scales with tier/difficulty (see the
  // design spec's reward table): 50/100/200/300.
  xpReward: number;
}
```

Replace the `ACHIEVEMENTS` catalog:

```typescript
export const ACHIEVEMENTS: Achievement[] = [
  { key: 'games_1', category: 'games', label: 'Birinchi qadam', description: "1 ta o'yin o'ynang", threshold: 1 },
  { key: 'games_10', category: 'games', label: "Faol o'yinchi", description: "10 ta o'yin o'ynang", threshold: 10 },
  { key: 'games_50', category: 'games', label: 'Tajribali', description: "50 ta o'yin o'ynang", threshold: 50 },
  { key: 'games_100', category: 'games', label: "Faxriy a'zo", description: "100 ta o'yin o'ynang", threshold: 100 },
  { key: 'streak_3', category: 'streak', label: 'Olov', description: "3 ta ketma-ket g'alaba qozoning", threshold: 3 },
  { key: 'streak_5', category: 'streak', label: 'Alanga', description: "5 ta ketma-ket g'alaba qozoning", threshold: 5 },
  { key: 'streak_10', category: 'streak', label: "Yong'in", description: "10 ta ketma-ket g'alaba qozoning", threshold: 10 },
  { key: 'rating_1200', category: 'rating', label: 'Yuksalish', description: '1200 reytingga yeting', threshold: 1200 },
  { key: 'rating_1500', category: 'rating', label: 'Chempion', description: '1500 reytingga yeting', threshold: 1500 },
  { key: 'rating_2000', category: 'rating', label: 'Afsona', description: '2000 reytingga yeting', threshold: 2000 },
  { key: 'level_10', category: 'level', label: 'Bosqichlar ustasi I', description: "10-bosqichni tugating", threshold: 10 },
  { key: 'level_50', category: 'level', label: 'Bosqichlar ustasi II', description: "50-bosqichni tugating", threshold: 50 },
  { key: 'level_100', category: 'level', label: 'Bosqichlar ustasi III', description: "100-bosqichni tugating", threshold: 100 },
  { key: 'level_perfect', category: 'level', label: 'Mukammal', description: "Biror bosqichda 3 yulduz oling", threshold: 3 },
];
```

with:

```typescript
export const ACHIEVEMENTS: Achievement[] = [
  { key: 'games_1', category: 'games', label: 'Birinchi qadam', description: "1 ta o'yin o'ynang", threshold: 1, xpReward: 50 },
  { key: 'games_10', category: 'games', label: "Faol o'yinchi", description: "10 ta o'yin o'ynang", threshold: 10, xpReward: 100 },
  { key: 'games_50', category: 'games', label: 'Tajribali', description: "50 ta o'yin o'ynang", threshold: 50, xpReward: 200 },
  { key: 'games_100', category: 'games', label: "Faxriy a'zo", description: "100 ta o'yin o'ynang", threshold: 100, xpReward: 300 },
  { key: 'streak_3', category: 'streak', label: 'Olov', description: "3 ta ketma-ket g'alaba qozoning", threshold: 3, xpReward: 50 },
  { key: 'streak_5', category: 'streak', label: 'Alanga', description: "5 ta ketma-ket g'alaba qozoning", threshold: 5, xpReward: 100 },
  { key: 'streak_10', category: 'streak', label: "Yong'in", description: "10 ta ketma-ket g'alaba qozoning", threshold: 10, xpReward: 200 },
  { key: 'rating_1200', category: 'rating', label: 'Yuksalish', description: '1200 reytingga yeting', threshold: 1200, xpReward: 100 },
  { key: 'rating_1500', category: 'rating', label: 'Chempion', description: '1500 reytingga yeting', threshold: 1500, xpReward: 200 },
  { key: 'rating_2000', category: 'rating', label: 'Afsona', description: '2000 reytingga yeting', threshold: 2000, xpReward: 300 },
  { key: 'level_10', category: 'level', label: 'Bosqichlar ustasi I', description: "10-bosqichni tugating", threshold: 10, xpReward: 100 },
  { key: 'level_50', category: 'level', label: 'Bosqichlar ustasi II', description: "50-bosqichni tugating", threshold: 50, xpReward: 200 },
  { key: 'level_100', category: 'level', label: 'Bosqichlar ustasi III', description: "100-bosqichni tugating", threshold: 100, xpReward: 300 },
  { key: 'level_perfect', category: 'level', label: 'Mukammal', description: "Biror bosqichda 3 yulduz oling", threshold: 3, xpReward: 300 },
];
```

- [ ] **Step 4: Wire XP crediting into `awardAchievements`**

Add this import near the top of `backend/src/achievements/achievements.ts` (after the existing `import { pool } from '../config/db';`):

```typescript
import { accumulateWeeklyXp } from '../league/leagueRepository';
```

Replace the `awardAchievements` function:

```typescript
export async function awardAchievements(userId: number, candidateKeys: string[]): Promise<string[]> {
  if (candidateKeys.length === 0) return [];
  const result = await pool.query<{ achievement_key: string }>(
    `INSERT INTO user_achievements (user_id, achievement_key)
     SELECT $1, key FROM unnest($2::text[]) AS key
     ON CONFLICT (user_id, achievement_key) DO NOTHING
     RETURNING achievement_key`,
    [userId, candidateKeys]
  );
  return result.rows.map((r) => r.achievement_key);
}
```

with:

```typescript
export async function awardAchievements(userId: number, candidateKeys: string[]): Promise<string[]> {
  if (candidateKeys.length === 0) return [];
  const result = await pool.query<{ achievement_key: string }>(
    `INSERT INTO user_achievements (user_id, achievement_key)
     SELECT $1, key FROM unnest($2::text[]) AS key
     ON CONFLICT (user_id, achievement_key) DO NOTHING
     RETURNING achievement_key`,
    [userId, candidateKeys]
  );
  const newlyAwarded = result.rows.map((r) => r.achievement_key);

  // Credit each genuinely-new key's XP reward to the user's current-week
  // league XP - never for a key that was already earned (those never
  // appear in newlyAwarded, since RETURNING only reports rows the INSERT
  // actually inserted, not ones ON CONFLICT skipped). The `?.` guard is
  // defensive: candidateKeys is caller-supplied, not restricted at the type
  // level to real catalog keys.
  for (const key of newlyAwarded) {
    const achievement = ACHIEVEMENTS.find((a) => a.key === key);
    if (achievement) {
      await accumulateWeeklyXp(userId, achievement.xpReward);
    }
  }

  return newlyAwarded;
}
```

- [ ] **Step 5: Run to verify all tests pass**

Run (from `backend/`):
```bash
npx jest tests/achievements/
```
Expected: PASS — all tests in both `achievements.test.ts` and `achievementsRoutes.test.ts`, including the 3 new ones.

- [ ] **Step 6: Typecheck**

Run (from `backend/`):
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/achievements/achievements.ts backend/tests/achievements/achievements.test.ts backend/tests/achievements/achievementsRoutes.test.ts
git commit -m "Credit weekly league XP when an achievement is newly earned"
```

---

### Task 2: Frontend — `AchievementsScreen` shows the XP reward

**Files:**
- Modify: `frontend/src/api/achievements.ts`
- Modify: `frontend/src/screens/AchievementsScreen.tsx`
- Modify: `frontend/src/screens/AchievementsScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

In `frontend/src/screens/AchievementsScreen.test.tsx`, update the 3 existing `getAchievements` mocks to include `xpReward` on every catalog entry (required by the type change in Step 3 below) — replace:

```typescript
  it('shows a loading state, then renders catalog entries once loaded', async () => {
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [{ key: 'games_1', category: 'games', label: 'Birinchi qadam', description: "1 ta o'yin o'ynang" }],
      earned: [],
    });
```

with:

```typescript
  it('shows a loading state, then renders catalog entries once loaded', async () => {
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [{ key: 'games_1', category: 'games', label: 'Birinchi qadam', description: "1 ta o'yin o'ynang", xpReward: 50 }],
      earned: [],
    });
```

Replace:

```typescript
  it('shows an earned achievement as unlocked and an unearned one as locked', async () => {
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [
        { key: 'games_1', category: 'games', label: 'Birinchi qadam', description: "1 ta o'yin o'ynang" },
        { key: 'games_10', category: 'games', label: "Faol o'yinchi", description: "10 ta o'yin o'ynang" },
      ],
      earned: [{ key: 'games_1', earnedAt: '2026-07-14T00:00:00.000Z' }],
    });
```

with:

```typescript
  it('shows an earned achievement as unlocked and an unearned one as locked', async () => {
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [
        { key: 'games_1', category: 'games', label: 'Birinchi qadam', description: "1 ta o'yin o'ynang", xpReward: 50 },
        { key: 'games_10', category: 'games', label: "Faol o'yinchi", description: "10 ta o'yin o'ynang", xpReward: 100 },
      ],
      earned: [{ key: 'games_1', earnedAt: '2026-07-14T00:00:00.000Z' }],
    });
```

Replace:

```typescript
  it('groups achievements by category with a visible category heading', async () => {
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [
        { key: 'games_1', category: 'games', label: 'Birinchi qadam', description: '...' },
        { key: 'streak_3', category: 'streak', label: 'Olov', description: '...' },
      ],
      earned: [],
    });
```

with:

```typescript
  it('groups achievements by category with a visible category heading', async () => {
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [
        { key: 'games_1', category: 'games', label: 'Birinchi qadam', description: '...', xpReward: 50 },
        { key: 'streak_3', category: 'streak', label: 'Olov', description: '...', xpReward: 50 },
      ],
      earned: [],
    });
```

Then add this new test, right after the `'groups achievements by category...'` test and before the `'shows an error message if loading fails'` test:

```typescript
  it('shows the XP reward on each achievement card', async () => {
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [
        { key: 'games_1', category: 'games', label: 'Birinchi qadam', description: "1 ta o'yin o'ynang", xpReward: 50 },
      ],
      earned: [],
    });

    render(<AchievementsScreen />);
    await screen.findByText('Birinchi qadam');

    expect(screen.getByText('+50 XP')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify the new test fails**

Run (from `frontend/`):
```bash
npx vitest run src/screens/AchievementsScreen.test.tsx
```
Expected: FAIL on `'shows the XP reward on each achievement card'` — `+50 XP` isn't rendered yet. (The other tests should already pass again, since they only needed the mock data updated, not new component behavior yet — this step's purpose is to confirm exactly one new failure, isolating the new behavior under test.)

- [ ] **Step 3: Add `xpReward` to the frontend `Achievement` type**

In `frontend/src/api/achievements.ts`, replace:

```typescript
export interface Achievement {
  key: string;
  category: 'games' | 'streak' | 'rating' | 'level';
  label: string;
  description: string;
}
```

with:

```typescript
export interface Achievement {
  key: string;
  category: 'games' | 'streak' | 'rating' | 'level';
  label: string;
  description: string;
  xpReward: number;
}
```

- [ ] **Step 4: Render the XP reward on each card**

In `frontend/src/screens/AchievementsScreen.tsx`, replace:

```typescript
                    <span className="text-sm font-semibold text-ios-label">{achievement.label}</span>
                    <span className="text-xs text-ios-secondary-label">{achievement.description}</span>
```

with:

```typescript
                    <span className="text-sm font-semibold text-ios-label">{achievement.label}</span>
                    <span className="text-xs text-ios-secondary-label">{achievement.description}</span>
                    <span className="text-xs font-semibold text-ios-gold">+{achievement.xpReward} XP</span>
```

- [ ] **Step 5: Run to verify all tests pass**

Run (from `frontend/`):
```bash
npx vitest run src/screens/AchievementsScreen.test.tsx
```
Expected: PASS — all tests, including the new one.

- [ ] **Step 6: Typecheck**

Run (from `frontend/`):
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/achievements.ts frontend/src/screens/AchievementsScreen.tsx frontend/src/screens/AchievementsScreen.test.tsx
git commit -m "Show each achievement's XP reward on AchievementsScreen"
```

---

### Task 3: Frontend — `ResultScreen` banner shows the XP reward

**Files:**
- Modify: `frontend/src/screens/ResultScreen.tsx`
- Modify: `frontend/src/screens/ResultScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

In `frontend/src/screens/ResultScreen.test.tsx`, replace:

```typescript
  it('shows a "Yangi nishon!" banner when a newly earned achievement is detected after the match', async () => {
    localStorage.clear();
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [{ key: 'games_1', category: 'games', label: 'Birinchi qadam', description: '...' }],
      earned: [{ key: 'games_1', earnedAt: '2026-07-14T00:00:00.000Z' }],
    });

    render(<ResultScreen scores={[]} winnerId={null} forfeited={false} knockout={false} level={5} />);

    await screen.findByText(/Yangi nishon: Birinchi qadam/);
  });

  it('shows the achievement banner in the level-complete branch too', async () => {
    localStorage.clear();
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [{ key: 'level_10', category: 'level', label: 'Bosqichlar ustasi I', description: '...' }],
      earned: [{ key: 'level_10', earnedAt: '2026-07-14T00:00:00.000Z' }],
    });

    render(<ResultScreen scores={[]} winnerId={null} forfeited={false} knockout={false} level={10} levelStars={2} />);

    await screen.findByText(/Yangi nishon: Bosqichlar ustasi I/);
  });
```

with:

```typescript
  it('shows a "Yangi nishon!" banner with its XP reward when a newly earned achievement is detected after the match', async () => {
    localStorage.clear();
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [{ key: 'games_1', category: 'games', label: 'Birinchi qadam', description: '...', xpReward: 50 }],
      earned: [{ key: 'games_1', earnedAt: '2026-07-14T00:00:00.000Z' }],
    });

    render(<ResultScreen scores={[]} winnerId={null} forfeited={false} knockout={false} level={5} />);

    await screen.findByText(/Yangi nishon: Birinchi qadam \(\+50 XP\)/);
  });

  it('shows the achievement banner with its XP reward in the level-complete branch too', async () => {
    localStorage.clear();
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [{ key: 'level_10', category: 'level', label: 'Bosqichlar ustasi I', description: '...', xpReward: 100 }],
      earned: [{ key: 'level_10', earnedAt: '2026-07-14T00:00:00.000Z' }],
    });

    render(<ResultScreen scores={[]} winnerId={null} forfeited={false} knockout={false} level={10} levelStars={2} />);

    await screen.findByText(/Yangi nishon: Bosqichlar ustasi I \(\+100 XP\)/);
  });
```

Also replace (so this test's mock still satisfies the now-required `xpReward` field — the achievement banner isn't expected to show here, so the exact value doesn't matter for this test's assertion, but the object must still type-check):

```typescript
  it('does not re-show a banner for an achievement already seen on a previous visit', async () => {
    localStorage.setItem('bilimbattle:seenAchievements', JSON.stringify(['games_1']));
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [{ key: 'games_1', category: 'games', label: 'Birinchi qadam', description: '...' }],
      earned: [{ key: 'games_1', earnedAt: '2026-07-14T00:00:00.000Z' }],
    });
```

with:

```typescript
  it('does not re-show a banner for an achievement already seen on a previous visit', async () => {
    localStorage.setItem('bilimbattle:seenAchievements', JSON.stringify(['games_1']));
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [{ key: 'games_1', category: 'games', label: 'Birinchi qadam', description: '...', xpReward: 50 }],
      earned: [{ key: 'games_1', earnedAt: '2026-07-14T00:00:00.000Z' }],
    });
```

- [ ] **Step 2: Run to verify the new/updated tests fail**

Run (from `frontend/`):
```bash
npx vitest run src/screens/ResultScreen.test.tsx
```
Expected: FAIL on the two renamed tests (`'shows a "Yangi nishon!" banner with its XP reward...'` and `'shows the achievement banner with its XP reward...'`) — the banner text doesn't include `(+N XP)` yet. Every other test should still pass.

- [ ] **Step 3: Track the whole achievement object, not just its label**

In `frontend/src/screens/ResultScreen.tsx`, replace:

```typescript
  const [newAchievementLabel, setNewAchievementLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getAchievements(token)
      .then((res) => {
        if (cancelled) return;
        const newly = findAndMarkNewlySeenAchievements(res.earned.map((e) => e.key));
        if (newly.length === 0) return;
        const catalogByKey = new Map(res.catalog.map((a) => [a.key, a]));
        setNewAchievementLabel(catalogByKey.get(newly[0])?.label ?? newly[0]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token]);
```

with:

```typescript
  const [newAchievement, setNewAchievement] = useState<{ label: string; xpReward: number } | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getAchievements(token)
      .then((res) => {
        if (cancelled) return;
        const newly = findAndMarkNewlySeenAchievements(res.earned.map((e) => e.key));
        if (newly.length === 0) return;
        const catalogByKey = new Map(res.catalog.map((a) => [a.key, a]));
        const achievement = catalogByKey.get(newly[0]);
        setNewAchievement({ label: achievement?.label ?? newly[0], xpReward: achievement?.xpReward ?? 0 });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token]);
```

- [ ] **Step 4: Show the reward in both banner render sites**

In `frontend/src/screens/ResultScreen.tsx`, there are two identical banner blocks (one in the level-mode return, one in the normal-result return). Replace the FIRST occurrence:

```typescript
        {newAchievementLabel && (
          <div className="animate-star-pop rounded-2xl bg-ios-gold/10 px-4 py-3 text-center text-sm font-semibold text-ios-label">
            🏆 Yangi nishon: {newAchievementLabel}
          </div>
        )}
```

with:

```typescript
        {newAchievement && (
          <div className="animate-star-pop rounded-2xl bg-ios-gold/10 px-4 py-3 text-center text-sm font-semibold text-ios-label">
            🏆 Yangi nishon: {newAchievement.label} (+{newAchievement.xpReward} XP)
          </div>
        )}
```

Then replace the SECOND (identical) occurrence with the same new text:

```typescript
        {newAchievementLabel && (
          <div className="animate-star-pop rounded-2xl bg-ios-gold/10 px-4 py-3 text-center text-sm font-semibold text-ios-label">
            🏆 Yangi nishon: {newAchievementLabel}
          </div>
        )}
```

with:

```typescript
        {newAchievement && (
          <div className="animate-star-pop rounded-2xl bg-ios-gold/10 px-4 py-3 text-center text-sm font-semibold text-ios-label">
            🏆 Yangi nishon: {newAchievement.label} (+{newAchievement.xpReward} XP)
          </div>
        )}
```

- [ ] **Step 5: Run to verify all tests pass**

Run (from `frontend/`):
```bash
npx vitest run src/screens/ResultScreen.test.tsx
```
Expected: PASS — all tests, including the two updated ones.

- [ ] **Step 6: Typecheck**

Run (from `frontend/`):
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/screens/ResultScreen.tsx frontend/src/screens/ResultScreen.test.tsx
git commit -m "Show the XP reward in ResultScreen's new-achievement banner"
```

---

## After all 3 tasks

Run both full suites one final time:
```bash
cd backend && npm test
```
```bash
cd frontend && npx vitest run && npx tsc --noEmit
```
Expected: both green.

No deployment steps beyond the normal `git pull && docker compose up -d --build` (no schema change, no new env var, no migration needed - `league_weekly_xp`/`user_league` already exist from the League feature).
