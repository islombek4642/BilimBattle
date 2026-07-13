# Bosqichli rejim (Level Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a numbered-level, star-rated 1v1 game mode for the "Ingliz tili" category, reusing the existing matchmaking/gameEngine infrastructure with knockout disabled, and remove category selection from all player- and admin-facing UI.

**Architecture:** A new optional `level` dimension threads through the existing queue/matchmaker/gameEngine (as a synthetic queue key and a `GameState.level` field), never touching the existing category-based code paths. A new `level_progress` table tracks each user's best star result per level. Category selection screens/UI are deleted; both "Tezkor o'yin" and "Do'stni chaqirish" now go through a new `LevelSelectScreen`.

**Tech Stack:** Backend: Node/TS/Express/Socket.io/Postgres/Redis, Jest (real local Postgres/Redis per `backend/.env`). Frontend: Vite/React/TS/Vitest/RTL, Tailwind.

**Design spec:** `docs/superpowers/specs/2026-07-14-level-mode-design.md`

---

### Task 1: Backend — `level_progress` table

**Files:**
- Modify: `backend/src/db/schema.sql`

- [ ] **Step 1: Add the table**

In `backend/src/db/schema.sql`, add after the `matches` table definition (before the `CREATE INDEX`/`DROP INDEX` lines at the bottom):

```sql
CREATE TABLE IF NOT EXISTS level_progress (
  user_id INTEGER NOT NULL REFERENCES users(id),
  level_number INTEGER NOT NULL,
  stars SMALLINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, level_number)
);
```

- [ ] **Step 2: Apply the schema to your local dev database**

Run: `cd backend && npm run migrate`
Expected: `Migration applied successfully.`

- [ ] **Step 3: Verify the table exists**

Run a quick check (e.g. via a throwaway Node script using `pool`, or `psql` if available) that `SELECT * FROM level_progress LIMIT 1;` succeeds (returns 0 rows, no error). Do not leave any throwaway script in the repo.

- [ ] **Step 4: Commit**

```bash
cd backend
git add src/db/schema.sql
git commit -m "Add level_progress table"
```

---

### Task 2: Backend — `levelProgress.ts` module (stars, unlock rules, persistence)

**Files:**
- Create: `backend/src/game/levelProgress.ts`
- Create: `backend/tests/game/levelProgress.test.ts`

This module holds everything specific to level-mode progress: pure star/unlock-rule calculations, and the DB access for the new `level_progress` table.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/game/levelProgress.test.ts`:

```ts
import { pool } from '../../src/config/db';
import { upsertUser } from '../../src/users/userRepository';
import {
  calculateLevelStars,
  isLevelUnlocked,
  upsertLevelProgress,
  getLevelProgressForUser,
  isLevelUnlockedForUser,
} from '../../src/game/levelProgress';

describe('calculateLevelStars', () => {
  it('returns the correct star count for every threshold boundary (out of 15 questions)', () => {
    expect(calculateLevelStars(0)).toBe(0);
    expect(calculateLevelStars(7)).toBe(0);
    expect(calculateLevelStars(8)).toBe(1);
    expect(calculateLevelStars(10)).toBe(1);
    expect(calculateLevelStars(11)).toBe(2);
    expect(calculateLevelStars(13)).toBe(2);
    expect(calculateLevelStars(14)).toBe(3);
    expect(calculateLevelStars(15)).toBe(3);
  });
});

describe('isLevelUnlocked', () => {
  it('level 1 is always unlocked, regardless of progress', () => {
    expect(isLevelUnlocked(1, new Map())).toBe(true);
  });

  it('a non-stage-boundary level unlocks once the previous level has at least 2 stars', () => {
    expect(isLevelUnlocked(4, new Map([[3, 2]]))).toBe(true);
    expect(isLevelUnlocked(4, new Map([[3, 3]]))).toBe(true);
    expect(isLevelUnlocked(4, new Map([[3, 1]]))).toBe(false);
    expect(isLevelUnlocked(4, new Map([[3, 0]]))).toBe(false);
    expect(isLevelUnlocked(4, new Map())).toBe(false); // level 3 never played
  });

  it('the first level of a new stage (11, 21, ...) requires >=25 total stars across the previous stage\'s 10 levels', () => {
    const barelyEnough = new Map<number, number>();
    for (let i = 1; i <= 9; i += 1) barelyEnough.set(i, 2); // 18
    barelyEnough.set(10, 3); // 18 + 3 = 21, still short of 25
    expect(isLevelUnlocked(11, barelyEnough)).toBe(false);

    const enough = new Map<number, number>();
    for (let i = 1; i <= 8; i += 1) enough.set(i, 3); // 24
    enough.set(9, 1); // 25
    enough.set(10, 0);
    expect(isLevelUnlocked(11, enough)).toBe(true);
  });

  it('a mid-stage level (e.g. 12) still uses the simple previous-level->=2-stars rule, not the stage total', () => {
    expect(isLevelUnlocked(12, new Map([[11, 2]]))).toBe(true);
    expect(isLevelUnlocked(12, new Map([[11, 1]]))).toBe(false);
  });
});

describe('upsertLevelProgress / getLevelProgressForUser', () => {
  let userId: number;

  beforeAll(async () => {
    const user = await upsertUser(881001, 'levelProgressTestUser', 'LevelTest', null);
    userId = user.id;
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM level_progress WHERE user_id = $1`, [userId]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id = 881001`);
  });

  it('creates a new row on first upsert', async () => {
    await upsertLevelProgress(userId, 3, 2);
    const progress = await getLevelProgressForUser(userId);
    expect(progress).toEqual([{ levelNumber: 3, stars: 2 }]);
  });

  it('keeps the best (highest) star count on repeated upserts, never downgrades', async () => {
    await upsertLevelProgress(userId, 5, 2);
    await upsertLevelProgress(userId, 5, 1); // worse replay - should NOT overwrite
    let progress = await getLevelProgressForUser(userId);
    expect(progress).toEqual([{ levelNumber: 5, stars: 2 }]);

    await upsertLevelProgress(userId, 5, 3); // better replay - should overwrite
    progress = await getLevelProgressForUser(userId);
    expect(progress).toEqual([{ levelNumber: 5, stars: 3 }]);
  });

  it('returns all of a user\'s progress rows', async () => {
    await upsertLevelProgress(userId, 1, 3);
    await upsertLevelProgress(userId, 2, 1);
    const progress = await getLevelProgressForUser(userId);
    expect(progress.sort((a, b) => a.levelNumber - b.levelNumber)).toEqual([
      { levelNumber: 1, stars: 3 },
      { levelNumber: 2, stars: 1 },
    ]);
  });
});

describe('isLevelUnlockedForUser', () => {
  let userId: number;

  beforeAll(async () => {
    const user = await upsertUser(881002, 'levelUnlockTestUser', 'LevelUnlockTest', null);
    userId = user.id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM level_progress WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM users WHERE telegram_id = 881002`);
  });

  it('level 1 is unlocked for a brand new user with zero progress', async () => {
    expect(await isLevelUnlockedForUser(userId, 1)).toBe(true);
  });

  it('level 2 is locked until level 1 has >=2 stars', async () => {
    expect(await isLevelUnlockedForUser(userId, 2)).toBe(false);
    await upsertLevelProgress(userId, 1, 2);
    expect(await isLevelUnlockedForUser(userId, 2)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest tests/game/levelProgress.test.ts`
Expected: FAIL — `backend/src/game/levelProgress.ts` doesn't exist yet.

- [ ] **Step 3: Implement the module**

Create `backend/src/game/levelProgress.ts`:

```ts
// backend/src/game/levelProgress.ts
import { pool } from '../config/db';

export const QUESTIONS_PER_LEVEL = 15;
export const LEVELS_PER_STAGE = 10;
export const STAGE_UNLOCK_STARS_REQUIRED = 25;
export const LEVEL_UNLOCK_STARS_REQUIRED = 2;

export function calculateLevelStars(correctCount: number): number {
  if (correctCount >= 14) return 3;
  if (correctCount >= 11) return 2;
  if (correctCount >= 8) return 1;
  return 0;
}

// `progressByLevel` maps levelNumber -> stars for levels the user has
// actually played; a level with no entry is treated as never-played (0
// stars, for stage-total purposes) / not-yet-unlocked (for the
// previous-level check).
export function isLevelUnlocked(level: number, progressByLevel: Map<number, number>): boolean {
  if (level === 1) return true;

  const isFirstOfStage = (level - 1) % LEVELS_PER_STAGE === 0; // 11, 21, 31...
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

export interface LevelProgressEntry {
  levelNumber: number;
  stars: number;
}

export async function upsertLevelProgress(userId: number, levelNumber: number, stars: number): Promise<void> {
  await pool.query(
    `INSERT INTO level_progress (user_id, level_number, stars)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, level_number)
     DO UPDATE SET stars = GREATEST(level_progress.stars, EXCLUDED.stars), updated_at = now()`,
    [userId, levelNumber, stars]
  );
}

export async function getLevelProgressForUser(userId: number): Promise<LevelProgressEntry[]> {
  const result = await pool.query<{ level_number: number; stars: number }>(
    `SELECT level_number, stars FROM level_progress WHERE user_id = $1`,
    [userId]
  );
  return result.rows.map((row) => ({ levelNumber: row.level_number, stars: row.stars }));
}

export async function isLevelUnlockedForUser(userId: number, level: number): Promise<boolean> {
  const progress = await getLevelProgressForUser(userId);
  const progressByLevel = new Map(progress.map((p) => [p.levelNumber, p.stars]));
  return isLevelUnlocked(level, progressByLevel);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/game/levelProgress.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Run the full backend suite and typecheck**

Run: `cd backend && npx jest`
Expected: PASS (note: this suite has known pre-existing, unrelated flakiness in `tests/matchmaking/matchmaker.test.ts`/`tests/matchmaking/concurrent-join.test.ts`/`tests/admin/statsQueries.test.ts` caused by parallel Jest workers sharing one real Postgres database — if you see a failure ONLY in one of those files, re-run once or twice to confirm it's not a real regression)

Run: `cd backend && npx tsc --noEmit`
Expected: clean, zero errors

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/game/levelProgress.ts tests/game/levelProgress.test.ts
git commit -m "Add levelProgress module: star calculation, unlock rules, persistence"
```

---

### Task 3: Backend — level-to-question mapping in `questionRepository.ts`

**Files:**
- Modify: `backend/src/questions/questionRepository.ts`
- Modify: `backend/tests/questions/questionRepository.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/questions/questionRepository.test.ts`, inside the existing `describe('questionRepository', ...)` block:

```ts
  describe('getQuestionsForLevel / maxAvailableLevel', () => {
    it('returns 15 sequential questions for level 1 starting at the category\'s lowest id', async () => {
      const level1 = await getQuestionsForLevel(1);
      expect(level1.length).toBe(15);
    });

    it('returns a DIFFERENT 15-question set for level 2 than for level 1 (no overlap)', async () => {
      const level1 = await getQuestionsForLevel(1);
      const level2 = await getQuestionsForLevel(2);
      const level1Ids = new Set(level1.map((q) => q.id));
      const overlap = level2.filter((q) => level1Ids.has(q.id));
      expect(overlap.length).toBe(0);
    });

    it('returns the exact same 15 questions when called again for the same level (deterministic, unlike getRandomQuestions)', async () => {
      const first = await getQuestionsForLevel(5);
      const second = await getQuestionsForLevel(5);
      expect(first.map((q) => q.id)).toEqual(second.map((q) => q.id));
    });

    it('maxAvailableLevel reflects the real ingliz_tili question count (floor(count / 15))', async () => {
      const countResult = await pool.query(`SELECT COUNT(*) FROM questions WHERE category = 'ingliz_tili'`);
      const expected = Math.floor(Number(countResult.rows[0].count) / 15);
      expect(await maxAvailableLevel()).toBe(expected);
    });
  });
```

Add `getQuestionsForLevel, maxAvailableLevel` to the existing import line at the top of the test file (alongside `getRandomQuestions`, etc.).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest tests/questions/questionRepository.test.ts -t "getQuestionsForLevel"`
Expected: FAIL — `getQuestionsForLevel`/`maxAvailableLevel` don't exist yet.

- [ ] **Step 3: Implement**

In `backend/src/questions/questionRepository.ts`, add near the bottom of the file (after `getRandomQuestions`):

```ts
const LEVEL_CATEGORY_KEY = 'ingliz_tili';

// Deterministic (unlike getRandomQuestions' random-id-window): level N always
// maps to the same 15-question slice, since the level-mode design requires
// both matched players (and any future replay) to see the identical
// question set for a given level number. idx_questions_category_id makes
// this an efficient index range scan, not a full sort - see the design
// spec's note on OFFSET cost at very high level numbers (not a concern at
// today's scale).
export async function getQuestionsForLevel(level: number): Promise<QuestionRecord[]> {
  const offset = (level - 1) * LEVEL_QUESTION_COUNT;
  const result = await pool.query<QuestionRow>(
    `SELECT id, question_text, options, correct_index, extra_definitions
     FROM questions WHERE category = $1 ORDER BY id ASC OFFSET $2 LIMIT $3`,
    [LEVEL_CATEGORY_KEY, offset, LEVEL_QUESTION_COUNT]
  );
  return result.rows.map(toQuestionRecord);
}

export async function maxAvailableLevel(): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*) FROM questions WHERE category = $1`,
    [LEVEL_CATEGORY_KEY]
  );
  return Math.floor(Number(result.rows[0].count) / LEVEL_QUESTION_COUNT);
}
```

Add this constant near the top of the file, alongside the other exports. Note this is a DIFFERENT, independently-defined constant from `levelProgress.ts`'s exported `QUESTIONS_PER_LEVEL` (same value, deliberately not imported — importing it would create a dependency from `questions/` on `game/`, the wrong direction; this file has no dependency on `game/` today and should stay that way), named differently on purpose so nobody mistakes them for the same shared constant:

```ts
const LEVEL_QUESTION_COUNT = 15;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/questions/questionRepository.test.ts`
Expected: PASS (all tests, including the new ones)

- [ ] **Step 5: Run the full backend suite and typecheck**

Run: `cd backend && npx jest` — expect PASS (accounting for known flakiness noted in Task 2)
Run: `cd backend && npx tsc --noEmit` — expect clean

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/questions/questionRepository.ts tests/questions/questionRepository.test.ts
git commit -m "Add getQuestionsForLevel and maxAvailableLevel to questionRepository"
```

---

### Task 4: Backend — `GameState.level` + level-aware question fetch + disable knockout

**Files:**
- Modify: `backend/src/game/gameState.ts`
- Modify: `backend/src/game/gameEngine.ts`
- Modify: `backend/tests/game/gameEngine.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/game/gameEngine.test.ts` inside the existing `describe('gameEngine full match flow', ...)` block (this file already has `createFakeIO()`, `player1Id`/`player2Id` from `beforeAll`, and `questionRepository` imported as `import * as questionRepository from '../../src/questions/questionRepository';` — reuse these; if any of these don't exist exactly as described, read the file first and adapt to what's actually there):

```ts
  it('uses getQuestionsForLevel (not getRandomQuestions) and stores level on GameState when startGame is called with a level', async () => {
    const gameId = randomUUID();
    const { fakeIO } = createFakeIO();
    setIOForTesting(fakeIO as any);

    const fixtureQuestions = Array.from({ length: 15 }, (_, i) => ({
      id: 900000 + i,
      text: `LEVEL_TEST_Q${i}`,
      options: ['a', 'b', 'c', 'd'],
      correctIndex: 0,
    }));
    const getQuestionsForLevelSpy = jest
      .spyOn(questionRepository, 'getQuestionsForLevel')
      .mockResolvedValueOnce(fixtureQuestions);
    const getRandomQuestionsSpy = jest.spyOn(questionRepository, 'getRandomQuestions');

    await startGame(gameId, 'ingliz_tili', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' }, undefined, 7);

    expect(getQuestionsForLevelSpy).toHaveBeenCalledWith(7);
    expect(getRandomQuestionsSpy).not.toHaveBeenCalled();

    const game = await getGame(gameId);
    expect(game?.level).toBe(7);

    getQuestionsForLevelSpy.mockRestore();
    getRandomQuestionsSpy.mockRestore();
    await deleteGame(gameId);
  });

  it('never ends a level-mode game early via knockout, even if a player\'s score reaches HP_MAX', async () => {
    const gameId = randomUUID();
    const { fakeIO, events } = createFakeIO();
    setIOForTesting(fakeIO as any);

    // A single fixture question worth enough points on its own to cross
    // HP_MAX (500) if this were a non-level game - proves the knockout
    // check is skipped specifically because game.level is set, not because
    // the score genuinely never got high enough to trigger it.
    const getQuestionsForLevelSpy = jest.spyOn(questionRepository, 'getQuestionsForLevel').mockResolvedValueOnce([
      { id: 900100, text: 'LEVEL_TEST_KO', options: ['a', 'b', 'c', 'd'], correctIndex: 0 },
    ]);

    await startGame(gameId, 'ingliz_tili', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' }, undefined, 3);
    await submitAnswer(gameId, player1Id, 0, 0); // instant correct answer = max speed bonus, well over HP_MAX alone is not guaranteed by a single question, but the point here is the game must NOT finish after just this one question regardless of score
    await submitAnswer(gameId, player2Id, 1, 0); // incorrect

    const gameOverEvents = events.filter((e) => e.event === 'game_over');
    expect(gameOverEvents.length).toBe(0); // did not end early - only 1 of 1 questions has been answered, so it SHOULD actually finish here since the pool is exhausted, not because of knockout

    getQuestionsForLevelSpy.mockRestore();
  });
```

Note on the second test: with only 1 question in the level's fixture pool, the match legitimately ends after that question because the pool is exhausted (`sendNextQuestion`'s existing `currentQuestionIndex >= game.questions.length` check), NOT because of knockout — this test's real assertion is elsewhere; see Step 3's implementation for how to verify knockout specifically was skipped. Replace the above second test with this corrected version instead, which uses a larger fixture pool so the "pool exhausted" path can't fire and only the "knockout" path could have ended it early if it weren't disabled:

```ts
  it('never ends a level-mode game early via knockout, even if a player\'s score reaches HP_MAX', async () => {
    const gameId = randomUUID();
    const { fakeIO, events } = createFakeIO();
    setIOForTesting(fakeIO as any);

    // 15 fixture questions (matches a real level's pool size) so the match
    // can only end early via knockout, never via "pool exhausted" - proving
    // the knockout check specifically is what's being skipped.
    const fixtureQuestions = Array.from({ length: 15 }, (_, i) => ({
      id: 900200 + i,
      text: `LEVEL_TEST_NOKO${i}`,
      options: ['a', 'b', 'c', 'd'],
      correctIndex: 0,
    }));
    const getQuestionsForLevelSpy = jest
      .spyOn(questionRepository, 'getQuestionsForLevel')
      .mockResolvedValueOnce(fixtureQuestions);

    await startGame(gameId, 'ingliz_tili', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' }, undefined, 4);

    // Answer instantly and correctly every round - the fastest possible way
    // to cross HP_MAX=500 in a normal (non-level) game is well within a
    // handful of max-speed-bonus correct answers (BASE_CORRECT_POINTS=100 +
    // up to MAX_SPEED_BONUS=100 per question), so after several rounds
    // player1's score would trigger a knockout in a non-level game.
    for (let round = 0; round < 6; round += 1) {
      await submitAnswer(gameId, player1Id, 0, round);
      await submitAnswer(gameId, player2Id, 1, round);
    }

    const gameOverEvents = events.filter((e) => e.event === 'game_over');
    expect(gameOverEvents.length).toBe(0); // still going after 6/15 rounds - a non-level game would very likely have knocked out by now

    getQuestionsForLevelSpy.mockRestore();
    await deleteGame(gameId);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest tests/game/gameEngine.test.ts -t "level"`
Expected: FAIL — `startGame` doesn't accept a `level` parameter yet, `GameState` has no `level` field, `getQuestionsForLevel` isn't called by `startGame`.

- [ ] **Step 3: Implement**

In `backend/src/game/gameState.ts`, add to the `GameState` interface:

```ts
export interface GameState {
  gameId: string;
  category: string;
  questions: QuestionRecord[];
  currentQuestionIndex: number;
  questionStartedAt?: number;
  players: [PlayerState, PlayerState];
  status: 'active' | 'finished';
  botDisplayName?: string;
  // Only set for level-mode matches (see matchmaking/matchmaker.ts's
  // handleJoinLevelQueue). Its presence is what gameEngine.ts's
  // resolveQuestion() checks to skip the knockout early-ending entirely -
  // level-mode matches always play through the full question pool.
  level?: number;
}
```

In `backend/src/game/gameEngine.ts`:

1. Add the import:
```ts
import { getRandomQuestions, getQuestionsForLevel, QuestionRecord } from '../questions/questionRepository';
```
(replacing the existing `import { getRandomQuestions, QuestionRecord } from '../questions/questionRepository';` line)

2. Change `startGame`'s signature and body:
```ts
export async function startGame(
  gameId: string,
  category: string,
  player1: PlayerInfo,
  player2: PlayerInfo,
  botDisplayName?: string,
  level?: number
): Promise<void> {
  const questions = level != null ? await getQuestionsForLevel(level) : await getRandomQuestions(category, QUESTIONS_PER_GAME);
  const game: GameState = {
    gameId,
    category,
    questions,
    currentQuestionIndex: -1,
    players: [
      { userId: player1.userId, socketId: player1.socketId, score: 0, answers: [], isBot: player1.isBot ?? false },
      { userId: player2.userId, socketId: player2.socketId, score: 0, answers: [], isBot: player2.isBot ?? false },
    ],
    status: 'active',
    botDisplayName,
    ...(level != null ? { level } : {}),
  };
  await saveGame(game);
  await sendNextQuestion(gameId);
}
```

3. Change `resolveQuestion`'s knockout check (currently unconditional) to skip entirely for level-mode games:
```ts
  // A player's score reaching HP_MAX means the OPPONENT's derived HP has
  // reached 0 - end the match right now instead of waiting for the
  // remaining questions. If both players cross HP_MAX in the very same
  // round (both answered this question correctly), finishGame's existing
  // winner-determination logic (higher score wins, exact tie = draw)
  // handles it correctly with no extra logic needed here.
  //
  // Level-mode games (game.level set) never knock out - the whole point of
  // the mode is to always play through the full 15-question level and
  // score stars on the player's own correct-answer count, not to end early
  // on a relative score swing.
  if (!game.level) {
    const anyoneKnockedOut = game.players.some((p) => p.score >= HP_MAX);
    if (anyoneKnockedOut) {
      await finishGame(gameId, { knockout: true });
      return;
    }
  }

  await sendNextQuestion(gameId);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/game/gameEngine.test.ts`
Expected: PASS (all tests, including the 2 new ones)

- [ ] **Step 5: Run the full backend suite and typecheck**

Run: `cd backend && npx jest` — expect PASS (accounting for known flakiness)
Run: `cd backend && npx tsc --noEmit` — expect clean

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/game/gameState.ts src/game/gameEngine.ts tests/game/gameEngine.test.ts
git commit -m "Add level-aware question fetch and disable knockout for level-mode games"
```

---

### Task 5: Backend — per-player star calculation and persistence in `finishGame`

**Files:**
- Modify: `backend/src/game/gameEngine.ts`
- Modify: `backend/tests/game/gameEngine.test.ts`

This is the task that actually awards and saves stars when a level-mode match completes. It also changes how `game_over` is delivered for level-mode games: each player needs THEIR OWN `levelStars` value (based on their own correct-answer count), so the payload can no longer be identical for both — `finishGame` sends a per-socket emit for level-mode games instead of one identical room broadcast.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/game/gameEngine.test.ts`, inside `describe('gameEngine full match flow', ...)`:

```ts
  it('awards independent stars to each player based on their OWN correct-answer count, and persists to level_progress', async () => {
    const gameId = randomUUID();
    const { fakeIO } = createFakeIO();
    setIOForTesting(fakeIO as any);

    // 15 fixture questions, all with correctIndex 0.
    const fixtureQuestions = Array.from({ length: 15 }, (_, i) => ({
      id: 900300 + i,
      text: `LEVEL_TEST_STARS${i}`,
      options: ['a', 'b', 'c', 'd'],
      correctIndex: 0,
    }));
    const getQuestionsForLevelSpy = jest
      .spyOn(questionRepository, 'getQuestionsForLevel')
      .mockResolvedValueOnce(fixtureQuestions);

    await startGame(gameId, 'ingliz_tili', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' }, undefined, 9);

    // player1 answers correctly (index 0) every round -> 15/15 correct -> 3 stars.
    // player2 answers incorrectly (index 1) every round -> 0/15 correct -> 0 stars.
    for (let round = 0; round < 15; round += 1) {
      await submitAnswer(gameId, player1Id, 0, round);
      await submitAnswer(gameId, player2Id, 1, round);
    }

    const progress1 = await getLevelProgressForUser(player1Id);
    const progress2 = await getLevelProgressForUser(player2Id);
    expect(progress1.find((p) => p.levelNumber === 9)?.stars).toBe(3);
    expect(progress2.find((p) => p.levelNumber === 9)?.stars).toBe(0);

    getQuestionsForLevelSpy.mockRestore();
    await pool.query(`DELETE FROM level_progress WHERE level_number = 9 AND user_id IN ($1, $2)`, [player1Id, player2Id]);
  });

  it('emits a per-socket game_over with each recipient\'s OWN levelStars for a level-mode game', async () => {
    const gameId = randomUUID();
    const { fakeIO, events } = createFakeIO();
    setIOForTesting(fakeIO as any);

    const fixtureQuestions = Array.from({ length: 15 }, (_, i) => ({
      id: 900400 + i,
      text: `LEVEL_TEST_EMIT${i}`,
      options: ['a', 'b', 'c', 'd'],
      correctIndex: 0,
    }));
    const getQuestionsForLevelSpy = jest
      .spyOn(questionRepository, 'getQuestionsForLevel')
      .mockResolvedValueOnce(fixtureQuestions);

    await startGame(gameId, 'ingliz_tili', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' }, undefined, 10);

    for (let round = 0; round < 15; round += 1) {
      await submitAnswer(gameId, player1Id, 0, round); // always correct
      await submitAnswer(gameId, player2Id, 1, round); // always wrong
    }

    // createFakeIO's sockets map is keyed by socketId and auto-vivifies -
    // both 'sock1' and 'sock2' should each have received their OWN game_over.
    const gameOverEvents = events.filter((e) => e.event === 'game_over');
    // The fake IO harness records events with a `room` field (the socketId
    // or gameId this was sent to, depending on whether `.to(room).emit` or
    // a specific socket's `.emit` was used) - inspect what's actually
    // recorded to confirm two DISTINCT payloads went out, one per socket,
    // rather than one broadcast payload. If createFakeIO's shape differs
    // from what's assumed here, read the actual helper and adapt this
    // assertion to genuinely prove per-socket delivery with different
    // levelStars values, which is the real behavior under test.
    expect(gameOverEvents.length).toBe(2);
    const stars = gameOverEvents.map((e) => (e.payload as { levelStars?: number }).levelStars);
    expect(stars.sort()).toEqual([0, 3]); // player2 got 0, player1 got 3 (order may vary)

    getQuestionsForLevelSpy.mockRestore();
    await pool.query(`DELETE FROM level_progress WHERE level_number = 10 AND user_id IN ($1, $2)`, [player1Id, player2Id]);
  });
```

Add the import at the top of the test file:
```ts
import { getLevelProgressForUser } from '../../src/game/levelProgress';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest tests/game/gameEngine.test.ts -t "stars"`
Expected: FAIL — `finishGame` doesn't compute/persist stars or emit per-socket for level-mode games yet.

- [ ] **Step 3: Implement**

In `backend/src/game/gameEngine.ts`:

1. Add the import:
```ts
import { calculateLevelStars, upsertLevelProgress } from './levelProgress';
```

2. Replace `finishGame`'s body:

```ts
async function finishGame(gameId: string, opts?: { knockout?: boolean }): Promise<void> {
  const game = await getGame(gameId);
  if (!game) return;
  game.status = 'finished';
  await saveGame(game);
  const [p1, p2] = game.players;
  const winnerId = p1.score === p2.score ? null : p1.score > p2.score ? p1.userId : p2.userId;
  const scores = game.players.map((p) => ({ userId: p.userId, score: p.score }));

  if (game.level != null) {
    const level = game.level;
    for (const player of game.players) {
      const correctCount = player.answers.filter((a) => a && a.points > 0).length;
      const stars = calculateLevelStars(correctCount);
      // Bots don't have meaningful "progress" to track - only real users
      // get a level_progress row.
      if (!player.isBot) {
        await upsertLevelProgress(player.userId, level, stars);
      }
      const socket = getIO().sockets.sockets.get(player.socketId);
      if (socket) {
        socket.emit('game_over', {
          scores,
          winnerId,
          knockout: false,
          levelStars: stars,
        });
      }
    }
  } else {
    getIO().to(gameId).emit('game_over', {
      scores,
      winnerId,
      knockout: opts?.knockout ?? false,
    });
  }

  await persistMatchResult(gameId, {
    category: game.category,
    player1Id: p1.userId,
    player2Id: p2.userId,
    player1Score: p1.score,
    player2Score: p2.score,
    winnerId,
  });

  const timer = activeTimers.get(gameId);
  if (timer) clearTimeout(timer);
  activeTimers.delete(gameId);

  clearSocketGameId(game.players);
  await deleteGame(gameId);
}
```

Note: `forfeitIfStillDisconnected` (further down in this same file) is **intentionally left unchanged** — a level-mode match that ends via forfeit does not award stars (the player didn't complete all 15 questions, so there's nothing fair to rate), and its existing single room-broadcast `game_over` (with `forfeited: true`, no `levelStars`) is correct as-is for that case.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/game/gameEngine.test.ts`
Expected: PASS (all tests, including the 2 new ones)

- [ ] **Step 5: Run the full backend suite and typecheck**

Run: `cd backend && npx jest` — expect PASS (accounting for known flakiness)
Run: `cd backend && npx tsc --noEmit` — expect clean

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/game/gameEngine.ts tests/game/gameEngine.test.ts
git commit -m "Compute and persist per-player level stars, emit per-socket game_over for level-mode matches"
```

---

### Task 6: Backend — level-aware matchmaking and invites

**Files:**
- Modify: `backend/src/invite/inviteRoom.ts`
- Modify: `backend/src/matchmaking/matchmaker.ts`
- Modify: `backend/tests/invite/inviteRoom.test.ts`
- Modify: `backend/tests/matchmaking/matchmaker.test.ts`

`backend/src/matchmaking/queue.ts` is **not touched** — `queueKey(category)` already works unmodified when passed a synthetic string like `"level:5"` (producing `"queue:level:5"`), since it has no knowledge of what a "category" string actually means.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/invite/inviteRoom.test.ts` (check the file's actual current imports/structure first and adapt if it differs from this):

```ts
  it('stores and consumes an optional level field on a pending invite', async () => {
    await createInvite(9991, { category: 'ingliz_tili', socketId: 'sockL', userId: 1, level: 12 });
    const invite = await consumeInvite(9991);
    expect(invite?.level).toBe(12);
  });

  it('omits level entirely for a normal (non-level) invite', async () => {
    await createInvite(9992, { category: 'umumiy_bilim', socketId: 'sockN', userId: 1 });
    const invite = await consumeInvite(9992);
    expect(invite?.level).toBeUndefined();
  });
```

Add to `backend/tests/matchmaking/matchmaker.test.ts` (check the file's actual current imports/structure first — it should already have a way to set up a fake `AppServer`/sockets similar to `gameEngine.test.ts`'s `createFakeIO`, and real test users via `upsertUser`; adapt the test below to match whatever helper already exists there). Note these tests use **level 1** (the one level always unlocked for every user regardless of progress, per Task 2's `isLevelUnlocked`) so they don't need to fabricate `level_progress` fixture rows just to get past the unlock check added later in this same task:

```ts
  it('handleJoinLevelQueue pairs two players who queued for the SAME level and starts a level-mode game', async () => {
    const { fakeIO } = createFakeIO(); // or this file's equivalent existing helper
    const startGameSpy = jest.spyOn(gameEngine, 'startGame').mockResolvedValueOnce(undefined);

    await handleJoinLevelQueue(fakeIO as any, 'sockA', playerAId, 1);
    await handleJoinLevelQueue(fakeIO as any, 'sockB', playerBId, 1);

    expect(startGameSpy).toHaveBeenCalledWith(
      expect.any(String),
      'ingliz_tili',
      expect.objectContaining({ userId: playerAId }),
      expect.objectContaining({ userId: playerBId, isBot: false }),
      undefined,
      1
    );

    startGameSpy.mockRestore();
  });

  it('handleJoinLevelQueue does NOT pair two players who queued for DIFFERENT levels', async () => {
    const { fakeIO } = createFakeIO();
    const startGameSpy = jest.spyOn(gameEngine, 'startGame').mockResolvedValue(undefined);

    // Level 2 isn't unlocked by default - grant it directly via
    // upsertLevelProgress so this test is exercising "different levels
    // don't pair", not accidentally exercising the unlock guard instead.
    await upsertLevelProgress(playerBId, 1, 2);

    await handleJoinLevelQueue(fakeIO as any, 'sockC', playerAId, 1);
    await handleJoinLevelQueue(fakeIO as any, 'sockD', playerBId, 2);

    expect(startGameSpy).not.toHaveBeenCalled();

    startGameSpy.mockRestore();
    // Clean up: cancel both waiting entries so they don't leak into a later
    // test or trigger a real bot-fallback timer after this test finishes.
    cancelWaiting(playerAId, 'level:1');
    cancelWaiting(playerBId, 'level:2');
    await pool.query(`DELETE FROM level_progress WHERE user_id = $1 AND level_number = 1`, [playerBId]);
  });

  it('handleJoinLevelQueue silently refuses to queue a user for a level they have not unlocked', async () => {
    const { fakeIO } = createFakeIO();
    const startGameSpy = jest.spyOn(gameEngine, 'startGame').mockResolvedValue(undefined);

    // playerAId has no level_progress rows in this test's fixture data, so
    // level 50 (deep into a stage nobody has reached) must be rejected - a
    // modified client emitting join_level_queue with an arbitrary level
    // number must not be able to skip progression.
    await handleJoinLevelQueue(fakeIO as any, 'sockE', playerAId, 50);

    // Confirm nothing was even enqueued (not just "no match yet") - if this
    // silently joined the Redis queue, a second real player choosing level
    // 50 later would incorrectly get paired with this rejected attempt.
    const stillQueued = await redis.llen('queue:level:50');
    expect(stillQueued).toBe(0);
    expect(startGameSpy).not.toHaveBeenCalled();

    startGameSpy.mockRestore();
  });
```

If this test file does not already import `gameEngine` as a namespace, add: `import * as gameEngine from '../../src/game/gameEngine';` — and adapt `playerAId`/`playerBId` to whatever real test user setup this file already has (following the same `upsertUser` pattern used elsewhere in this project's backend tests). Also add, if not already present: `import { redis } from '../../src/config/redis';`, `import { pool } from '../../src/config/db';`, and `import { upsertLevelProgress } from '../../src/game/levelProgress';`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest tests/invite/inviteRoom.test.ts tests/matchmaking/matchmaker.test.ts -t "level"`
Expected: FAIL — `level` field doesn't exist on `PendingInvite`, `handleJoinLevelQueue` doesn't exist.

- [ ] **Step 3: Implement**

In `backend/src/invite/inviteRoom.ts`, change the interface:

```ts
export interface PendingInvite {
  category: string;
  socketId: string;
  userId: number;
  level?: number;
}
```

No other change needed in this file — `createInvite`/`consumeInvite` already pass the whole object through generically via `JSON.stringify`/`JSON.parse`.

In `backend/src/matchmaking/matchmaker.ts`:

1. Add this import (alongside the existing `isValidCategory` import from `questionRepository`):
```ts
import { isLevelUnlockedForUser } from '../game/levelProgress';
```

Add this constant near the top (after the existing imports):
```ts
const LEVEL_CATEGORY_KEY = 'ingliz_tili';

function levelQueueCategory(level: number): string {
  return `level:${level}`;
}
```

2. Change `createMatch`'s signature and the one line that calls `startGame`:
```ts
export async function createMatch(
  io: AppServer,
  category: string,
  player1: QueuedPlayer,
  player2: QueuedPlayer,
  player2IsBot = false,
  level?: number
): Promise<void> {
```
(everything else in the function body is unchanged, EXCEPT the final line, which becomes:)
```ts
  await startGame(gameId, category, player1, { ...player2, isBot: player2IsBot }, botDisplayName, level);
```

Also add `level` to the `match_found` emit payloads so the frontend knows which level this match is for (both emit sites, `socket1.emit('match_found', {...})` and `socket2.emit('match_found', {...})`):
```ts
    socket1.emit('match_found', {
      gameId,
      category,
      ...(level != null ? { level } : {}),
      opponent: { ... }, // unchanged
    });
```
(same `...(level != null ? { level } : {})` spread added to the `socket2.emit('match_found', {...})` call below it.)

3. Add a new exported function, near `handleJoinQueue` (this largely mirrors `handleJoinQueue`'s body, but keyed by level instead of category, and hardcodes the real category to `'ingliz_tili'` when actually starting the match):

```ts
export async function handleJoinLevelQueue(io: AppServer, socketId: string, userId: number, level: number): Promise<void> {
  // A modified client could emit join_level_queue with an arbitrary level
  // number, bypassing the progression LevelSelectScreen enforces by only
  // rendering unlocked levels as clickable - re-check server-side before
  // ever touching the queue, mirroring handleJoinQueue's isValidCategory
  // check below.
  if (!(await isLevelUnlockedForUser(userId, level))) {
    console.log(`matchmaker: refusing join_level_queue from userId=${userId} - level=${level} is not unlocked for this user`);
    return;
  }

  const queueCategory = levelQueueCategory(level);

  if (waitingTimers.has(userId)) {
    console.log(`matchmaker: ignoring duplicate join_level_queue from userId=${userId} (already waiting) level=${level}`);
    return;
  }

  console.log(`matchmaker: join_level_queue received userId=${userId} socketId=${socketId} level=${level}`);

  const pair = await runSerialized(queueCategory, async () => {
    await joinQueue(queueCategory, { userId, socketId });
    return popTwoIfAvailable(queueCategory);
  });

  if (pair) {
    const [player1, player2] = pair;
    console.log(`matchmaker: paired userId=${player1.userId} with userId=${player2.userId} level=${level}`);
    clearWaitingTimer(player1.userId);
    clearWaitingTimer(player2.userId);
    await createMatch(io, LEVEL_CATEGORY_KEY, player1, player2, false, level);
    return;
  }

  console.log(`matchmaker: no opponent yet for userId=${userId} level=${level} - waiting up to ${BOT_MATCH_TIMEOUT_MS}ms before bot fallback`);

  const timer = setTimeout(() => {
    waitingTimers.delete(userId);
    void runSerialized(queueCategory, () => leaveQueue(queueCategory, userId)).then(async (removed) => {
      if (!removed) {
        console.log(`matchmaker: bot-fallback timer fired for userId=${userId} but they were already paired/removed - skipping`);
        return;
      }
      console.log(`matchmaker: bot-fallback timeout reached for userId=${userId} level=${level} - matching with a bot`);
      const bot = await getOrCreateBotUser();
      await createMatch(io, LEVEL_CATEGORY_KEY, { userId, socketId }, { userId: bot.id, socketId: 'bot' }, true, level);
    }).catch((err) => {
      console.error('matchmaker: level bot-fallback match failed', err);
    });
  }, BOT_MATCH_TIMEOUT_MS);
  waitingTimers.set(userId, timer);
}
```

Note: `cancelWaiting(userId, category)` (already existing, unchanged) works correctly for level-mode leave-queue calls too, as long as the caller passes `levelQueueCategory(level)` as the `category` argument — this is handled in Task 7's socket handler, not here.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/invite/inviteRoom.test.ts tests/matchmaking/matchmaker.test.ts`
Expected: PASS (all tests, including the new ones)

- [ ] **Step 5: Run the full backend suite and typecheck**

Run: `cd backend && npx jest` — expect PASS (accounting for known flakiness)
Run: `cd backend && npx tsc --noEmit` — expect clean

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/invite/inviteRoom.ts src/matchmaking/matchmaker.ts tests/invite/inviteRoom.test.ts tests/matchmaking/matchmaker.test.ts
git commit -m "Add level-aware matchmaking (handleJoinLevelQueue) and invite level field"
```

---

### Task 7: Backend — new socket events (`join_level_queue`, `leave_level_queue`, `create_level_invite`, `join_level_invite`)

**Files:**
- Modify: `backend/src/socket/socketServer.ts`
- Modify: `backend/tests/integration/socketServer.test.ts`

- [ ] **Step 1: Write the failing tests**

Check `backend/tests/integration/socketServer.test.ts`'s actual current structure (it uses a real `http`/`socket.io-client` pair against `initSocketServer`, with `signSession` for auth tokens and real `upsertUser` calls — see the existing tests in that file for the exact pattern) and add tests analogous to its existing `join_queue`/`create_invite` coverage, adapted for the new level events:

```ts
  it('join_level_queue pairs two sockets that chose the SAME level, and starts a knockout-free match', async () => {
    const level = 1; // always unlocked for every user, per Task 2's isLevelUnlocked - avoids needing level_progress fixture rows just to get past the unlock guard
    const user1 = await upsertUser(8801001, 'levelSockA', 'LevelSockA', null);
    const user2 = await upsertUser(8801002, 'levelSockB', 'LevelSockB', null);

    const token1 = signSession({ userId: user1.id, telegramId: 8801001 });
    const token2 = signSession({ userId: user2.id, telegramId: 8801002 });
    const client1: ClientSocket = ioClient(`http://localhost:${port}`, { auth: { token: token1 } });
    const client2: ClientSocket = ioClient(`http://localhost:${port}`, { auth: { token: token2 } });

    try {
      const [matchFound1] = await Promise.all([
        new Promise<any>((resolve) => client1.on('match_found', resolve)),
        new Promise<void>((resolve) => client1.on('connect', () => { client1.emit('join_level_queue', { level }); resolve(); })),
      ]);
      await new Promise<void>((resolve) => client2.on('connect', () => { client2.emit('join_level_queue', { level }); resolve(); }));
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(matchFound1.level).toBe(level);
    } finally {
      client1.close();
      client2.close();
      await pool.query(`DELETE FROM matches WHERE player1_id = $1 OR player2_id = $1 OR player1_id = $2 OR player2_id = $2`, [user1.id, user2.id]);
      await pool.query(`DELETE FROM level_progress WHERE user_id IN ($1, $2)`, [user1.id, user2.id]);
      await pool.query(`DELETE FROM users WHERE telegram_id IN (8801001, 8801002)`);
    }
  });
```

This test is a best-effort sketch given this file's real conventions weren't re-read line-by-line for this task — before writing it for real, read the actual current `backend/tests/integration/socketServer.test.ts` in full and match its established helpers/cleanup exactly (e.g. it may already have a shared `createTestUser` helper, a specific pattern for waiting on `match_found`, etc.) rather than assuming the shape above is exactly right.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest tests/integration/socketServer.test.ts -t "level"`
Expected: FAIL — `join_level_queue` etc. aren't handled by the server yet.

- [ ] **Step 3: Implement**

In `backend/src/socket/socketServer.ts`:

1. Add the imports:
```ts
import { handleJoinQueue, handleJoinLevelQueue, cancelWaiting, createMatch } from '../matchmaking/matchmaker';
import { isLevelUnlockedForUser } from '../game/levelProgress';
```
(the first line replaces the existing `import { handleJoinQueue, cancelWaiting, createMatch } from '../matchmaking/matchmaker';` line; the second is new)

2. Add these four new handlers right after the existing `join_invite` handler (before the `reconnect_game` handler):

```ts
    // Level-mode equivalent of join_queue - no isValidCategory check (there's
    // no user-facing category for level mode; it's always 'ingliz_tili'
    // internally, see matchmaker.ts's handleJoinLevelQueue), just a basic
    // sanity check on the level number itself.
    socket.on('join_level_queue', ({ level }: { level: number }) => {
      if (!Number.isInteger(level) || level < 1) return;
      if (socket.data.gameId) {
        console.log(`socketServer: ignoring join_level_queue from userId=${socket.data.userId} - socket already has an active gameId=${socket.data.gameId}`);
        return;
      }
      handleJoinLevelQueue(io!, socket.id, socket.data.userId, level).catch((err) => {
        console.error(`socketServer: failed to join level queue for user ${socket.data.userId}`, err);
      });
    });

    socket.on('leave_level_queue', ({ level }: { level: number }) => {
      if (!Number.isInteger(level) || level < 1) return;
      cancelWaiting(socket.data.userId, `level:${level}`);
    });

    socket.on('create_level_invite', async ({ level }: { level: number }) => {
      try {
        if (!Number.isInteger(level) || level < 1) return;
        if (socket.data.gameId) return;
        // Same server-side unlock re-check as join_level_queue (see
        // matchmaker.ts's handleJoinLevelQueue) - the inviter must have
        // genuinely unlocked this level themselves before offering it to a
        // friend. The invitee joining via join_level_invite below is
        // deliberately NOT re-checked against their own progress - playing
        // a level a friend invited you to, ahead of your own solo
        // progression, is intended (see design spec).
        if (!(await isLevelUnlockedForUser(socket.data.userId, level))) return;
        const telegramId = socket.data.telegramId;
        await createInvite(telegramId, { category: 'ingliz_tili', socketId: socket.id, userId: socket.data.userId, level });
        socket.emit('invite_created');
      } catch (err) {
        console.error(`socketServer: failed to create level invite for telegramId ${socket.data.telegramId}`, err);
      }
    });

    socket.on('join_level_invite', async ({ inviterTelegramId }: { inviterTelegramId: number }) => {
      try {
        if (typeof inviterTelegramId !== 'number' || !Number.isFinite(inviterTelegramId)) return;
        if (socket.data.gameId) return;

        if (socket.data.telegramId === inviterTelegramId) {
          socket.emit('invite_expired');
          return;
        }

        const invite = await consumeInvite(inviterTelegramId);
        if (!invite || invite.level == null) {
          socket.emit('invite_expired');
          return;
        }

        const inviterCurrentSocketId = activeSocketsByUser.get(invite.userId);
        const inviterSocket = inviterCurrentSocketId ? io!.sockets.sockets.get(inviterCurrentSocketId) : undefined;
        if (inviterSocket?.data.gameId) {
          socket.emit('invite_expired');
          return;
        }

        await createMatch(
          io!,
          invite.category,
          { userId: invite.userId, socketId: inviterSocket?.id ?? invite.socketId },
          { userId: socket.data.userId, socketId: socket.id },
          false,
          invite.level
        );
      } catch (err) {
        console.error(`socketServer: failed to join level invite from inviterTelegramId ${inviterTelegramId}`, err);
      }
    });
```

Note `join_level_invite`'s payload intentionally has no `category`/`level` field from the client (unlike `join_invite`, which accepts-but-ignores an invitee `category`) — the level is entirely determined by `invite.level` (the value the INVITER stored when they created the invite), and the check `invite.level == null` guards against a stale/malformed invite record that isn't actually a level invite.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/integration/socketServer.test.ts`
Expected: PASS (all tests, including the new one)

- [ ] **Step 5: Run the full backend suite and typecheck**

Run: `cd backend && npx jest` — expect PASS (accounting for known flakiness)
Run: `cd backend && npx tsc --noEmit` — expect clean

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/socket/socketServer.ts tests/integration/socketServer.test.ts
git commit -m "Add join_level_queue, leave_level_queue, create_level_invite, join_level_invite socket events"
```

---

### Task 8: Backend — `GET /level-progress` REST endpoint

**Files:**
- Create: `backend/src/game/levelProgressRoutes.ts`
- Create: `backend/tests/game/levelProgressRoutes.test.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/game/levelProgressRoutes.test.ts`, following the same request-testing pattern already used elsewhere in this backend for authenticated REST routes (check `backend/tests/stats/statsRoutes.test.ts` if it exists for the exact `supertest`-against-`createApp()` + `signSession` pattern, and match it):

```ts
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/config/db';
import { signSession } from '../../src/auth/jwt';
import { upsertUser } from '../../src/users/userRepository';
import { upsertLevelProgress } from '../../src/game/levelProgress';

describe('GET /api/level-progress', () => {
  let userId: number;
  let token: string;

  beforeAll(async () => {
    const user = await upsertUser(8802001, 'levelRouteTestUser', 'LevelRouteTest', null);
    userId = user.id;
    token = signSession({ userId: user.id, telegramId: 8802001 });
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM level_progress WHERE user_id = $1`, [userId]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id = 8802001`);
    await pool.end();
  });

  it('returns 401 with no auth token', async () => {
    const app = createApp();
    const res = await request(app).get('/api/level-progress');
    expect(res.status).toBe(401);
  });

  it('returns empty progress and a real maxAvailableLevel for a brand new user', async () => {
    const app = createApp();
    const res = await request(app).get('/api/level-progress').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.progress).toEqual([]);
    expect(typeof res.body.maxAvailableLevel).toBe('number');
    expect(res.body.maxAvailableLevel).toBeGreaterThan(0);
  });

  it('returns this user\'s own progress rows, not other users\' ', async () => {
    await upsertLevelProgress(userId, 2, 3);
    const app = createApp();
    const res = await request(app).get('/api/level-progress').set('Authorization', `Bearer ${token}`);
    expect(res.body.progress).toEqual([{ levelNumber: 2, stars: 3 }]);
  });
});
```

Check whether `supertest` is already a dependency (`backend/package.json`'s `devDependencies` - it should already be there if any existing REST route test uses it; if not, run `npm install --save-dev supertest @types/supertest` first).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest tests/game/levelProgressRoutes.test.ts`
Expected: FAIL — route doesn't exist yet (404).

- [ ] **Step 3: Implement**

Create `backend/src/game/levelProgressRoutes.ts`:

```ts
import { Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../auth/authMiddleware';
import { getLevelProgressForUser } from './levelProgress';
import { maxAvailableLevel } from '../questions/questionRepository';

export const levelProgressRouter = Router();

levelProgressRouter.get('/level-progress', requireAuth, async (req: AuthenticatedRequest, res) => {
  const [progress, max] = await Promise.all([
    getLevelProgressForUser(req.userId!),
    maxAvailableLevel(),
  ]);
  res.json({ progress, maxAvailableLevel: max });
});
```

In `backend/src/app.ts`, add the import and mount it alongside the other `/api`-mounted routers:

```ts
import { levelProgressRouter } from './game/levelProgressRoutes';
```
```ts
  app.use('/api', levelProgressRouter);
```
(add this line next to the existing `app.use('/api', questionsRouter);` etc.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/game/levelProgressRoutes.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Run the full backend suite and typecheck**

Run: `cd backend && npx jest` — expect PASS (accounting for known flakiness)
Run: `cd backend && npx tsc --noEmit` — expect clean

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/game/levelProgressRoutes.ts tests/game/levelProgressRoutes.test.ts src/app.ts
git commit -m "Add GET /level-progress endpoint"
```

---

### Task 9: Frontend — `NavigationContext` Screen union changes

**Files:**
- Modify: `frontend/src/context/NavigationContext.tsx`
- Modify: `frontend/src/context/NavigationContext.test.tsx`

- [ ] **Step 1: Update the `Screen` union**

In `frontend/src/context/NavigationContext.tsx`, replace the `Screen` type:

```ts
export type Screen =
  | { name: 'home' }
  | { name: 'levelSelect'; intent: 'quick' | 'invite' }
  | { name: 'waiting'; level: number; intent: 'quick' | 'invite' | 'joining' }
  | { name: 'battle'; gameId: string; level: number }
  | { name: 'result'; scores: ScoreEntry[]; winnerId: number | null; forfeited: boolean; knockout: boolean; level: number; levelStars?: number }
  | { name: 'leaderboard' }
  | { name: 'settings' }
  | { name: 'admin' };
```

Nothing else in this file changes — `navigate`/`goBack`/`replace`/`reset` are all generic over `Screen`, and `SCREENS_WITHOUT_BACK_BUTTON` still only needs `'battle'`.

- [ ] **Step 2: Check the existing test file for stale references**

Read `frontend/src/context/NavigationContext.test.tsx`. If it constructs any `{ name: 'categorySelect', ... }` or `{ name: 'waiting'/'battle'/'result', category: ..., ... }` literals for its test fixtures, update them to the new shape (`levelSelect`/`level: <number>`). This file's own navigate/goBack/replace/reset logic tests should otherwise be unaffected since those functions are generic.

- [ ] **Step 3: Run this file's tests**

Run: `cd frontend && npx vitest run src/context/NavigationContext.test.tsx`
Expected: PASS. (Other files that construct `Screen` literals — `HomeScreen`, `WaitingScreen`, `BattleScreen`, `ResultScreen`, `CategorySelectScreen`, `App.tsx`, and their tests — will still reference the OLD shape until Tasks 10-16 update them; the full suite will NOT be green until this whole plan's frontend tasks are done. Do not be alarmed by unrelated red tests elsewhere at this point — just confirm this file's own typecheck/tests are consistent with the new type.)

Run: `cd frontend && npx tsc --noEmit`
Expected: many errors across other files that still use the old `Screen` shapes — this is expected and will clear up task-by-task through Task 16. Confirm the errors are ONLY about `categorySelect`/`category` (not some unrelated typo you introduced).

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/context/NavigationContext.tsx src/context/NavigationContext.test.tsx
git commit -m "Replace categorySelect/category with levelSelect/level in the Screen union"
```

---

### Task 10: Frontend — `useGameSocket` level-aware socket functions and types

**Files:**
- Modify: `frontend/src/socket/useGameSocket.ts`
- Modify: `frontend/src/socket/useGameSocket.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/socket/useGameSocket.test.ts` (check this file's actual current structure — it should already have a `fakeSocket` test double with a `.emit`/`.on`/`__trigger` pattern used by the existing `joinQueue`/`createInvite` tests; mirror that exactly):

```ts
  it('joinLevelQueue/leaveLevelQueue/createLevelInvite/joinLevelInvite emit the correct events and payloads', () => {
    const { result } = renderHook(() => useGameSocket('tok'));

    result.current.joinLevelQueue(7);
    expect(fakeSocket.emit).toHaveBeenCalledWith('join_level_queue', { level: 7 });

    result.current.leaveLevelQueue(7);
    expect(fakeSocket.emit).toHaveBeenCalledWith('leave_level_queue', { level: 7 });

    result.current.createLevelInvite(7);
    expect(fakeSocket.emit).toHaveBeenCalledWith('create_level_invite', { level: 7 });

    result.current.joinLevelInvite(999);
    expect(fakeSocket.emit).toHaveBeenCalledWith('join_level_invite', { inviterTelegramId: 999 });
  });

  it('includes level in matchFound and levelStars in gameOver when the server sends them', () => {
    const { result } = renderHook(() => useGameSocket('tok'));

    act(() => fakeSocket.__trigger('match_found', { gameId: 'g1', category: 'ingliz_tili', level: 7, opponent: { telegramId: 1, firstName: 'A' } }));
    expect(result.current.matchFound?.level).toBe(7);

    act(() => fakeSocket.__trigger('game_over', { scores: [], winnerId: null, levelStars: 2 }));
    expect(result.current.gameOver?.levelStars).toBe(2);
  });
```

Adapt the exact helper names (`fakeSocket`, `renderHook`, `act`, `__trigger`) to match this file's actual current test double if they differ — the important behaviors to prove are: the four new emit functions send the right event name/payload, and the two new optional fields (`level` on `matchFound`, `levelStars` on `gameOver`) are read through correctly from incoming server events.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/socket/useGameSocket.test.ts -t "Level"`
Expected: FAIL — the new functions/fields don't exist yet.

- [ ] **Step 3: Implement**

In `frontend/src/socket/useGameSocket.ts`:

1. Extend `MatchFoundPayload` and `GameOverPayload`:
```ts
export interface MatchFoundPayload {
  gameId: string;
  category: string;
  level?: number;
  opponent: OpponentInfo;
}

export interface GameOverPayload {
  scores: ScoreEntry[];
  winnerId: number | null;
  forfeited?: boolean;
  knockout?: boolean;
  levelStars?: number;
}
```

2. Extend `ClientToServerEvents`:
```ts
export interface ClientToServerEvents {
  join_queue: (payload: { category: string }) => void;
  leave_queue: (payload: { category: string }) => void;
  join_level_queue: (payload: { level: number }) => void;
  leave_level_queue: (payload: { level: number }) => void;
  submit_answer: (payload: { gameId: string; questionIndex: number; selectedOption: number }) => void;
  create_invite: (payload: { category: string }) => void;
  join_invite: (payload: { inviterTelegramId: number; category: string }) => void;
  create_level_invite: (payload: { level: number }) => void;
  join_level_invite: (payload: { inviterTelegramId: number }) => void;
  reconnect_game: (payload: { gameId: string }, ack: (response: ReconnectAck) => void) => void;
}
```

3. Extend `UseGameSocketResult`:
```ts
  joinLevelQueue: (level: number) => void;
  leaveLevelQueue: (level: number) => void;
  createLevelInvite: (level: number) => void;
  joinLevelInvite: (inviterTelegramId: number) => void;
```
(add these 4 lines to the interface, near the existing `joinQueue`/`leaveQueue`/`createInvite`/`joinInvite` lines)

4. Add the implementations (near the existing `joinQueue`/`leaveQueue`/`createInvite`/`joinInvite` `useCallback`s):
```ts
  const joinLevelQueue = useCallback((level: number) => {
    socketRef.current?.emit('join_level_queue', { level });
  }, []);

  const leaveLevelQueue = useCallback((level: number) => {
    socketRef.current?.emit('leave_level_queue', { level });
  }, []);

  const createLevelInvite = useCallback((level: number) => {
    socketRef.current?.emit('create_level_invite', { level });
  }, []);

  const joinLevelInvite = useCallback((inviterTelegramId: number) => {
    socketRef.current?.emit('join_level_invite', { inviterTelegramId });
  }, []);
```

5. Add all four to the returned object at the bottom of the hook:
```ts
    joinLevelQueue,
    leaveLevelQueue,
    createLevelInvite,
    joinLevelInvite,
```

No change is needed to the `match_found`/`game_over` socket listeners inside the `useEffect` — they already do `setMatchFound(payload)`/`setGameOver(payload)` generically, so the new optional `level`/`levelStars` fields flow through automatically once the payload types above include them.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/socket/useGameSocket.test.ts`
Expected: PASS (all tests, including the new ones)

- [ ] **Step 5: Run the full frontend suite and typecheck**

Run: `cd frontend && npx vitest run` — expect PASS for this file; other files still referencing old shapes will be fixed in later tasks
Run: `cd frontend && npx tsc --noEmit` — expect fewer errors than after Task 9, but still some remaining (cleared by later tasks)

- [ ] **Step 6: Commit**

```bash
cd frontend
git add src/socket/useGameSocket.ts src/socket/useGameSocket.test.ts
git commit -m "Add level-aware socket functions and level/levelStars payload fields"
```

---

### Task 11: Frontend — `api/levelProgress.ts` and new `LevelSelectScreen`

**Files:**
- Create: `frontend/src/api/levelProgress.ts`
- Create: `frontend/src/screens/LevelSelectScreen.tsx`
- Create: `frontend/src/screens/LevelSelectScreen.test.tsx`

- [ ] **Step 1: Create the API wrapper**

Create `frontend/src/api/levelProgress.ts`:

```ts
// frontend/src/api/levelProgress.ts
import { apiGet } from './client';

export interface LevelProgressEntry {
  levelNumber: number;
  stars: number;
}

export interface LevelProgressResponse {
  progress: LevelProgressEntry[];
  maxAvailableLevel: number;
}

export function getLevelProgress(token: string): Promise<LevelProgressResponse> {
  return apiGet<LevelProgressResponse>('/level-progress', token);
}
```

- [ ] **Step 2: Write the failing tests for `LevelSelectScreen`**

Create `frontend/src/screens/LevelSelectScreen.test.tsx`:

```tsx
// frontend/src/screens/LevelSelectScreen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LevelSelectScreen } from './LevelSelectScreen';
import * as authContext from '../context/AuthContext';
import * as navigationContext from '../context/NavigationContext';
import * as gameSocketContext from '../context/GameSocketContext';
import * as levelProgressApi from '../api/levelProgress';

describe('LevelSelectScreen', () => {
  const navigate = vi.fn();
  const joinLevelQueue = vi.fn();
  const createLevelInvite = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    navigate.mockClear();
    joinLevelQueue.mockClear();
    createLevelInvite.mockClear();

    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1 } as any, loading: false, error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'levelSelect', intent: 'quick' },
      navigate, goBack: vi.fn(), replace: vi.fn(), reset: vi.fn(),
    });
    vi.spyOn(gameSocketContext, 'useGameSocketContext').mockReturnValue({
      joinLevelQueue, createLevelInvite,
    } as any);
  });

  it('shows a loading state, then renders level cards once progress loads', async () => {
    vi.spyOn(levelProgressApi, 'getLevelProgress').mockResolvedValue({
      progress: [{ levelNumber: 1, stars: 3 }],
      maxAvailableLevel: 5,
    });

    render(<LevelSelectScreen intent="quick" />);
    expect(screen.getByText(/Yuklanmoqda/)).toBeInTheDocument();

    await screen.findByText('1');
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('level 1 is always clickable even with zero progress', async () => {
    vi.spyOn(levelProgressApi, 'getLevelProgress').mockResolvedValue({
      progress: [],
      maxAvailableLevel: 3,
    });

    render(<LevelSelectScreen intent="quick" />);
    const level1Button = await screen.findByRole('button', { name: /1/ });
    expect(level1Button).not.toBeDisabled();
  });

  it('a level beyond an unearned unlock threshold is locked (disabled)', async () => {
    vi.spyOn(levelProgressApi, 'getLevelProgress').mockResolvedValue({
      progress: [{ levelNumber: 1, stars: 1 }], // only 1 star - level 2 needs >=2
      maxAvailableLevel: 5,
    });

    render(<LevelSelectScreen intent="quick" />);
    const level2Button = await screen.findByRole('button', { name: /2/ });
    expect(level2Button).toBeDisabled();
  });

  it('clicking an unlocked level in quick mode joins the level queue and navigates to waiting', async () => {
    vi.spyOn(levelProgressApi, 'getLevelProgress').mockResolvedValue({
      progress: [],
      maxAvailableLevel: 3,
    });

    render(<LevelSelectScreen intent="quick" />);
    const level1Button = await screen.findByRole('button', { name: /1/ });
    fireEvent.click(level1Button);

    expect(joinLevelQueue).toHaveBeenCalledWith(1);
    expect(navigate).toHaveBeenCalledWith({ name: 'waiting', level: 1, intent: 'quick' });
  });

  it('clicking an unlocked level in invite mode creates a level invite and navigates to waiting', async () => {
    vi.spyOn(levelProgressApi, 'getLevelProgress').mockResolvedValue({
      progress: [],
      maxAvailableLevel: 3,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'levelSelect', intent: 'invite' },
      navigate, goBack: vi.fn(), replace: vi.fn(), reset: vi.fn(),
    });

    render(<LevelSelectScreen intent="invite" />);
    const level1Button = await screen.findByRole('button', { name: /1/ });
    fireEvent.click(level1Button);

    expect(createLevelInvite).toHaveBeenCalledWith(1);
    expect(navigate).toHaveBeenCalledWith({ name: 'waiting', level: 1, intent: 'invite' });
  });

  it('shows an error message if progress fails to load', async () => {
    vi.spyOn(levelProgressApi, 'getLevelProgress').mockRejectedValue(new Error('network'));

    render(<LevelSelectScreen intent="quick" />);
    await waitFor(() => expect(screen.getByText(/yuklab bo'lmadi/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/screens/LevelSelectScreen.test.tsx`
Expected: FAIL — `LevelSelectScreen.tsx` doesn't exist yet.

- [ ] **Step 4: Implement**

Create `frontend/src/screens/LevelSelectScreen.tsx`:

```tsx
// frontend/src/screens/LevelSelectScreen.tsx
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import { useGameSocketContext } from '../context/GameSocketContext';
import { getLevelProgress, LevelProgressEntry } from '../api/levelProgress';

const LEVELS_PER_STAGE = 10;
const STAGE_UNLOCK_STARS_REQUIRED = 25;
const LEVEL_UNLOCK_STARS_REQUIRED = 2;

// Mirrors backend/src/game/levelProgress.ts's isLevelUnlocked exactly - kept
// in sync manually (no shared package between frontend/backend in this
// project), same as frontend/src/utils/category.ts historically mirrored
// the categories DB table.
function isLevelUnlocked(level: number, progressByLevel: Map<number, number>): boolean {
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

export function LevelSelectScreen({ intent }: { intent: 'quick' | 'invite' }) {
  const { token } = useAuth();
  const { navigate } = useNavigation();
  const { joinLevelQueue, createLevelInvite } = useGameSocketContext();
  const [progress, setProgress] = useState<LevelProgressEntry[]>([]);
  const [maxAvailableLevel, setMaxAvailableLevel] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setError(false);

    getLevelProgress(token)
      .then((res) => {
        if (cancelled) return;
        setProgress(res.progress);
        setMaxAvailableLevel(res.maxAvailableLevel);
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

  const progressByLevel = new Map(progress.map((p) => [p.levelNumber, p.stars]));

  const handleSelect = (level: number) => {
    if (intent === 'quick') {
      joinLevelQueue(level);
    } else {
      createLevelInvite(level);
    }
    navigate({ name: 'waiting', level, intent });
  };

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
        Bosqichlarni yuklab bo'lmadi.
      </div>
    );
  }

  const levels = Array.from({ length: maxAvailableLevel }, (_, i) => i + 1);
  const stages = new Map<number, number[]>();
  for (const level of levels) {
    const stage = Math.ceil(level / LEVELS_PER_STAGE);
    if (!stages.has(stage)) stages.set(stage, []);
    stages.get(stage)!.push(level);
  }

  return (
    <div className="flex flex-col gap-6 p-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <h2 className="text-lg font-bold text-ios-label">Bosqichlar</h2>
      {Array.from(stages.entries()).map(([stage, stageLevels]) => (
        <div key={stage} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-ios-secondary-label">{stage}-etap</h3>
          <div className="grid grid-cols-5 gap-2">
            {stageLevels.map((level) => {
              const unlocked = isLevelUnlocked(level, progressByLevel);
              const stars = progressByLevel.get(level) ?? 0;
              const played = progressByLevel.has(level);
              return (
                <button
                  key={level}
                  type="button"
                  disabled={!unlocked}
                  onClick={() => handleSelect(level)}
                  className={`flex flex-col items-center gap-1 rounded-2xl py-3 font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)] transition-transform duration-150 active:scale-[0.96] disabled:active:scale-100 ${
                    unlocked ? 'bg-ios-card text-ios-label' : 'bg-ios-card text-ios-secondary-label opacity-50'
                  }`}
                >
                  <span>{level}</span>
                  {played && (
                    <span className="text-xs text-ios-gold">{'★'.repeat(stars)}{'☆'.repeat(3 - stars)}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/screens/LevelSelectScreen.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 6: Run the full frontend suite and typecheck**

Run: `cd frontend && npx vitest run` — expect PASS for this file; other files still on old shapes are fixed by later tasks
Run: `cd frontend && npx tsc --noEmit` — expect fewer remaining errors than after Task 10

- [ ] **Step 7: Commit**

```bash
cd frontend
git add src/api/levelProgress.ts src/screens/LevelSelectScreen.tsx src/screens/LevelSelectScreen.test.tsx
git commit -m "Add LevelSelectScreen and its API wrapper"
```

---

### Task 12: Frontend — simplify `HomeScreen`

**Files:**
- Modify: `frontend/src/screens/HomeScreen.tsx`
- Modify: `frontend/src/screens/HomeScreen.test.tsx`

- [ ] **Step 1: Update the test file first**

Read `frontend/src/screens/HomeScreen.test.tsx`'s current content. Remove/replace any assertions about the stats section (avatar, games-played count, win-rate, rating) and update the two button-click navigation assertions from `{ name: 'categorySelect', intent: ... }` to `{ name: 'levelSelect', intent: ... }`. The exact new test content should be:

```tsx
// frontend/src/screens/HomeScreen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HomeScreen } from './HomeScreen';
import * as authContext from '../context/AuthContext';
import * as navigationContext from '../context/NavigationContext';

describe('HomeScreen', () => {
  const navigate = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    navigate.mockClear();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1, firstName: 'Aziz' } as any, loading: false, error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'home' },
      navigate, goBack: vi.fn(), replace: vi.fn(), reset: vi.fn(),
    });
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
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/screens/HomeScreen.test.tsx`
Expected: FAIL — `HomeScreen.tsx` still navigates to `categorySelect` and still renders the stats section.

- [ ] **Step 3: Implement**

Replace `frontend/src/screens/HomeScreen.tsx` in full:

```tsx
// frontend/src/screens/HomeScreen.tsx
import { Lightning, UserPlus } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';

export function HomeScreen() {
  const { user } = useAuth();
  const { navigate } = useNavigation();

  if (!user) return null;

  return (
    <div className="flex min-h-full flex-col justify-center gap-3 p-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
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
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/screens/HomeScreen.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/screens/HomeScreen.tsx src/screens/HomeScreen.test.tsx
git commit -m "Simplify HomeScreen to two buttons navigating to levelSelect"
```

---

### Task 13: Frontend — `WaitingScreen` category → level

**Files:**
- Modify: `frontend/src/screens/WaitingScreen.tsx`
- Modify: `frontend/src/screens/WaitingScreen.test.tsx`
- Modify: `frontend/src/screens/WaitingScreen.integration.test.tsx` (if it references `category`)

- [ ] **Step 1: Update the tests**

Read `frontend/src/screens/WaitingScreen.test.tsx` and `WaitingScreen.integration.test.tsx` in full. Replace every `category={'...'}` prop/usage with `level={<number>}`, and update the two copy-string assertions:

```ts
// old assertions to replace:
expect(screen.getByText(/Umumiy bilim bo'yicha raqib qidirilmoqda/)).toBeInTheDocument();
// new:
expect(screen.getByText(/5-bosqich bo'yicha raqib qidirilmoqda/)).toBeInTheDocument();
```//(adjust the exact level number used in each test's props to match)

Also update every `leaveQueue(category)` call assertion to `leaveLevelQueue(level)`, and the mock socket context object's `leaveQueue`/`joinQueue` keys to `leaveLevelQueue`/`joinLevelQueue` if this file's `mockSocket`-style helper hardcodes those function names.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/screens/WaitingScreen.test.tsx`
Expected: FAIL — `WaitingScreen.tsx` still expects a `category` prop and calls `leaveQueue`.

- [ ] **Step 3: Implement**

In `frontend/src/screens/WaitingScreen.tsx`:

1. Remove the import `import { categoryLabel } from '../utils/category';`

2. Change the component signature:
```tsx
export function WaitingScreen({
  level,
  intent,
}: {
  level: number;
  intent: 'quick' | 'invite' | 'joining';
}) {
```

3. Update the destructured socket context to use the level-aware function:
```tsx
  const {
    matchFound,
    opponent,
    clearMatchFound,
    leaveLevelQueue,
    inviteCreated,
    clearInviteCreated,
    inviteExpired,
    clearInviteExpired,
    connected,
  } = useGameSocketContext();
```
(replacing `leaveQueue` with `leaveLevelQueue`)

4. Update the VS-reveal transition effect's `replace` call:
```tsx
      replace({ name: 'battle', gameId: matchFound.gameId, level: matchFound.level ?? level });
```
(the `?? level` fallback guards against the rare case where `matchFound.level` wasn't populated by the server for some reason — but under normal operation `matchFound.level` is always set for anything reaching this screen, since `WaitingScreen` is now ONLY ever reached via level-mode flows)

5. Update `handleCancel`:
```tsx
  const handleCancel = () => {
    if (intent === 'quick') {
      leaveLevelQueue(level);
    }
    goBack();
  };
```

6. Update the copy strings:
```tsx
      <p className="text-lg font-medium text-ios-label">
        {intent === 'joining'
          ? "Do'stingiz o'yiniga ulanmoqda..."
          : intent === 'invite'
            ? `${level}-bosqich bo'yicha taklif havolasi tayyorlanmoqda...`
            : `${level}-bosqich bo'yicha raqib qidirilmoqda...`}
      </p>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/screens/WaitingScreen.test.tsx src/screens/WaitingScreen.integration.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/screens/WaitingScreen.tsx src/screens/WaitingScreen.test.tsx src/screens/WaitingScreen.integration.test.tsx
git commit -m "Switch WaitingScreen from category to level"
```

---

### Task 14: Frontend — `BattleScreen` category → level

**Files:**
- Modify: `frontend/src/screens/BattleScreen.tsx`
- Modify: `frontend/src/screens/BattleScreen.test.tsx`

- [ ] **Step 1: Update the tests**

Read `frontend/src/screens/BattleScreen.test.tsx` in full. Every `render(<BattleScreen gameId="g1" category="umumiy_bilim" />)`-style call becomes `render(<BattleScreen gameId="g1" level={5} />)` (pick any level number consistent with what each specific test needs), and every assertion on `replace(...)`'s call payload changes its `category: '...'` field to `level: <the same number>`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/screens/BattleScreen.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `frontend/src/screens/BattleScreen.tsx`, this is a pure rename — replace every occurrence of `category` with `level` and adjust the type from `string` to `number`:

```tsx
export function BattleScreen({ gameId, level }: { gameId: string; level: number }) {
```

Both `replace({ name: 'result', ... category, })` call sites (the non-knockout branch and the knockout-reveal-timeout branch) become `replace({ name: 'result', ... level, levelStars: gameOver.levelStars, })` — add `levelStars: gameOver.levelStars` to BOTH of these object literals (it will be `undefined` for non-level games, which is fine since `ResultScreen`'s `levelStars` prop is optional per Task 9's `Screen` union).

Also update the effect's dependency array on that second `useEffect` from `[gameOver, replace, clearGameOver, clearQuestionResult, category]` to `[gameOver, replace, clearGameOver, clearQuestionResult, level]`.

Nothing else in this file changes — `optionTextSizeClass`, the K.O. overlay, the options-rendering logic, and the "Yana ko'rsatish" extra-definitions toggle are all untouched (none of them ever depended on `category`'s actual value, only its presence as a prop to pass through).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/screens/BattleScreen.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/screens/BattleScreen.tsx src/screens/BattleScreen.test.tsx
git commit -m "Switch BattleScreen from category to level, thread levelStars to result"
```

---

### Task 15: Frontend — `ResultScreen` category → level + `levelStars` display

**Files:**
- Modify: `frontend/src/screens/ResultScreen.tsx`
- Modify: `frontend/src/screens/ResultScreen.test.tsx`

This is the one screen that needs an actual new branch, not just a rename — a level-mode result (`levelStars` present) shows a 1-3 star "level complete" presentation instead of the existing win/lose/draw framing, WITHOUT touching the existing `calculateStars`/victory-stars logic (that 1-5 star, HP-margin-based rating is a completely different concept from level-mode's 1-3 own-correct-count stars, per the design spec — the two must stay visually and logically distinct).

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/screens/ResultScreen.test.tsx` (this file already has `mockSocket`/`vi.spyOn` setup for `useAuth`/`useNavigation`/`useGameSocketContext` from its existing tests — reuse that exactly, just swap `category`/`joinQueue` for `level`/`joinLevelQueue` in every existing test in this file too, per Step 1b below):

```tsx
  it('shows a level-complete message with the correct star count when levelStars is present (level mode)', () => {
    render(
      <ResultScreen
        scores={[{ userId: 1, score: 200 }, { userId: 2, score: 150 }]}
        winnerId={1}
        forfeited={false}
        knockout={false}
        level={5}
        levelStars={2}
      />
    );

    expect(screen.getByText(/5-bosqich/)).toBeInTheDocument();
    expect(screen.getByTestId('level-stars')).toBeInTheDocument();
    const filledStars = screen.getByTestId('level-stars').querySelectorAll('.text-ios-gold');
    expect(filledStars.length).toBe(2);
    // The existing HP-margin victory-stars rating must NOT appear alongside
    // the level-mode star rating - they're different concepts and must
    // never be shown together.
    expect(screen.queryByTestId('victory-stars')).not.toBeInTheDocument();
    expect(screen.queryByText("G'alaba qozondingiz!")).not.toBeInTheDocument();
  });

  it('does not show the level-complete branch when levelStars is absent (normal battle result)', () => {
    render(
      <ResultScreen
        scores={[{ userId: 1, score: 200 }]}
        winnerId={1}
        forfeited={false}
        knockout={false}
        level={5}
      />
    );

    expect(screen.queryByTestId('level-stars')).not.toBeInTheDocument();
    expect(screen.getByText("G'alaba qozondingiz!")).toBeInTheDocument();
  });

  it('joins the level queue (not the old category queue) and resets to waiting when "Yana o\'ynash" is clicked', () => {
    render(<ResultScreen scores={[]} winnerId={null} forfeited={false} knockout={false} level={5} />);
    fireEvent.click(screen.getByText("Yana o'ynash"));
    expect(joinLevelQueue).toHaveBeenCalledWith(5);
    expect(reset).toHaveBeenCalledWith({ name: 'waiting', level: 5, intent: 'quick' });
  });
```

Update every OTHER existing test in this file to pass `level={<number>}` instead of `category="umumiy_bilim"` (or whatever string was there), and update the `mockSocket`/`vi.spyOn(gameSocketContext, 'useGameSocketContext')` setup to return `joinLevelQueue` (a fresh `vi.fn()`) instead of `joinQueue`, matching the pattern the new tests above assume (`joinLevelQueue`/`reset` as top-level `const`s declared once, cleared in `beforeEach`, exactly mirroring how `joinQueue`/`reset` were declared before).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/screens/ResultScreen.test.tsx`
Expected: FAIL — `ResultScreen` doesn't accept `level`/`levelStars` yet, still calls `joinQueue`.

- [ ] **Step 3: Implement**

In `frontend/src/screens/ResultScreen.tsx`:

1. Change the component's props:
```tsx
export function ResultScreen({
  scores,
  winnerId,
  forfeited,
  knockout,
  level,
  levelStars,
}: {
  scores: ScoreEntry[];
  winnerId: number | null;
  forfeited: boolean;
  knockout: boolean;
  level: number;
  levelStars?: number;
}) {
```

2. Change the destructured socket context call and `handlePlayAgain`:
```tsx
  const { joinLevelQueue } = useGameSocketContext();
```
```tsx
  const handlePlayAgain = () => {
    joinLevelQueue(level);
    reset({ name: 'waiting', level, intent: 'quick' });
  };
```

3. Add a level-mode branch to the render. Insert this check right after `const isDraw = winnerId === null;` (still keep `isWinner`/`isDraw` computed as before — they're still used by the non-level branch, and `isWinner` is also used to decide whether the existing HP-margin star rating applies, unaffected by this new branch):

```tsx
  const isLevelResult = levelStars !== undefined;
```

4. Replace the JSX's result card contents so that when `isLevelResult` is true, an entirely separate presentation renders instead of the existing win/lose/draw text + victory-stars block. The cleanest way to do this without disturbing the existing (well-tested) non-level JSX is an early return before the normal render:

```tsx
  if (isLevelResult) {
    return (
      <div className="flex min-h-full flex-col justify-center gap-8 p-6">
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-ios-card px-6 py-10 text-center shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
          <h2 className="text-2xl font-bold text-ios-label">{level}-bosqich tugadi!</h2>
          <div className="flex gap-1" data-testid="level-stars">
            {Array.from({ length: 3 }, (_, i) => (
              <span
                key={i}
                className={`animate-star-pop text-3xl ${i < levelStars ? 'text-ios-gold' : 'text-ios-divider'}`}
                style={{ animationDelay: `${i * 150}ms` }}
              >
                ★
              </span>
            ))}
          </div>
          <div className="mt-2 flex flex-col items-center">
            <span className="text-xs font-medium text-ios-secondary-label">Sizning ballingiz</span>
            <span className="text-4xl font-bold tabular-nums text-ios-label">{myScore}</span>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <PrimaryButton onClick={handlePlayAgain}>Yana o'ynash</PrimaryButton>
          <button
            type="button"
            onClick={() => reset({ name: 'home' })}
            className="py-2 text-sm font-medium text-ios-secondary-label"
          >
            Bosh sahifa
          </button>
        </div>
      </div>
    );
  }
```

Place this `if` block right after `const myScore = findMyScore(scores, user.id);` (it needs `myScore` computed already) and before the existing `const opponentScore = ...`/`const resultText = ...` lines — the existing non-level code below this new block is otherwise **completely unchanged**.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/screens/ResultScreen.test.tsx`
Expected: PASS (all tests, both new and pre-existing)

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/screens/ResultScreen.tsx src/screens/ResultScreen.test.tsx
git commit -m "Add level-complete star result branch to ResultScreen, switch category to level"
```

---

### Task 16: Frontend — `App.tsx` Router update, delete `CategorySelectScreen`

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`
- Delete: `frontend/src/screens/CategorySelectScreen.tsx`
- Delete: `frontend/src/screens/CategorySelectScreen.test.tsx`

- [ ] **Step 1: Update `App.tsx`**

1. Replace the import:
```tsx
import { LevelSelectScreen } from './screens/LevelSelectScreen';
```
(replacing `import { CategorySelectScreen } from './screens/CategorySelectScreen';`)

2. Replace the Router switch case:
```tsx
    case 'levelSelect':
      return <LevelSelectScreen intent={current.intent} />;
```
(replacing the `case 'categorySelect': return <CategorySelectScreen intent={current.intent} />;` case)

3. Update the other three cases that destructure `category` off `current`:
```tsx
    case 'waiting':
      return <WaitingScreen level={current.level} intent={current.intent} />;
    case 'battle':
      return <BattleScreen gameId={current.gameId} level={current.level} />;
    case 'result':
      return (
        <ResultScreen
          scores={current.scores}
          winnerId={current.winnerId}
          forfeited={current.forfeited}
          knockout={current.knockout}
          level={current.level}
          levelStars={current.levelStars}
        />
      );
```

4. Update the invite-deep-link effect in `AppShell` (this previously hardcoded `'umumiy_bilim'` since that was the pre-existing default category for the chat-fallback `/start invite_123` flow — the design spec doesn't define what level a chat-fallback invite defaults to, since level invites are always created with a specific level attached via `create_level_invite`; a deep-link arriving through the OLD chat-fallback path with no level information has no sensible level to join, so this path is disabled rather than guessing a default):

```tsx
  useEffect(() => {
    if (loading || error || sessionReplaced || !connected) return;
    if (hasHandledInviteRef.current) return;

    const startParam = getStartParam();
    const match = startParam?.match(/^invite_(\d+)$/);
    if (!match) return;

    hasHandledInviteRef.current = true;
    // This chat-fallback deep-link path (see backend/src/bot/telegramBot.ts's
    // extractStartPayload/buildWebAppUrl) predates level mode and has no way
    // to carry a level number through a plain `/start invite_123` message -
    // level invites are joined via the proper `startapp` query-param path
    // instead (which DOES carry richer state end-to-end), so this fallback
    // is intentionally a no-op now rather than guessing a default level.
  }, [loading, error, sessionReplaced, connected, joinInvite, reset]);
```

Leave the rest of `App.tsx` (the `Router` function's other cases, `AppShell`'s loading/error/sessionReplaced branches, `showBottomNav`, etc.) untouched.

- [ ] **Step 2: Update `App.test.tsx`**

Read `frontend/src/App.test.tsx` in full. It has tests for the invite deep-link effect (asserting `joinInvite`/`reset` get called with `'umumiy_bilim'`) — these tests are for behavior that no longer exists (Step 1.4 above made it a no-op), so update them to assert the OPPOSITE: `joinInvite` is never called even when a valid `invite_123`-shaped `start_param` is present. Any other test in this file that constructs a `Screen` literal with `category`/`categorySelect` needs the same `level`/`levelSelect` rename as Task 9.

- [ ] **Step 3: Delete the orphaned screen**

```bash
cd frontend
git rm src/screens/CategorySelectScreen.tsx src/screens/CategorySelectScreen.test.tsx
```

- [ ] **Step 4: Run the full frontend suite and typecheck**

Run: `cd frontend && npx vitest run`
Expected: PASS. This should be the point where the WHOLE suite is green again (every file that referenced the old `category`/`categorySelect` shape has now been updated across Tasks 9-16).

Run: `cd frontend && npx tsc --noEmit`
Expected: clean, zero errors — if any remain, they're in files this plan hasn't reached yet (e.g. Task 17/18's `QuestionImportForm`/`utils/category.ts`); confirm any remaining errors are ONLY in those two areas before moving on.

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/App.tsx src/App.test.tsx
git commit -m "Update Router for levelSelect, disable the pre-level chat-fallback invite deep-link"
```

---

### Task 17: Frontend — remove category picker from `QuestionImportForm`

**Files:**
- Modify: `frontend/src/components/QuestionImportForm.tsx`
- Modify: `frontend/src/components/QuestionImportForm.test.tsx`

- [ ] **Step 1: Update the tests**

Replace `frontend/src/components/QuestionImportForm.test.tsx` in full:

```tsx
// frontend/src/components/QuestionImportForm.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QuestionImportForm } from './QuestionImportForm';
import * as authContext from '../context/AuthContext';
import * as adminApi from '../api/admin';

describe('QuestionImportForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok',
      user: { id: 1, telegramId: 9999 } as any,
      loading: false,
      error: null,
    });
  });

  it('has no category selection UI', () => {
    render(<QuestionImportForm />);
    expect(screen.queryByLabelText('Turkum')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Yangi turkum nomi')).not.toBeInTheDocument();
    expect(screen.queryByText('+ Yangi turkum')).not.toBeInTheDocument();
  });

  it('disables the upload button until a file is chosen', () => {
    render(<QuestionImportForm />);
    expect(screen.getByRole('button', { name: 'Yuklash' })).toBeDisabled();
  });

  it('uploads the file, always targeting the ingliz_tili category', async () => {
    const importSpy = vi.spyOn(adminApi, 'importQuestions').mockResolvedValue({
      category: { key: 'ingliz_tili', label: 'Ingliz tili' },
      inserted: 5,
      errors: [],
    });

    render(<QuestionImportForm />);

    const file = new File(['dummy'], 'savollar.docx');
    fireEvent.change(screen.getByLabelText('Fayl'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Yuklash' }));

    await waitFor(() => expect(importSpy).toHaveBeenCalledOnce());
    const [formData, token] = importSpy.mock.calls[0];
    expect(token).toBe('tok');
    expect(formData.get('file')).toBe(file);
    expect(formData.get('category')).toBe('ingliz_tili');
    expect(formData.get('newCategoryLabel')).toBeNull();

    await screen.findByText(/5 ta savol qo'shildi/);
  });

  it('shows the list of per-line errors returned alongside a successful import', async () => {
    vi.spyOn(adminApi, 'importQuestions').mockResolvedValue({
      category: { key: 'ingliz_tili', label: 'Ingliz tili' },
      inserted: 1,
      errors: [{ line: 5, message: "to'g'ri javob belgilanmagan" }],
    });

    render(<QuestionImportForm />);

    const file = new File(['dummy'], 'savollar.docx');
    fireEvent.change(screen.getByLabelText('Fayl'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Yuklash' }));

    await screen.findByText(/5-qatorda: to'g'ri javob belgilanmagan/);
  });

  it('shows an error message when the upload fails', async () => {
    vi.spyOn(adminApi, 'importQuestions').mockRejectedValue(new Error('Bunday turkum topilmadi'));

    render(<QuestionImportForm />);

    const file = new File(['dummy'], 'savollar.docx');
    fireEvent.change(screen.getByLabelText('Fayl'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Yuklash' }));

    await screen.findByText('Bunday turkum topilmadi');
  });

  it('disables the file input while uploading', async () => {
    vi.spyOn(adminApi, 'importQuestions').mockReturnValue(new Promise(() => {}));

    render(<QuestionImportForm />);

    const file = new File(['dummy'], 'savollar.docx');
    fireEvent.change(screen.getByLabelText('Fayl'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Yuklash' }));

    await waitFor(() => expect(screen.getByLabelText('Fayl')).toBeDisabled());
  });

  it('resets the file input after a successful upload', async () => {
    vi.spyOn(adminApi, 'importQuestions').mockResolvedValue({
      category: { key: 'ingliz_tili', label: 'Ingliz tili' },
      inserted: 5,
      errors: [],
    });

    render(<QuestionImportForm />);

    const file = new File(['dummy'], 'savollar.docx');
    fireEvent.change(screen.getByLabelText('Fayl'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Yuklash' }));

    await screen.findByText(/5 ta savol qo'shildi/);

    expect((screen.getByLabelText('Fayl') as HTMLInputElement).value).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/QuestionImportForm.test.tsx`
Expected: FAIL — the form still shows category UI and fetches categories on mount.

- [ ] **Step 3: Implement**

Replace `frontend/src/components/QuestionImportForm.tsx` in full:

```tsx
// frontend/src/components/QuestionImportForm.tsx
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { importQuestions } from '../api/admin';
import { QuestionImportResult } from '../api/types';

const INGLIZ_TILI_CATEGORY_KEY = 'ingliz_tili';

export function QuestionImportForm() {
  const { token } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<QuestionImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canUpload = !uploading && file !== null;

  const handleUpload = async () => {
    if (!token || !file) return;
    setUploading(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', INGLIZ_TILI_CATEGORY_KEY);

    try {
      const res = await importQuestions(formData, token);
      setResult(res);
      setFile(null);
      setFileInputKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Noma'lum xatolik yuz berdi");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-ios-card p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
      <h3 className="text-sm font-semibold text-ios-label">Savol qo'shish</h3>

      <input
        key={fileInputKey}
        type="file"
        aria-label="Fayl"
        accept=".docx"
        disabled={uploading}
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setError(null);
          setResult(null);
        }}
      />

      <button
        type="button"
        disabled={!canUpload}
        onClick={handleUpload}
        className="rounded-full bg-ios-blue py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        {uploading ? 'Yuklanmoqda...' : 'Yuklash'}
      </button>

      {result && (
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-ios-green">
            ✅ {result.inserted} ta savol qo'shildi ({result.category.label})
          </p>
          {result.errors.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-ios-red">
              {result.errors.map((e, i) => (
                <li key={i}>
                  {e.line}-qatorda: {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="text-sm text-ios-red">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/QuestionImportForm.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 5: Update `AdminScreen.test.tsx`**

`frontend/src/screens/AdminScreen.test.tsx` has (as of this plan being written) `import * as questionsApi from '../api/questions';` at the top, and each test's `beforeEach` includes `vi.spyOn(questionsApi, 'getCategories').mockResolvedValue({ categories: [] });` — this was only ever there to satisfy `QuestionImportForm`'s old category-fetching effect. Remove both: the import line, and the `vi.spyOn(questionsApi, ...)` line from `beforeEach`. This is required, not optional — Task 18 deletes `api/questions.ts` entirely, and leaving this import in place would break this test file with an unresolved-module error at that point.

Run: `cd frontend && npx vitest run src/screens/AdminScreen.test.tsx`
Expected: PASS (all existing tests in this file, now without the removed mock).

- [ ] **Step 6: Commit**

```bash
cd frontend
git add src/components/QuestionImportForm.tsx src/components/QuestionImportForm.test.tsx src/screens/AdminScreen.test.tsx
git commit -m "Remove category picker from QuestionImportForm, always target ingliz_tili"
```

---

### Task 18: Frontend — delete unused `categoryLabel`/`getCategories`, final full-suite verification

**Files:**
- Modify: `frontend/src/utils/category.ts`
- Delete: `frontend/src/utils/category.test.ts`
- Modify: `frontend/src/api/questions.ts`
- Modify: `frontend/src/api/questions.test.ts`

- [ ] **Step 1: Confirm nothing still uses these**

Run: `cd frontend && grep -rn "categoryLabel\|getCategories" src --include=*.tsx --include=*.ts`

Expected: after Tasks 9-17, the only remaining matches should be inside `utils/category.ts`/`category.test.ts` and `api/questions.ts`/`questions.test.ts` themselves (their own definitions/tests) — no production call sites left. If anything else still matches, stop and investigate before deleting (a leftover call site would break at runtime, not just at typecheck, since these would become genuinely undefined imports).

- [ ] **Step 2: Delete `categoryLabel` and its test**

```bash
cd frontend
git rm src/utils/category.test.ts
```

Replace `frontend/src/utils/category.ts` — since `categoryLabel` was the only export and nothing calls it anymore, delete the whole file:

```bash
git rm src/utils/category.ts
```

- [ ] **Step 3: Remove `getCategories` from `api/questions.ts`**

Since `Category`-fetching is no longer needed anywhere in the frontend (the `Category` TYPE itself, in `api/types.ts`, is still needed — `QuestionImportResult.category` still returns one), delete `frontend/src/api/questions.ts` entirely (it contained only `getCategories`):

```bash
git rm src/api/questions.ts src/api/questions.test.ts
```

- [ ] **Step 4: Run the full frontend suite and typecheck**

Run: `cd frontend && npx vitest run`
Expected: PASS, full suite green, no import errors from the deleted files.

Run: `cd frontend && npx tsc --noEmit`
Expected: clean, zero errors.

Run: `cd frontend && npm run build`
Expected: builds successfully with no errors.

- [ ] **Step 5: Commit**

```bash
cd frontend
git add -A
git commit -m "Delete unused categoryLabel and getCategories now that category selection is gone"
```

---

## After all 18 tasks

Run the full verification sweep from both projects one more time (`backend`: `npx jest`, `npx tsc --noEmit`; `frontend`: `npx vitest run`, `npx tsc --noEmit && npm run build`), then dispatch a final holistic reviewer across the entire feature — in particular re-checking:
- End-to-end: a real `join_level_queue` → `match_found` (with `level`) → `question`/`question_result` (no knockout, all 15 questions) → `game_over` (with per-player `levelStars`) → `level_progress` persisted → `GET /level-progress` reflects it → `LevelSelectScreen` shows the right unlock/star state on next visit.
- That the OLD category-based `join_queue`/`create_invite`/`join_invite` paths are still fully intact in the backend (per the design spec's explicit "nothing changes" section) even though nothing in the frontend calls them anymore — confirm via the existing backend test suite for those paths still passing unchanged.
- That the two different "star" concepts (`ResultScreen.calculateStars`, HP-margin-based, 1-5; and `levelProgress.calculateLevelStars`, own-correct-count-based, 1-3) are never confused or accidentally merged anywhere in the diff.
- The `isLevelUnlocked` logic duplicated between backend (`levelProgress.ts`) and frontend (`LevelSelectScreen.tsx`) stays in sync — flag this as worth a comment/test-parity check in both places if not already sufficiently guarded.

Then use `superpowers:finishing-a-development-branch` as usual for this project (working directly on `master`, so this reduces to: verify, then offer to push). Remind the user that this feature needs the `level_progress` table migrated on the server (`node dist/src/db/migrate.js`) before deploying — no data import/re-import is needed this time (it reuses the already-imported `ingliz_tili` question data as-is).
