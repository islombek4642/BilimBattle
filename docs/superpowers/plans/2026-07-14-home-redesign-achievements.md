# Home Screen Redesign + Achievements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the home screen feel alive (progress HUD, achievement badges, a "continue" shortcut, a mini leaderboard) and add a lightweight, permanent achievements system with a "just unlocked!" moment after a match.

**Architecture:** A static achievement catalog lives in backend code; a new `user_achievements` table persists which keys each user has earned (permanent, even if the underlying stat later regresses). Award-checking hooks into two already-existing call points (`gameEngine.ts`'s match-completion path, and its level-mode star-persistence path) rather than changing the game/socket protocol. The frontend's "new achievement!" moment is a client-side diff against `localStorage` on `ResultScreen`, not a socket payload change.

**Tech Stack:** Backend: Node/TS/Express/Postgres, Jest (real local Postgres per `backend/.env`). Frontend: Vite/React/TS/Vitest/RTL, Tailwind.

**Design spec:** `docs/superpowers/specs/2026-07-14-home-redesign-achievements-design.md`

---

### Task 1: Backend — `user_achievements` table

**Files:**
- Modify: `backend/src/db/schema.sql`

- [ ] **Step 1: Add the table**

In `backend/src/db/schema.sql`, add after the `level_progress` table definition (before the `CREATE INDEX`/`DROP INDEX` lines at the bottom):

```sql
CREATE TABLE IF NOT EXISTS user_achievements (
  user_id INTEGER NOT NULL REFERENCES users(id),
  achievement_key TEXT NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement_key)
);
```

This is a brand-new table, so a plain `CREATE TABLE IF NOT EXISTS` is sufficient (no separate `ALTER TABLE ADD COLUMN` is needed — that pattern is only for adding a column to a table that might already exist from before the change).

- [ ] **Step 2: Apply the schema to your local dev database**

Run: `cd backend && npm run migrate`
Expected: `Migration applied successfully.`

- [ ] **Step 3: Verify the table exists**

Run a quick check (e.g. via a throwaway Node script using `pool`, or `psql` if available) that `SELECT * FROM user_achievements LIMIT 1;` succeeds (returns 0 rows, no error). Do not leave any throwaway script in the repo.

- [ ] **Step 4: Commit**

```bash
cd backend
git add src/db/schema.sql
git commit -m "Add user_achievements table"
```

---

### Task 2: Backend — `achievements.ts` catalog and award-checking

**Files:**
- Create: `backend/src/achievements/achievements.ts`
- Create: `backend/tests/achievements/achievements.test.ts`

This module owns the static achievement catalog and all persistence around it. It has no dependency on `gameEngine.ts` or `userRepository.ts` — callers (Task 3) fetch whatever fresh stats they need and pass plain numbers in.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/achievements/achievements.test.ts`:

```ts
import { pool } from '../../src/config/db';
import { upsertUser } from '../../src/users/userRepository';
import {
  ACHIEVEMENTS,
  awardAchievements,
  getEarnedAchievements,
  checkAndAwardMatchAchievements,
  checkAndAwardLevelAchievements,
} from '../../src/achievements/achievements';

describe('achievements', () => {
  let userId: number;

  beforeAll(async () => {
    const user = await upsertUser(881101, 'achievementsTestUser', 'AchievementsTest', null);
    userId = user.id;
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM user_achievements WHERE user_id = $1`, [userId]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id = 881101`);
  });

  describe('ACHIEVEMENTS catalog', () => {
    it('has no duplicate keys', () => {
      const keys = ACHIEVEMENTS.map((a) => a.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('includes exactly one level_perfect entry with threshold 3 (the special-cased star check)', () => {
      const perfect = ACHIEVEMENTS.filter((a) => a.key === 'level_perfect');
      expect(perfect.length).toBe(1);
      expect(perfect[0].threshold).toBe(3);
    });
  });

  describe('awardAchievements / getEarnedAchievements', () => {
    it('awards the given keys and returns them as newly-awarded', async () => {
      const newlyAwarded = await awardAchievements(userId, ['games_1', 'streak_3']);
      expect(newlyAwarded.sort()).toEqual(['games_1', 'streak_3']);

      const earned = await getEarnedAchievements(userId);
      expect(earned.map((e) => e.key).sort()).toEqual(['games_1', 'streak_3']);
    });

    it('does not re-award (or re-report as new) an already-earned key', async () => {
      await awardAchievements(userId, ['games_1']);
      const secondCall = await awardAchievements(userId, ['games_1']);
      expect(secondCall).toEqual([]);

      const earned = await getEarnedAchievements(userId);
      expect(earned.length).toBe(1);
    });

    it('returns an empty array without querying when given no candidate keys', async () => {
      expect(await awardAchievements(userId, [])).toEqual([]);
    });
  });

  describe('checkAndAwardMatchAchievements', () => {
    it('awards every games/streak/rating achievement whose threshold the given stats meet or exceed', async () => {
      const newlyAwarded = await checkAndAwardMatchAchievements(userId, {
        gamesPlayed: 12,
        currentStreak: 4,
        rating: 1300,
      });
      // games_1, games_10 (gamesPlayed=12 >= both); streak_3 (currentStreak=4
      // >= 3, not >= 5); rating_1200 (rating=1300 >= 1200, not >= 1500).
      expect(newlyAwarded.sort()).toEqual(['games_1', 'games_10', 'rating_1200', 'streak_3']);
    });

    it('never awards a level-category achievement from match stats', async () => {
      const newlyAwarded = await checkAndAwardMatchAchievements(userId, {
        gamesPlayed: 200,
        currentStreak: 20,
        rating: 3000,
      });
      expect(newlyAwarded.every((key) => !key.startsWith('level_'))).toBe(true);
    });
  });

  describe('checkAndAwardLevelAchievements', () => {
    it('awards the level-count achievement whose threshold levelNumber meets, but not level_perfect unless stars is exactly 3', async () => {
      const newlyAwarded = await checkAndAwardLevelAchievements(userId, 10, 2);
      expect(newlyAwarded).toEqual(['level_10']);
    });

    it('awards level_perfect when stars is exactly 3, independent of levelNumber', async () => {
      const newlyAwarded = await checkAndAwardLevelAchievements(userId, 1, 3);
      expect(newlyAwarded).toEqual(['level_perfect']);
    });

    it('does not award level_perfect for a levelNumber that happens to equal 3 with fewer than 3 stars (regression guard against threshold confusion)', async () => {
      // level_perfect's threshold (3) is coincidentally the same NUMBER as
      // level 3 - this guards against a bug where the level-count check and
      // the perfect-stars check get merged into one generic ">=" comparison
      // and level 3 accidentally satisfies level_perfect's threshold.
      const newlyAwarded = await checkAndAwardLevelAchievements(userId, 3, 1);
      expect(newlyAwarded).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest tests/achievements/achievements.test.ts`
Expected: FAIL — `backend/src/achievements/achievements.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `backend/src/achievements/achievements.ts`:

```ts
// backend/src/achievements/achievements.ts
import { pool } from '../config/db';

export type AchievementCategory = 'games' | 'streak' | 'rating' | 'level';

export interface Achievement {
  key: string;
  category: AchievementCategory;
  label: string;
  description: string;
  threshold: number;
}

// Static catalog - fixed, versioned with the code, not editable at runtime
// or stored in the database. Only *which user has earned which* needs
// persistence (see user_achievements). Every entry except 'level_perfect'
// is a simple "already-tracked value >= threshold" check; 'level_perfect'
// is special-cased in checkAndAwardLevelAchievements below (it checks an
// exact star count on THIS level, not a cumulative level number), so its
// `threshold` field here is documentation/display only, not used in a
// generic ">=" comparison anywhere.
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

export interface EarnedAchievement {
  key: string;
  earnedAt: string;
}

// Awards every key in `candidateKeys` the user doesn't already have, in one
// batched insert - safe to call redundantly (e.g. the same match could in
// principle qualify a player for the same key twice across two different
// call sites) since ON CONFLICT DO NOTHING makes re-awarding a no-op.
// Returns only the keys that were GENUINELY new this call (via RETURNING),
// not the full earned set.
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

export async function getEarnedAchievements(userId: number): Promise<EarnedAchievement[]> {
  const result = await pool.query<{ achievement_key: string; earned_at: Date }>(
    `SELECT achievement_key, earned_at FROM user_achievements WHERE user_id = $1`,
    [userId]
  );
  return result.rows.map((r) => ({ key: r.achievement_key, earnedAt: r.earned_at.toISOString() }));
}

// Checks already-updated match stats (games_played, current_streak, rating -
// the caller is responsible for fetching these AFTER the match's
// persistMatchResult has run) against the games/streak/rating categories
// and awards any newly-crossed threshold. Deliberately never touches the
// 'level' category - level achievements are awarded by
// checkAndAwardLevelAchievements below, keyed off different data
// (level_progress, not users).
export async function checkAndAwardMatchAchievements(
  userId: number,
  stats: { gamesPlayed: number; currentStreak: number; rating: number }
): Promise<string[]> {
  const qualifying = ACHIEVEMENTS.filter(
    (a) =>
      (a.category === 'games' && stats.gamesPlayed >= a.threshold) ||
      (a.category === 'streak' && stats.currentStreak >= a.threshold) ||
      (a.category === 'rating' && stats.rating >= a.threshold)
  ).map((a) => a.key);
  return awardAchievements(userId, qualifying);
}

// levelNumber and stars come from a single just-finished level-mode match
// (see gameEngine.ts's finishGame). level_10/50/100 check levelNumber
// directly (any star count - "finished a level-mode match for level N at
// all" is the bar, not a minimum stars requirement). level_perfect is
// checked separately against `stars === 3` on THIS SPECIFIC call, not
// "has ANY level ever reached 3 stars" via a historical query - the
// literal stars value from the match that just happened is sufficient and
// cheaper. This intentional separation is what the regression-guard test
// in achievements.test.ts locks in.
export async function checkAndAwardLevelAchievements(
  userId: number,
  levelNumber: number,
  stars: number
): Promise<string[]> {
  const qualifying: string[] = [];
  if (levelNumber >= 10) qualifying.push('level_10');
  if (levelNumber >= 50) qualifying.push('level_50');
  if (levelNumber >= 100) qualifying.push('level_100');
  if (stars === 3) qualifying.push('level_perfect');
  return awardAchievements(userId, qualifying);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/achievements/achievements.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Run the full backend suite and typecheck**

Run: `cd backend && npx jest`
Expected: PASS (note: this suite has known pre-existing, unrelated flakiness in `tests/matchmaking/matchmaker.test.ts`/`tests/matchmaking/concurrent-join.test.ts`/`tests/admin/statsQueries.test.ts` caused by parallel Jest workers sharing one real Postgres database — if you see a failure ONLY in one of those files, re-run once or twice to confirm it's not a real regression)

Run: `cd backend && npx tsc --noEmit`
Expected: clean, zero errors

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/achievements/achievements.ts tests/achievements/achievements.test.ts
git commit -m "Add achievements module: catalog, awarding, match/level threshold checks"
```

---

### Task 3: Backend — wire achievement-checking into `gameEngine.ts`

**Files:**
- Modify: `backend/src/game/gameEngine.ts`
- Modify: `backend/tests/game/gameEngine.test.ts`

- [ ] **Step 1: Write the failing tests**

Read the ACTUAL current `backend/tests/game/gameEngine.test.ts` in full first (this file already has `createFakeIO()`, `setIOForTesting`, `player1Id`/`player2Id` from `beforeAll`, `questionRepository` imported as a namespace, `startGame`/`submitAnswer`/`getGame`/`deleteGame` imports, and `randomUUID` from `crypto` — reuse these exactly; if any differ from what's assumed here, adapt to what's actually there). Add the import:

```ts
import { getEarnedAchievements } from '../../src/achievements/achievements';
```

Add to the existing `describe('gameEngine full match flow', ...)` block:

```ts
  it('awards a match-based achievement (e.g. first game played) after a level-mode match finishes', async () => {
    const gameId = randomUUID();
    const { fakeIO } = createFakeIO();
    setIOForTesting(fakeIO as any);

    const fixtureQuestions = Array.from({ length: 15 }, (_, i) => ({
      id: 902000 + i,
      text: `ACHIEVEMENT_MATCH_TEST_Q${i}`,
      options: ['a', 'b', 'c', 'd'],
      correctIndex: 0,
    }));
    const getQuestionsForLevelSpy = jest
      .spyOn(questionRepository, 'getQuestionsForLevel')
      .mockResolvedValueOnce(fixtureQuestions);

    await startGame(gameId, 'ingliz_tili', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' }, undefined, 30);

    for (let round = 0; round < 15; round += 1) {
      await submitAnswer(gameId, player1Id, 0, round);
      await submitAnswer(gameId, player2Id, 1, round);
    }

    const earned = await getEarnedAchievements(player1Id);
    expect(earned.some((e) => e.key === 'games_1')).toBe(true);

    getQuestionsForLevelSpy.mockRestore();
    await pool.query(`DELETE FROM user_achievements WHERE user_id IN ($1, $2)`, [player1Id, player2Id]);
    await pool.query(`DELETE FROM level_progress WHERE level_number = 30 AND user_id IN ($1, $2)`, [player1Id, player2Id]);
  });

  it('awards level-based achievements (level count, and perfect-stars) after a level-mode match finishes', async () => {
    const gameId = randomUUID();
    const { fakeIO } = createFakeIO();
    setIOForTesting(fakeIO as any);

    // 15 fixture questions, all correctIndex 0 - player1 answers every one
    // correctly (15/15 -> 3 stars, per calculateLevelStars), player2 answers
    // every one incorrectly (0/15 -> 0 stars).
    const fixtureQuestions = Array.from({ length: 15 }, (_, i) => ({
      id: 902100 + i,
      text: `ACHIEVEMENT_LEVEL_TEST_Q${i}`,
      options: ['a', 'b', 'c', 'd'],
      correctIndex: 0,
    }));
    const getQuestionsForLevelSpy = jest
      .spyOn(questionRepository, 'getQuestionsForLevel')
      .mockResolvedValueOnce(fixtureQuestions);

    await startGame(gameId, 'ingliz_tili', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' }, undefined, 10);

    for (let round = 0; round < 15; round += 1) {
      await submitAnswer(gameId, player1Id, 0, round);
      await submitAnswer(gameId, player2Id, 1, round);
    }

    const earned1 = await getEarnedAchievements(player1Id);
    expect(earned1.some((e) => e.key === 'level_10')).toBe(true);
    expect(earned1.some((e) => e.key === 'level_perfect')).toBe(true);

    const earned2 = await getEarnedAchievements(player2Id);
    expect(earned2.some((e) => e.key === 'level_10')).toBe(true);
    expect(earned2.some((e) => e.key === 'level_perfect')).toBe(false); // 0 stars, not perfect

    getQuestionsForLevelSpy.mockRestore();
    await pool.query(`DELETE FROM user_achievements WHERE user_id IN ($1, $2)`, [player1Id, player2Id]);
    await pool.query(`DELETE FROM level_progress WHERE level_number = 10 AND user_id IN ($1, $2)`, [player1Id, player2Id]);
  });

  it('does not award any achievement to a bot opponent', async () => {
    const gameId = randomUUID();
    const { fakeIO } = createFakeIO();
    setIOForTesting(fakeIO as any);

    const fixtureQuestions = Array.from({ length: 15 }, (_, i) => ({
      id: 902200 + i,
      text: `ACHIEVEMENT_BOT_TEST_Q${i}`,
      options: ['a', 'b', 'c', 'd'],
      correctIndex: 0,
    }));
    const getQuestionsForLevelSpy = jest
      .spyOn(questionRepository, 'getQuestionsForLevel')
      .mockResolvedValueOnce(fixtureQuestions);

    await startGame(gameId, 'ingliz_tili', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2', isBot: true }, undefined, 40);

    for (let round = 0; round < 15; round += 1) {
      await submitAnswer(gameId, player1Id, 0, round);
      await submitAnswer(gameId, player2Id, 1, round);
    }

    // player2 is flagged isBot here via startGame's PlayerInfo, but keeps its
    // OWN real userId (player2Id) in this test rather than swapping in a
    // separate bot user row - the point of this test is only to prove the
    // `!player.isBot` guard genuinely skips awarding when isBot is true,
    // not to exercise the real getOrCreateBotUser() flow (that's covered
    // elsewhere, e.g. matchmaker.test.ts's bot-fallback tests).
    const earned2 = await getEarnedAchievements(player2Id);
    expect(earned2.length).toBe(0);

    getQuestionsForLevelSpy.mockRestore();
    // Clean up both players' achievement rows regardless of the assertion's
    // outcome - if the `!player.isBot` guard were ever broken, player2
    // would have rows here too, and a cleanup scoped to only player1 would
    // leave them behind to contaminate a later test run.
    await pool.query(`DELETE FROM user_achievements WHERE user_id IN ($1, $2)`, [player1Id, player2Id]);
    await pool.query(`DELETE FROM level_progress WHERE level_number = 40 AND user_id IN ($1, $2)`, [player1Id, player2Id]);
  });
```

Read the real `startGame`'s `PlayerInfo` type first to confirm `{ userId, socketId, isBot? }` is really the accepted shape for the second player argument (it should be, per `export interface PlayerInfo { userId: number; socketId: string; isBot?: boolean; }` near the top of `gameEngine.ts`) — adapt the bot-flagging test above if the real signature differs. Also confirm `pool` is already imported in this test file (it should be, from earlier tasks in this project) — if not, add `import { pool } from '../../src/config/db';`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest tests/game/gameEngine.test.ts -t "achievement"`
Expected: FAIL — `getEarnedAchievements` import resolves fine (Task 2 already exists), but no achievements are actually awarded yet since `gameEngine.ts` doesn't call anything from the achievements module.

- [ ] **Step 3: Implement**

Read the ACTUAL current `backend/src/game/gameEngine.ts` in full first (the `finishGame` and `forfeitIfStillDisconnected` function bodies shown below were read directly from the real file during planning, but re-confirm before editing — this file has real, load-bearing race-condition-handling comments that must not be disturbed), then:

1. Change the existing `userRepository` import to also pull in `getUserById`:
```ts
import { recordMatchResult, getUserById } from '../users/userRepository';
```
(replacing the existing `import { recordMatchResult } from '../users/userRepository';` line)

2. Add the new import:
```ts
import { checkAndAwardMatchAchievements, checkAndAwardLevelAchievements } from '../achievements/achievements';
```

3. In `finishGame`'s level-mode branch, add a `checkAndAwardLevelAchievements` call right after the existing `upsertLevelProgress` call, inside the same `if (!player.isBot)` block:

```ts
      if (!player.isBot) {
        await upsertLevelProgress(player.userId, level, stars);
        await checkAndAwardLevelAchievements(player.userId, level, stars);
      }
```

(this replaces the existing `if (!player.isBot) { await upsertLevelProgress(player.userId, level, stars); }` block — only the body changes, the condition and surrounding loop are untouched)

4. Add this new shared helper function, placed right after `persistMatchResult`'s definition (both `finishGame` and `forfeitIfStillDisconnected` will call it):

```ts
// Shared by finishGame and forfeitIfStillDisconnected - both call
// persistMatchResult just before this (which updates games_played/
// current_streak/rating), so both need this same check afterward. Bots are
// skipped (their "achievements" would never be observed by anyone, since
// nobody logs in as the synthetic bot user).
async function awardMatchAchievementsForRealPlayers(players: { userId: number; isBot?: boolean }[]): Promise<void> {
  for (const player of players) {
    if (player.isBot) continue;
    const freshUser = await getUserById(player.userId);
    if (!freshUser) continue;
    await checkAndAwardMatchAchievements(player.userId, {
      gamesPlayed: freshUser.gamesPlayed,
      currentStreak: freshUser.currentStreak,
      rating: freshUser.rating,
    });
  }
}
```

5. In `finishGame`, add a call to this new function right after the existing `await persistMatchResult(gameId, {...});` block:

```ts
  await persistMatchResult(gameId, {
    category: game.category,
    player1Id: p1.userId,
    player2Id: p2.userId,
    player1Score: p1.score,
    player2Score: p2.score,
    winnerId,
  });

  await awardMatchAchievementsForRealPlayers(game.players);
```

(only the new line is added; everything else in `finishGame` below this point — the timer cleanup, `clearSocketGameId`, `deleteGame` — is unchanged)

6. In `forfeitIfStillDisconnected`, add the same call right after ITS existing `await persistMatchResult(gameId, {...});` block:

```ts
  await persistMatchResult(gameId, {
    category: game.category,
    player1Id: game.players[0].userId,
    player2Id: game.players[1].userId,
    player1Score: game.players[0].score,
    player2Score: game.players[1].score,
    winnerId: opponent.userId,
  });

  await awardMatchAchievementsForRealPlayers(game.players);
```

(only the new line is added; `clearSocketGameId`/`deleteGame` below remain unchanged)

Read the exact current code around both `persistMatchResult` call sites first and confirm you're inserting immediately after them, not disturbing anything else in either function.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/game/gameEngine.test.ts`
Expected: PASS (all tests, including the 3 new ones)

- [ ] **Step 5: Run the full backend suite and typecheck**

Run: `cd backend && npx jest` — expect PASS (accounting for known flakiness noted in Task 2)
Run: `cd backend && npx tsc --noEmit` — expect clean

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/game/gameEngine.ts tests/game/gameEngine.test.ts
git commit -m "Award match and level achievements after a game finishes"
```

---

### Task 4: Backend — `GET /achievements` endpoint

**Files:**
- Create: `backend/src/achievements/achievementsRoutes.ts`
- Create: `backend/tests/achievements/achievementsRoutes.test.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/achievements/achievementsRoutes.test.ts`, following the same `supertest`-against-a-bare-`express()`-app pattern already established in `backend/tests/game/levelProgressRoutes.test.ts` (read that file first to confirm the exact conventions - bare `express()` + `app.use('/api', someRouter)`, not `createApp()`):

```ts
import express from 'express';
import request from 'supertest';
import { pool } from '../../src/config/db';
import { signSession } from '../../src/auth/jwt';
import { upsertUser } from '../../src/users/userRepository';
import { awardAchievements } from '../../src/achievements/achievements';
import { achievementsRouter } from '../../src/achievements/achievementsRoutes';

describe('GET /api/achievements', () => {
  const app = express();
  app.use('/api', achievementsRouter);

  let userId: number;
  let token: string;

  beforeAll(async () => {
    const user = await upsertUser(881102, 'achievementsRouteTestUser', 'AchievementsRouteTest', null);
    userId = user.id;
    token = signSession({ userId: user.id, telegramId: 881102 });
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM user_achievements WHERE user_id = $1`, [userId]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id = 881102`);
    await pool.end();
  });

  it('returns 401 with no auth token', async () => {
    const res = await request(app).get('/api/achievements');
    expect(res.status).toBe(401);
  });

  it('returns the full catalog and an empty earned list for a brand new user', async () => {
    const res = await request(app).get('/api/achievements').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.catalog.length).toBeGreaterThan(0);
    expect(res.body.earned).toEqual([]);
  });

  it("returns this user's own earned achievements, not other users'", async () => {
    await awardAchievements(userId, ['games_1']);
    const res = await request(app).get('/api/achievements').set('Authorization', `Bearer ${token}`);
    expect(res.body.earned.map((e: any) => e.key)).toEqual(['games_1']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest tests/achievements/achievementsRoutes.test.ts`
Expected: FAIL — route doesn't exist yet (404).

- [ ] **Step 3: Implement**

Create `backend/src/achievements/achievementsRoutes.ts`:

```ts
import { Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../auth/authMiddleware';
import { ACHIEVEMENTS, getEarnedAchievements } from './achievements';

export const achievementsRouter = Router();

achievementsRouter.get('/achievements', requireAuth, async (req: AuthenticatedRequest, res) => {
  const earned = await getEarnedAchievements(req.userId!);
  res.json({ catalog: ACHIEVEMENTS, earned });
});
```

In `backend/src/app.ts`, add the import and mount it alongside the other `/api`-mounted routers (read the actual current file first to place it consistently — right after the `levelProgressRouter` import/mount is a natural spot):

```ts
import { achievementsRouter } from './achievements/achievementsRoutes';
```
```ts
  app.use('/api', achievementsRouter);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/achievements/achievementsRoutes.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Run the full backend suite and typecheck**

Run: `cd backend && npx jest` — expect PASS (accounting for known flakiness)
Run: `cd backend && npx tsc --noEmit` — expect clean

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/achievements/achievementsRoutes.ts tests/achievements/achievementsRoutes.test.ts src/app.ts
git commit -m "Add GET /achievements endpoint"
```

---

### Task 5: Frontend — extract shared `utils/levelUnlock.ts`, refactor `LevelSelectScreen`

**Files:**
- Create: `frontend/src/utils/levelUnlock.ts`
- Create: `frontend/src/utils/levelUnlock.test.ts`
- Modify: `frontend/src/screens/LevelSelectScreen.tsx`

This pulls `LevelSelectScreen.tsx`'s private `isLevelUnlocked` (and its supporting constants) out into a shared util, and adds a new `findNextLevelToPlay` helper that Task 9's Home screen "Davom etish" shortcut needs. This avoids a third independent copy of the unlock-rule logic (the codebase already accepts one duplication between backend `levelProgress.ts` and this frontend copy — see that file's own comment — a third copy would be worse).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/utils/levelUnlock.test.ts`:

```ts
import { isLevelUnlocked, findNextLevelToPlay } from './levelUnlock';

describe('isLevelUnlocked', () => {
  it('level 1 is always unlocked', () => {
    expect(isLevelUnlocked(1, new Map())).toBe(true);
  });

  it('a non-stage-boundary level unlocks once the previous level has at least 2 stars', () => {
    expect(isLevelUnlocked(4, new Map([[3, 2]]))).toBe(true);
    expect(isLevelUnlocked(4, new Map([[3, 1]]))).toBe(false);
    expect(isLevelUnlocked(4, new Map())).toBe(false);
  });

  it("the first level of a new stage requires >=25 total stars across the previous stage's 10 levels", () => {
    const notEnough = new Map<number, number>();
    for (let i = 1; i <= 10; i += 1) notEnough.set(i, 2); // 20 total
    expect(isLevelUnlocked(11, notEnough)).toBe(false);

    const enough = new Map<number, number>();
    for (let i = 1; i <= 9; i += 1) enough.set(i, 3); // 27
    expect(isLevelUnlocked(11, enough)).toBe(true);
  });
});

describe('findNextLevelToPlay', () => {
  it('returns level 1 for a brand new user with zero progress', () => {
    expect(findNextLevelToPlay(5, new Map())).toBe(1);
  });

  it('returns the first unlocked level with fewer than 3 stars', () => {
    const progress = new Map([[1, 3], [2, 3], [3, 2]]);
    expect(findNextLevelToPlay(5, progress)).toBe(3);
  });

  it('skips a fully-starred level and returns the next one', () => {
    const progress = new Map([[1, 3]]);
    expect(findNextLevelToPlay(5, progress)).toBe(2);
  });

  it('returns null when every level up to maxAvailableLevel already has 3 stars', () => {
    const progress = new Map([[1, 3], [2, 3]]);
    expect(findNextLevelToPlay(2, progress)).toBe(null);
  });

  it('returns null when maxAvailableLevel is 0 (progress not loaded yet)', () => {
    expect(findNextLevelToPlay(0, new Map())).toBe(null);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/utils/levelUnlock.test.ts`
Expected: FAIL — `frontend/src/utils/levelUnlock.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `frontend/src/utils/levelUnlock.ts`:

```ts
// frontend/src/utils/levelUnlock.ts
// Mirrors backend/src/game/levelProgress.ts's isLevelUnlocked exactly - kept
// in sync manually (no shared package between frontend/backend in this
// project). Extracted out of LevelSelectScreen.tsx (which now imports
// isLevelUnlocked from here) so HomeScreen's "Davom etish" shortcut can
// reuse the identical logic instead of a third independent copy.
export const LEVELS_PER_STAGE = 10;
export const STAGE_UNLOCK_STARS_REQUIRED = 25;
export const LEVEL_UNLOCK_STARS_REQUIRED = 2;
export const MAX_STARS_PER_LEVEL = 3;

export function isLevelUnlocked(level: number, progressByLevel: Map<number, number>): boolean {
  if (level === 1) return true;
  const isFirstOfStage = (level - 1) % LEVELS_PER_STAGE === 0;
  if (isFirstOfStage) {
    const stageStart = level - LEVELS_PER_STAGE;
    let totalStars = 0;
    for (let i = stageStart; i < level; i += 1) {
      totalStars += progressByLevel.get(i) ?? 0;
    }
    return totalStars >= STAGE_UNLOCK_STARS_REQUIRED;
  }
  return (progressByLevel.get(level - 1) ?? 0) >= LEVEL_UNLOCK_STARS_REQUIRED;
}

// The lowest-numbered level that's unlocked but not yet perfected (3
// stars) - i.e. "the next thing worth doing". Scans upward from 1, since
// the unlock rule is inherently sequential (level N's unlock depends on
// level N-1 or the stage total), so the first candidate that's both
// unlocked and non-perfect is always genuinely playable right now, not
// just numerically first. Returns null if every level up to
// maxAvailableLevel is already 3-starred, or if maxAvailableLevel is 0
// (progress hasn't loaded yet).
export function findNextLevelToPlay(maxAvailableLevel: number, progressByLevel: Map<number, number>): number | null {
  for (let level = 1; level <= maxAvailableLevel; level += 1) {
    const stars = progressByLevel.get(level) ?? 0;
    if (stars < MAX_STARS_PER_LEVEL && isLevelUnlocked(level, progressByLevel)) {
      return level;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/utils/levelUnlock.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Refactor `LevelSelectScreen.tsx` to use the shared util**

Read the actual current `frontend/src/screens/LevelSelectScreen.tsx` in full, then:

1. Remove the local `LEVELS_PER_STAGE`, `STAGE_UNLOCK_STARS_REQUIRED`, `LEVEL_UNLOCK_STARS_REQUIRED` constants and the local `isLevelUnlocked` function entirely (they're now in `utils/levelUnlock.ts`).
2. Add the import: `import { isLevelUnlocked } from '../utils/levelUnlock';`

Leave everything else in the file — `tierForLevel`, the component body, the render logic — completely untouched. This is a pure extraction; behavior must not change.

- [ ] **Step 6: Run `LevelSelectScreen`'s existing tests to confirm nothing broke**

Run: `cd frontend && npx vitest run src/screens/LevelSelectScreen.test.tsx`
Expected: PASS (same tests as before this task, unmodified — this file's own test file is not touched by this task)

- [ ] **Step 7: Run the full frontend suite and typecheck**

Run: `cd frontend && npx vitest run` — expect PASS
Run: `cd frontend && npx tsc --noEmit` — expect clean

- [ ] **Step 8: Commit**

```bash
cd frontend
git add src/utils/levelUnlock.ts src/utils/levelUnlock.test.ts src/screens/LevelSelectScreen.tsx
git commit -m "Extract isLevelUnlocked into a shared util, add findNextLevelToPlay"
```

---

### Task 6: Frontend — `api/achievements.ts` wrapper

**Files:**
- Create: `frontend/src/api/achievements.ts`

- [ ] **Step 1: Implement**

First read `frontend/src/api/levelProgress.ts` or `frontend/src/api/stats.ts` to confirm the exact `apiGet` wrapper convention, then create `frontend/src/api/achievements.ts`:

```ts
// frontend/src/api/achievements.ts
import { apiGet } from './client';

export interface Achievement {
  key: string;
  category: 'games' | 'streak' | 'rating' | 'level';
  label: string;
  description: string;
}

export interface EarnedAchievement {
  key: string;
  earnedAt: string;
}

export interface AchievementsResponse {
  catalog: Achievement[];
  earned: EarnedAchievement[];
}

export function getAchievements(token: string): Promise<AchievementsResponse> {
  return apiGet<AchievementsResponse>('/achievements', token);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean

No dedicated test file for this task — it's a one-line wrapper with no logic of its own, matching the convention already established for `api/levelProgress.ts`/`api/stats.ts` (neither has its own test file either; they're exercised indirectly via the screens that use them, which Tasks 7/9/10 cover).

- [ ] **Step 3: Commit**

```bash
cd frontend
git add src/api/achievements.ts
git commit -m "Add achievements API wrapper"
```

---

### Task 7: Frontend — new `AchievementsScreen`

**Files:**
- Create: `frontend/src/screens/AchievementsScreen.tsx`
- Create: `frontend/src/screens/AchievementsScreen.test.tsx`

This screen isn't wired into the router yet (that's Task 8) — it's fine and expected that it exists but isn't reachable through the app until then.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/screens/AchievementsScreen.test.tsx`:

```tsx
// frontend/src/screens/AchievementsScreen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AchievementsScreen } from './AchievementsScreen';
import * as authContext from '../context/AuthContext';
import * as achievementsApi from '../api/achievements';

describe('AchievementsScreen', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1 } as any, loading: false, error: null,
    });
  });

  it('shows a loading state, then renders catalog entries once loaded', async () => {
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [{ key: 'games_1', category: 'games', label: 'Birinchi qadam', description: "1 ta o'yin o'ynang" }],
      earned: [],
    });

    render(<AchievementsScreen />);
    expect(screen.getByText(/Yuklanmoqda/)).toBeInTheDocument();

    await screen.findByText('Birinchi qadam');
  });

  it('shows an earned achievement as unlocked and an unearned one as locked', async () => {
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [
        { key: 'games_1', category: 'games', label: 'Birinchi qadam', description: "1 ta o'yin o'ynang" },
        { key: 'games_10', category: 'games', label: "Faol o'yinchi", description: "10 ta o'yin o'ynang" },
      ],
      earned: [{ key: 'games_1', earnedAt: '2026-07-14T00:00:00.000Z' }],
    });

    render(<AchievementsScreen />);
    await screen.findByText('Birinchi qadam');

    const earnedCard = screen.getByText('Birinchi qadam').closest('div');
    const lockedCard = screen.getByText("Faol o'yinchi").closest('div');
    expect(earnedCard).not.toHaveClass('opacity-50');
    expect(lockedCard).toHaveClass('opacity-50');
  });

  it('groups achievements by category with a visible category heading', async () => {
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [
        { key: 'games_1', category: 'games', label: 'Birinchi qadam', description: '...' },
        { key: 'streak_3', category: 'streak', label: 'Olov', description: '...' },
      ],
      earned: [],
    });

    render(<AchievementsScreen />);
    await screen.findByText('Faollik');
    expect(screen.getByText('Olov turkumi'.split(' ')[0])).toBeInTheDocument(); // sanity: "Olov" category label present via its heading text
  });

  it('shows an error message if loading fails', async () => {
    vi.spyOn(achievementsApi, 'getAchievements').mockRejectedValue(new Error('network'));

    render(<AchievementsScreen />);
    await waitFor(() => expect(screen.getByText(/yuklab bo'lmadi/i)).toBeInTheDocument());
  });
});
```

Note: the third test's final assertion is a loose sanity check (both the category heading and the achievement's own label happen to overlap in this fixture's wording) — when implementing, feel free to tighten it to something less ambiguous once you can see the real rendered output (e.g. assert on a `data-testid` per category section, or simply assert both `'Faollik'` and `'Olov'` category headings are present via two separate `getByText` calls) — the important behavior under test is "category headings render," not this exact assertion phrasing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/screens/AchievementsScreen.test.tsx`
Expected: FAIL — `AchievementsScreen.tsx` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `frontend/src/screens/AchievementsScreen.tsx`:

```tsx
// frontend/src/screens/AchievementsScreen.tsx
import { useEffect, useState } from 'react';
import { Flame, Star, Medal, GameController, Lock } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { getAchievements, Achievement, EarnedAchievement } from '../api/achievements';

const CATEGORY_ICON: Record<Achievement['category'], typeof Flame> = {
  games: GameController,
  streak: Flame,
  rating: Star,
  level: Medal,
};

const CATEGORY_LABEL: Record<Achievement['category'], string> = {
  games: 'Faollik',
  streak: 'Olov',
  rating: 'Yuksalish',
  level: 'Bosqichlar',
};

const CATEGORY_ORDER: Achievement['category'][] = ['games', 'streak', 'rating', 'level'];

export function AchievementsScreen() {
  const { token } = useAuth();
  const [catalog, setCatalog] = useState<Achievement[]>([]);
  const [earned, setEarned] = useState<EarnedAchievement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setError(false);

    getAchievements(token)
      .then((res) => {
        if (cancelled) return;
        setCatalog(res.catalog);
        setEarned(res.earned);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center p-6 text-center text-ios-secondary-label">
        Yuklanmoqda...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-full items-center justify-center p-6 text-center text-ios-red">
        Nishonlarni yuklab bo'lmadi.
      </div>
    );
  }

  const earnedByKey = new Map(earned.map((e) => [e.key, e.earnedAt]));

  return (
    <div className="flex flex-col gap-6 p-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <h2 className="text-lg font-bold text-ios-label">Nishonlarim</h2>
      {CATEGORY_ORDER.map((category) => {
        const items = catalog.filter((a) => a.category === category);
        if (items.length === 0) return null;
        const Icon = CATEGORY_ICON[category];
        return (
          <div key={category} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-ios-secondary-label">{CATEGORY_LABEL[category]}</h3>
            <div className="grid grid-cols-2 gap-2">
              {items.map((achievement) => {
                const isEarned = earnedByKey.has(achievement.key);
                return (
                  <div
                    key={achievement.key}
                    className={`flex flex-col items-center gap-1 rounded-2xl p-4 text-center shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)] ${
                      isEarned ? 'bg-ios-card' : 'bg-ios-card opacity-50'
                    }`}
                  >
                    {isEarned ? (
                      <Icon size={28} weight="fill" className="text-ios-gold" />
                    ) : (
                      <Lock size={24} weight="fill" className="text-ios-secondary-label" />
                    )}
                    <span className="text-sm font-semibold text-ios-label">{achievement.label}</span>
                    <span className="text-xs text-ios-secondary-label">{achievement.description}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

Verify `GameController`/`Medal`/`Flame`/`Star`/`Lock` all exist as named exports of `@phosphor-icons/react` (this project already imports `Crown`/`Star`/`Medal`/`Flame`/`ShieldCheck`/`SpeakerHigh`/`Percent`/`CaretRight`/`Lightning`/`UserPlus` elsewhere, so this icon set is very likely available — if `GameController` or `Lock` turn out not to exist under those exact names, pick the closest available equivalent from the same package and note the substitution).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/screens/AchievementsScreen.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 5: Run the full frontend suite and typecheck**

Run: `cd frontend && npx vitest run` — expect PASS for this file; unrelated files are unaffected
Run: `cd frontend && npx tsc --noEmit` — expect clean

- [ ] **Step 6: Commit**

```bash
cd frontend
git add src/screens/AchievementsScreen.tsx src/screens/AchievementsScreen.test.tsx
git commit -m "Add AchievementsScreen"
```

---

### Task 8: Frontend — wire `AchievementsScreen` into navigation

**Files:**
- Modify: `frontend/src/context/NavigationContext.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Add the new screen to the `Screen` union**

Read the actual current `frontend/src/context/NavigationContext.tsx`, then add one variant to the `Screen` union (a simple no-params screen, same shape as `leaderboard`/`settings`/`admin`):

```ts
  | { name: 'achievements' }
```

Place it next to the other simple screens (e.g. right after `settings`). Nothing else in this file changes — `SCREENS_WITHOUT_BACK_BUTTON` stays `['battle']` only (the achievements screen SHOULD show the native back button, same as `admin` already does).

- [ ] **Step 2: Wire it into the Router**

In `frontend/src/App.tsx`, add the import:

```ts
import { AchievementsScreen } from './screens/AchievementsScreen';
```

Add the case to the `Router` function's switch, next to `case 'settings':`:

```ts
    case 'achievements':
      return <AchievementsScreen />;
```

Leave `showBottomNav`'s array (`['home', 'leaderboard', 'settings']`) unchanged — `achievements` is a sub-screen reached via `navigate()`, not a bottom-nav tab (same treatment as `admin`).

- [ ] **Step 3: Run the full frontend suite and typecheck**

Run: `cd frontend && npx vitest run` — expect PASS (no new tests added in this task; existing `App.test.tsx` coverage doesn't exhaustively test every Router case today, consistent with how `LevelSelectScreen`'s own routing was wired in without a dedicated `App.test.tsx` assertion in an earlier plan — Task 9's `HomeScreen` tests will exercise the actual `navigate({name: 'achievements'})` call)
Run: `cd frontend && npx tsc --noEmit` — expect clean (this is the main thing this task's verification leans on: the `Screen` union change type-checking cleanly against the new `AchievementsScreen` case)

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/context/NavigationContext.tsx src/App.tsx
git commit -m "Wire AchievementsScreen into the Router"
```

---

### Task 9: Frontend — `HomeScreen` redesign (HUD, badges, continue shortcut, mini leaderboard)

**Files:**
- Modify: `frontend/src/screens/HomeScreen.tsx`
- Modify: `frontend/src/screens/HomeScreen.test.tsx`

This is the main visual payoff of the whole plan. The existing two CTA buttons (`Tezkor o'yin` / `Do'stni chaqirish`) and the `if (!user) return null;` guard are preserved exactly; everything else in this task is additive.

- [ ] **Step 1: Write the failing tests**

Replace `frontend/src/screens/HomeScreen.test.tsx` in full:

```tsx
// frontend/src/screens/HomeScreen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HomeScreen } from './HomeScreen';
import * as authContext from '../context/AuthContext';
import * as navigationContext from '../context/NavigationContext';
import * as statsApi from '../api/stats';
import * as achievementsApi from '../api/achievements';
import * as levelProgressApi from '../api/levelProgress';
import * as leaderboardApi from '../api/leaderboard';

describe('HomeScreen', () => {
  const navigate = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    navigate.mockClear();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1, telegramId: 555, firstName: 'Aziz' } as any, loading: false, error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'home' },
      navigate, goBack: vi.fn(), replace: vi.fn(), reset: vi.fn(),
    });
    vi.spyOn(statsApi, 'getMyStats').mockResolvedValue({
      gamesPlayed: 5, gamesWon: 3, winRate: 60, currentStreak: 2, bestStreak: 4, rating: 1100,
    });
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({ catalog: [], earned: [] });
    vi.spyOn(levelProgressApi, 'getLevelProgress').mockResolvedValue({
      progress: [], maxAvailableLevel: 0, tierBoundaries: [],
    });
    vi.spyOn(leaderboardApi, 'getGlobalLeaderboard').mockResolvedValue({ leaderboard: [] });
  });

  it('renders nothing while the user is not yet loaded', () => {
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: null, user: null, loading: false, error: null,
    });
    const { container } = render(<HomeScreen />);
    expect(container).toBeEmptyDOMElement();
  });

  it('navigates to levelSelect with intent quick when "Tezkor o\'yin" is clicked', () => {
    render(<HomeScreen />);
    fireEvent.click(screen.getByText("Tezkor o'yin"));
    expect(navigate).toHaveBeenCalledWith({ name: 'levelSelect', intent: 'quick' });
  });

  it('navigates to levelSelect with intent invite when "Do\'stni chaqirish" is clicked', () => {
    render(<HomeScreen />);
    fireEvent.click(screen.getByText("Do'stni chaqirish"));
    expect(navigate).toHaveBeenCalledWith({ name: 'levelSelect', intent: 'invite' });
  });

  it('shows the current streak and rating once stats load', async () => {
    render(<HomeScreen />);
    await screen.findByText('2'); // currentStreak
    expect(screen.getByText('1100')).toBeInTheDocument(); // rating
  });

  it('shows a badge row with recently earned achievements and navigates to the achievements screen when clicked', async () => {
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [{ key: 'games_1', category: 'games', label: 'Birinchi qadam', description: "1 ta o'yin o'ynang" }],
      earned: [{ key: 'games_1', earnedAt: '2026-07-14T00:00:00.000Z' }],
    });

    render(<HomeScreen />);
    await screen.findByText('Birinchi qadam');
    fireEvent.click(screen.getByText('Birinchi qadam'));
    expect(navigate).toHaveBeenCalledWith({ name: 'achievements' });
  });

  it('does not show the achievements badge row when nothing is earned yet', async () => {
    render(<HomeScreen />);
    await screen.findByText('2'); // wait for the stats-driven render to settle
    expect(screen.queryByText('Hammasi')).not.toBeInTheDocument();
  });

  it('shows a "Davom etish" shortcut to the next unlocked, unfinished level', async () => {
    vi.spyOn(levelProgressApi, 'getLevelProgress').mockResolvedValue({
      progress: [{ levelNumber: 1, stars: 3 }], maxAvailableLevel: 5, tierBoundaries: [],
    });

    render(<HomeScreen />);
    await screen.findByText('Davom etish: 2-bosqich');
    fireEvent.click(screen.getByText('Davom etish: 2-bosqich'));
    expect(navigate).toHaveBeenCalledWith({ name: 'levelSelect', intent: 'quick' });
  });

  it('does not show the continue shortcut when there is no progress data yet', async () => {
    render(<HomeScreen />);
    await screen.findByText('2');
    expect(screen.queryByText(/Davom etish/)).not.toBeInTheDocument();
  });

  it('shows a top-3 leaderboard preview and navigates to the full leaderboard when clicked', async () => {
    vi.spyOn(leaderboardApi, 'getGlobalLeaderboard').mockResolvedValue({
      leaderboard: [
        { telegramId: 1, firstName: 'Vali', username: null, rating: 2000, gamesWon: 10 },
        { telegramId: 2, firstName: 'Nodira', username: null, rating: 1800, gamesWon: 8 },
        { telegramId: 3, firstName: 'Sardor', username: null, rating: 1600, gamesWon: 6 },
      ],
    });

    render(<HomeScreen />);
    await screen.findByText('Top reyting');
    expect(screen.getByText('Vali')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Top reyting'));
    expect(navigate).toHaveBeenCalledWith({ name: 'leaderboard' });
  });

  it("shows the player's own rank separately when they're outside the top 3", async () => {
    vi.spyOn(leaderboardApi, 'getGlobalLeaderboard').mockResolvedValue({
      leaderboard: [
        { telegramId: 1, firstName: 'Vali', username: null, rating: 2000, gamesWon: 10 },
        { telegramId: 2, firstName: 'Nodira', username: null, rating: 1800, gamesWon: 8 },
        { telegramId: 3, firstName: 'Sardor', username: null, rating: 1600, gamesWon: 6 },
        { telegramId: 555, firstName: 'Aziz', username: null, rating: 1100, gamesWon: 3 },
      ],
    });

    render(<HomeScreen />);
    await screen.findByText('Top reyting');
    // "Aziz" (telegramId 555, rank 4) is outside the top 3 podium, so should
    // appear exactly once, in the separate own-rank row.
    expect(screen.getAllByText('Aziz').length).toBe(1);
  });

  it('does not show the leaderboard preview when the leaderboard is empty', async () => {
    render(<HomeScreen />);
    await screen.findByText('2');
    expect(screen.queryByText('Top reyting')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/screens/HomeScreen.test.tsx`
Expected: FAIL — the redesigned sections don't exist yet.

- [ ] **Step 3: Implement**

Replace `frontend/src/screens/HomeScreen.tsx` in full:

```tsx
// frontend/src/screens/HomeScreen.tsx
import { useEffect, useState } from 'react';
import { Lightning, UserPlus, Flame, Star, Trophy } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { BattleAvatar } from '../components/BattleAvatar';
import { getMyStats } from '../api/stats';
import { getAchievements, Achievement, EarnedAchievement } from '../api/achievements';
import { getLevelProgress } from '../api/levelProgress';
import { getGlobalLeaderboard } from '../api/leaderboard';
import { findNextLevelToPlay } from '../utils/levelUnlock';
import { findRank } from '../utils/leaderboardRank';
import { Stats, LeaderboardEntry } from '../api/types';

const ACHIEVEMENT_BADGE_LIMIT = 5;
const LEADERBOARD_PREVIEW_SIZE = 3;

export function HomeScreen() {
  const { user, token } = useAuth();
  const { navigate } = useNavigation();
  const [stats, setStats] = useState<Stats | null>(null);
  const [catalog, setCatalog] = useState<Achievement[]>([]);
  const [earned, setEarned] = useState<EarnedAchievement[]>([]);
  const [nextLevel, setNextLevel] = useState<number | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);

  // Four independent fetches, none blocking the others - each section of
  // this screen degrades gracefully (simply doesn't render) if its own
  // fetch is still pending or fails, rather than the whole screen waiting
  // on the slowest one or crashing on one failure. Unlike LevelSelectScreen/
  // AchievementsScreen (which show a full-screen "Yuklanmoqda..." because
  // their ENTIRE content depends on one fetch), HomeScreen's two primary
  // CTA buttons must always be interactable immediately, even before any
  // of this data arrives.
  useEffect(() => {
    if (!token) return;

    getMyStats(token).then(setStats).catch(() => {});

    getAchievements(token)
      .then((res) => {
        setCatalog(res.catalog);
        setEarned(res.earned);
      })
      .catch(() => {});

    getLevelProgress(token)
      .then((res) => {
        const progressByLevel = new Map(res.progress.map((p) => [p.levelNumber, p.stars]));
        setNextLevel(findNextLevelToPlay(res.maxAvailableLevel, progressByLevel));
      })
      .catch(() => {});

    getGlobalLeaderboard(token)
      .then((res) => setLeaderboard(res.leaderboard))
      .catch(() => {});
  }, [token]);

  if (!user) return null;

  const catalogByKey = new Map(catalog.map((a) => [a.key, a]));
  const recentEarned = [...earned]
    .sort((a, b) => new Date(b.earnedAt).getTime() - new Date(a.earnedAt).getTime())
    .slice(0, ACHIEVEMENT_BADGE_LIMIT);

  const podium = leaderboard.slice(0, LEADERBOARD_PREVIEW_SIZE);
  const myRank = findRank(leaderboard, user.telegramId);
  const showOwnRankRow = myRank !== null && myRank > LEADERBOARD_PREVIEW_SIZE;

  return (
    <div className="flex min-h-full flex-col gap-5 p-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="flex items-center gap-3">
        <BattleAvatar telegramId={user.telegramId} size={44} />
        <span className="flex-1 truncate font-semibold text-ios-label">{user.firstName}</span>
        {stats && (
          <div className="flex shrink-0 items-center gap-3">
            <span className="flex items-center gap-1 text-sm font-bold text-ios-orange">
              <Flame size={16} weight="fill" />
              {stats.currentStreak}
            </span>
            <span className="flex items-center gap-1 text-sm font-bold text-ios-blue">
              <Star size={16} weight="fill" />
              {stats.rating}
            </span>
          </div>
        )}
      </div>

      {recentEarned.length > 0 && (
        <button
          type="button"
          onClick={() => navigate({ name: 'achievements' })}
          className="flex items-center gap-2 overflow-x-auto rounded-2xl bg-ios-card p-3 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]"
        >
          {recentEarned.map((e) => (
            <span
              key={e.key}
              className="shrink-0 rounded-full bg-ios-bg px-3 py-1 text-xs font-semibold text-ios-label"
            >
              {catalogByKey.get(e.key)?.label ?? e.key}
            </span>
          ))}
          <span className="ml-auto shrink-0 text-xs font-medium text-ios-blue">Hammasi</span>
        </button>
      )}

      {nextLevel !== null && (
        <button
          type="button"
          onClick={() => navigate({ name: 'levelSelect', intent: 'quick' })}
          className="flex items-center justify-between rounded-2xl bg-ios-card p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]"
        >
          <span className="text-sm font-medium text-ios-label">Davom etish: {nextLevel}-bosqich</span>
          <span className="text-sm font-semibold text-ios-blue">Boshlash</span>
        </button>
      )}

      <div className="flex flex-1 flex-col justify-center gap-3">
        <PrimaryButton shiny onClick={() => navigate({ name: 'levelSelect', intent: 'quick' })}>
          <span className="flex items-center justify-center gap-2">
            <Lightning size={20} weight="fill" />
            Tezkor o'yin
          </span>
        </PrimaryButton>
        <SecondaryButton onClick={() => navigate({ name: 'levelSelect', intent: 'invite' })}>
          <span className="flex items-center justify-center gap-2">
            <UserPlus size={20} weight="fill" />
            Do'stni chaqirish
          </span>
        </SecondaryButton>
      </div>

      {podium.length > 0 && (
        <button
          type="button"
          onClick={() => navigate({ name: 'leaderboard' })}
          className="flex flex-col gap-2 rounded-2xl bg-ios-card p-4 text-left shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]"
        >
          <span className="flex items-center gap-1 text-sm font-semibold text-ios-label">
            <Trophy size={16} weight="fill" className="text-ios-gold" />
            Top reyting
          </span>
          {podium.map((entry, index) => (
            <div key={entry.telegramId} className="flex items-center gap-2">
              <span className="w-4 text-xs font-bold tabular-nums text-ios-secondary-label">{index + 1}</span>
              <span className="flex-1 truncate text-sm text-ios-label">{entry.firstName}</span>
              <span className="text-sm font-semibold tabular-nums text-ios-label">{entry.rating}</span>
            </div>
          ))}
          {showOwnRankRow && (
            <div className="flex items-center gap-2 border-t border-ios-divider pt-2">
              <span className="w-4 text-xs font-bold tabular-nums text-ios-secondary-label">{myRank}</span>
              <span className="flex-1 truncate text-sm text-ios-label">{user.firstName}</span>
              <span className="text-sm font-semibold tabular-nums text-ios-label">{stats?.rating ?? ''}</span>
            </div>
          )}
        </button>
      )}
    </div>
  );
}
```

Verify `Trophy` exists as a named export of `@phosphor-icons/react` (very likely, given the package's broad icon set and this project's existing use of `Crown`/`Medal`/`Star` from the same package) — substitute the closest equivalent if not, and note the substitution.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/screens/HomeScreen.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 5: Run the full frontend suite and typecheck**

Run: `cd frontend && npx vitest run` — expect PASS. Pay particular attention to `App.test.tsx` — it mocks `HomeScreen`'s dependencies only indirectly (via `GameSocketContext`/`AuthContext` mocks) and asserts `screen.getByText("Tezkor o'yin")` is present as a proxy for "home screen rendered" — since this task doesn't remove or rename that button, those assertions should keep passing, but the new `useEffect`-driven fetches (`getMyStats`/`getAchievements`/`getLevelProgress`/`getGlobalLeaderboard`) will genuinely fire during `App.test.tsx`'s real (unmocked) `HomeScreen` renders and hit the real `apiGet`/`fetch` — since `App.test.tsx` doesn't mock these API modules, confirm this doesn't cause unhandled rejections or console noise that fails the test; if it does, `App.test.tsx` needs `vi.spyOn` mocks added for these four API functions (mirroring how it already handles other cross-cutting concerns) - read the actual test run output and adapt if needed, this is a plausible integration wrinkle the plan can't fully predict from static reading alone.

Run: `cd frontend && npx tsc --noEmit` — expect clean

- [ ] **Step 6: Commit**

```bash
cd frontend
git add src/screens/HomeScreen.tsx src/screens/HomeScreen.test.tsx
git commit -m "Redesign HomeScreen: HUD, achievement badges, continue shortcut, mini leaderboard"
```

If Step 5 revealed `App.test.tsx` needed adjustment, include that file in this same commit with a brief note in the report explaining what broke and how it was fixed.

---

### Task 10: Frontend — "new achievement!" reveal on `ResultScreen`

**Files:**
- Create: `frontend/src/utils/achievementSeen.ts`
- Create: `frontend/src/utils/achievementSeen.test.ts`
- Modify: `frontend/src/screens/ResultScreen.tsx`
- Modify: `frontend/src/screens/ResultScreen.test.tsx`

- [ ] **Step 1: Write the failing tests for the localStorage util**

Create `frontend/src/utils/achievementSeen.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { findAndMarkNewlySeenAchievements } from './achievementSeen';

describe('findAndMarkNewlySeenAchievements', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns all keys as newly seen the first time, and marks them', () => {
    const newly = findAndMarkNewlySeenAchievements(['games_1', 'streak_3']);
    expect(newly.sort()).toEqual(['games_1', 'streak_3']);
  });

  it('does not re-report an already-seen key on a later call', () => {
    findAndMarkNewlySeenAchievements(['games_1']);
    const secondCall = findAndMarkNewlySeenAchievements(['games_1']);
    expect(secondCall).toEqual([]);
  });

  it('reports only the genuinely new key when mixed with an already-seen one', () => {
    findAndMarkNewlySeenAchievements(['games_1']);
    const secondCall = findAndMarkNewlySeenAchievements(['games_1', 'streak_3']);
    expect(secondCall).toEqual(['streak_3']);
  });

  it('returns an empty array for an empty input without touching storage', () => {
    expect(findAndMarkNewlySeenAchievements([])).toEqual([]);
    expect(localStorage.getItem('bilimbattle:seenAchievements')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/utils/achievementSeen.test.ts`
Expected: FAIL — `frontend/src/utils/achievementSeen.ts` doesn't exist yet.

- [ ] **Step 3: Implement the util**

Create `frontend/src/utils/achievementSeen.ts`:

```ts
// frontend/src/utils/achievementSeen.ts
// Shared source of truth for which achievement keys this device has already
// shown a "yangi nishon!" reveal for - mirrors utils/settings.ts's SOUND_KEY
// pattern (one exported key, try/catch around localStorage access since
// it's unavailable in some private-mode/restricted WebView contexts).
const SEEN_KEY = 'bilimbattle:seenAchievements';

function readSeenKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

// Given the full set of currently-earned achievement keys, returns which
// ones this device has never shown a reveal for, and marks all of
// `earnedKeys` as seen for next time - a single combined read-diff-write,
// so callers can't forget the "mark as seen" step by only calling a
// separate query function.
export function findAndMarkNewlySeenAchievements(earnedKeys: string[]): string[] {
  const seen = readSeenKeys();
  const newlySeen = earnedKeys.filter((key) => !seen.has(key));
  if (newlySeen.length === 0) return [];
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, ...newlySeen]));
  } catch {
    // Storage unavailable - the reveal still shows this once, just might
    // repeat on a future visit; not worth surfacing an error over.
  }
  return newlySeen;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/utils/achievementSeen.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Write the failing tests for `ResultScreen`**

Read the ACTUAL current `frontend/src/screens/ResultScreen.tsx` and `frontend/src/screens/ResultScreen.test.tsx` in full first (this file has real, load-bearing existing logic — `calculateStars`/`victory-stars`/the `isLevelResult` early-return branch — that must not be disturbed). Confirm the existing `useAuth` mock in the test file already includes a `token` field; if not, add `token: 'tok'` to every `vi.spyOn(authContext, 'useAuth').mockReturnValue({...})` call in the file (the component will need `token` from Step 7 below).

Add this import to the top of `ResultScreen.test.tsx`:
```ts
import * as achievementsApi from '../api/achievements';
```

Add these tests to the file (adapt the exact `describe`/mock-setup boilerplate to match this file's real existing conventions — the snippets below assume `render(<ResultScreen .../>)` works the same way the file's existing tests already call it):

```tsx
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

  it('does not show a banner when there is nothing newly earned', async () => {
    localStorage.clear();
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({ catalog: [], earned: [] });

    render(<ResultScreen scores={[]} winnerId={null} forfeited={false} knockout={false} level={5} />);

    await waitFor(() => expect(achievementsApi.getAchievements).toHaveBeenCalled());
    expect(screen.queryByText(/Yangi nishon/)).not.toBeInTheDocument();
  });

  it('does not re-show a banner for an achievement already seen on a previous visit', async () => {
    localStorage.setItem('bilimbattle:seenAchievements', JSON.stringify(['games_1']));
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [{ key: 'games_1', category: 'games', label: 'Birinchi qadam', description: '...' }],
      earned: [{ key: 'games_1', earnedAt: '2026-07-14T00:00:00.000Z' }],
    });

    render(<ResultScreen scores={[]} winnerId={null} forfeited={false} knockout={false} level={5} />);

    await waitFor(() => expect(achievementsApi.getAchievements).toHaveBeenCalled());
    expect(screen.queryByText(/Yangi nishon/)).not.toBeInTheDocument();
  });
```

Confirm `waitFor` is already imported in this test file from `@testing-library/react` (it should be, or add it to the existing `import { render, screen, ... } from '@testing-library/react';` line).

- [ ] **Step 6: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/screens/ResultScreen.test.tsx -t "nishon"`
Expected: FAIL — `ResultScreen` doesn't fetch achievements or render a banner yet.

- [ ] **Step 7: Implement**

In `frontend/src/screens/ResultScreen.tsx`:

1. Change the React import to include `useState`:
```ts
import { useEffect, useState } from 'react';
```
(replacing the existing `import { useEffect } from 'react';` line)

2. Add the two new imports:
```ts
import { getAchievements } from '../api/achievements';
import { findAndMarkNewlySeenAchievements } from '../utils/achievementSeen';
```

3. Change `const { user } = useAuth();` to also destructure `token`:
```ts
  const { user, token } = useAuth();
```

4. Add a new state and effect, placed right after the existing sound-effect `useEffect` (the one calling `playResultFeedback`) and BEFORE the `if (!user) return null;` guard (hooks must run unconditionally on every render, same reasoning as the existing effect's own comment):
```ts
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

5. In the `isLevelResult` branch's return JSX, add the banner as the first child inside the outer `<div className="flex min-h-full flex-col justify-center gap-8 p-6">`, right before the existing result card `<div className="flex flex-col items-center gap-3 rounded-2xl bg-ios-card ...">`:
```tsx
        {newAchievementLabel && (
          <div className="animate-star-pop rounded-2xl bg-ios-gold/10 px-4 py-3 text-center text-sm font-semibold text-ios-label">
            🏆 Yangi nishon: {newAchievementLabel}
          </div>
        )}
```

6. Add the exact same JSX snippet as the first child inside the SECOND (non-level) return's outer `<div className="flex min-h-full flex-col justify-center gap-8 p-6">`, right before that branch's own result card div.

Read the real current file to find the two exact insertion points (both outer `<div>`s are easy to spot — one is inside the `if (isLevelResult) { return ( ... ) }` block, the other is the function's final `return ( ... )`), and confirm you're not disturbing `calculateStars`, `handlePlayAgain`, `showStars`, `resultColor`, or any other existing logic.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/screens/ResultScreen.test.tsx`
Expected: PASS (all tests, both new and every pre-existing one — the existing `victory-stars`/`level-stars` tests and win/lose/draw logic must be completely unaffected)

- [ ] **Step 9: Run the full frontend suite and typecheck**

Run: `cd frontend && npx vitest run` — expect PASS
Run: `cd frontend && npx tsc --noEmit` — expect clean

- [ ] **Step 10: Commit**

```bash
cd frontend
git add src/utils/achievementSeen.ts src/utils/achievementSeen.test.ts src/screens/ResultScreen.tsx src/screens/ResultScreen.test.tsx
git commit -m "Show a 'new achievement!' reveal on ResultScreen via a client-side seen-cache diff"
```

---

## After all 10 tasks

Run the full verification sweep once more (`backend`: `npx jest`, `npx tsc --noEmit`; `frontend`: `npx vitest run`, `npx tsc --noEmit && npm run build`), then dispatch a final holistic reviewer re-checking:
- `gameEngine.ts`'s existing knockout logic, socket payloads, and matchmaking are genuinely untouched beyond the two additive achievement-check call sites (Task 3) — the whole design depends on NOT modifying the `game_over` payload or `useGameSocket.ts`.
- The `level_perfect` vs. `level_10`/`level_50`/`level_100` threshold-confusion risk (both spec and Task 2's regression test call this out explicitly) stays correctly separated end-to-end — re-verify with the real numbers, not just the unit test's small fixture.
- `LevelSelectScreen.tsx`'s behavior is genuinely unchanged after Task 5's extraction (same unlock/lock rendering, same tests passing unmodified).
- `HomeScreen`'s four independent fetches (Task 9) each degrade gracefully on failure — confirm by reading the actual final code, not just the plan's intent, that a rejected promise from any one of `getMyStats`/`getAchievements`/`getLevelProgress`/`getGlobalLeaderboard` can never crash the whole screen or block the two CTA buttons from being clickable.
- The `user_achievements` table and `GET /achievements` correctly scope to the requesting user only (no cross-user leakage) — re-confirm via the actual SQL, not just the route handler's intent.

Then use `superpowers:finishing-a-development-branch` as usual for this project (working directly on `master`, so this reduces to: verify, then offer to push). No manual/destructive data migration is needed for this feature (unlike the CEFR vocabulary plan) — `user_achievements` starts empty and fills in naturally as players complete matches; nothing needs backfilling for existing users' historical games (their `games_played`/`current_streak`/`rating`/`level_progress` will simply cross new thresholds the next time they play, awarding retroactively-relevant achievements at that point — this is an accepted, intentional simplification, not a gap to fix).
