# HP/Knockout Battle Mechanic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn BilimBattle's 1v1 quiz match into a real HP/knockout battle: each player starts with 500 HP (derived from the existing score field, no new state), correct answers deal damage to the opponent, and the match ends immediately once someone's HP hits 0 - with satisfying hit effects and a victory star rating.

**Architecture:** HP is computed, not stored: `myHP = 500 - opponentScore`. This means the existing tug-of-war bar formula in `BattleHeader.tsx` needs zero changes (it's already mathematically equivalent to an HP difference). The only real backend change is one new "has anyone crossed 500?" check in `gameEngine.ts` that ends the match early via the existing `finishGame()` winner-determination logic. The frontend adds: a `knockout` flag threaded from the socket event through navigation state, a brief "K.O.!" overlay, hit-impact animations on the battle header, and a star rating on the result screen.

**Tech Stack:** Node/Express/Socket.io backend (Jest, real Postgres/Redis), React/TS frontend (Vitest + RTL, Tailwind v4 `@theme` animations).

**Reference spec:** `docs/superpowers/specs/2026-07-11-hp-knockout-battle-design.md`

---

## Before You Start

Backend tests hit a real local Postgres/Redis (per `backend/.env`). Make sure both are running and migrated (`cd backend && npm run migrate`) before running any backend test task.

---

### Task 1: Backend — HP/knockout core logic

**Files:**
- Modify: `backend/src/game/gameEngine.ts`
- Modify: `backend/tests/game/gameEngine.test.ts`

This task has two parts: (A) update the 5 EXISTING tests so they stop assuming every match runs exactly 7 fixed rounds (a match can now end earlier via knockout), and (B) add new tests for the knockout behavior itself, using mocked questions for deterministic control over who wins each round.

- [ ] **Step 1: Read the current test file and confirm the existing helper shape**

Run: `cat backend/tests/game/gameEngine.test.ts` (or open it) - confirm it still matches the structure described below. All 5 `it(...)` blocks currently loop `for (let i = 0; i < 7; i += 1) { ...; await submitAnswer(gameId, player1Id, 0); await submitAnswer(gameId, player2Id, 1); }` against REAL seeded `umumiy_bilim` questions (random `correctIndex` per question, unpredictable which player scores each round). Once matches can end early via knockout, a fixed 7-iteration loop is no longer a safe assumption - the match may finish (and get deleted from Redis) before the loop count is reached, and further `submitAnswer` calls just harmlessly no-op on a finished/deleted game. Replace the fixed loop with a "keep playing until game_over fires" loop in each of these 5 tests.

- [ ] **Step 2: Add a `playRoundsUntilGameOver` helper and update the 5 existing tests**

In `backend/tests/game/gameEngine.test.ts`, add this helper function right after the existing `createFakeIO` function (before `describe('gameEngine full match flow', ...)`):

```ts
// A match can now end before all questions are used up (knockout), so tests
// that just want to play a match TO COMPLETION (regardless of exactly how
// many rounds that takes) poll for game_over instead of assuming a fixed
// round count. maxRounds is a safety cap so a genuine bug (game_over never
// firing) fails fast with a clear "ran out of rounds" symptom instead of
// hanging.
async function playRoundsUntilGameOver(
  gameId: string,
  player1Id: number,
  player2Id: number,
  events: { event: string }[],
  maxRounds = 20
): Promise<void> {
  let rounds = 0;
  while (!events.some((e) => e.event === 'game_over') && rounds < maxRounds) {
    await submitAnswer(gameId, player1Id, 0);
    await submitAnswer(gameId, player2Id, 1);
    rounds += 1;
  }
}
```

Then update each of the 5 existing tests:

**Test 1** (`'runs a full 7-question match and persists the result'`) - rename it to drop the "7-question" claim and replace its loop:

```ts
  it('runs a match to completion and persists the result', async () => {
    const { fakeIO, events } = createFakeIO();
    setIOForTesting(fakeIO as any);

    const gameId = randomUUID();
    await startGame(gameId, 'umumiy_bilim', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' });

    await playRoundsUntilGameOver(gameId, player1Id, player2Id, events);

    const gameOverEvent = events.find((e) => e.event === 'game_over');
    expect(gameOverEvent).toBeDefined();
    const payload = gameOverEvent!.payload as { scores: { userId: number; score: number }[] };
    expect(payload.scores.length).toBe(2);

    const matchRow = await pool.query(
      `SELECT * FROM matches WHERE player1_id = $1 AND player2_id = $2 ORDER BY id DESC LIMIT 1`,
      [player1Id, player2Id]
    );
    expect(matchRow.rows.length).toBe(1);
  });
```

**Test 2** (`'clears socket.data.gameId for both players...'`) - replace its loop and drop the per-iteration `expect(events.filter(...)[i]).toBeDefined()` check (round count is no longer fixed):

```ts
  it('clears socket.data.gameId for both players once the match finishes, so their socket can join_queue again', async () => {
    const { fakeIO, events, sockets } = createFakeIO();
    setIOForTesting(fakeIO as any);

    const gameId = randomUUID();
    await startGame(gameId, 'umumiy_bilim', { userId: player1Id, socketId: 'sockA' }, { userId: player2Id, socketId: 'sockB' });

    fakeIO.sockets.sockets.get('sockA')!.data.gameId = gameId;
    fakeIO.sockets.sockets.get('sockB')!.data.gameId = gameId;

    await playRoundsUntilGameOver(gameId, player1Id, player2Id, events);

    expect(events.find((e) => e.event === 'game_over')).toBeDefined();
    expect(sockets.get('sockA')!.data.gameId).toBeUndefined();
    expect(sockets.get('sockB')!.data.gameId).toBeUndefined();
  });
```

**Test 3** (`'waits env.resultRevealMs after question_result...'`) - **leave this one completely unchanged.** It only ever plays a single round (never loops to completion), so it isn't affected by the knockout change.

**Test 4** (`'ignores a second answer submission for the same question'`) - replace only the trailing "finish the match" loop, keep the duplicate-answer check at the top as-is:

```ts
  it('ignores a second answer submission for the same question', async () => {
    const { fakeIO, events } = createFakeIO();
    setIOForTesting(fakeIO as any);

    const gameId = randomUUID();
    await startGame(gameId, 'umumiy_bilim', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' });

    await submitAnswer(gameId, player1Id, 0);
    await submitAnswer(gameId, player1Id, 2); // ignored: player1 already answered question 0

    const midGame = await getGame(gameId);
    expect(midGame!.players.find((p) => p.userId === player1Id)!.answers[0]?.selectedOption).toBe(0);

    await submitAnswer(gameId, player2Id, 1);
    await playRoundsUntilGameOver(gameId, player1Id, player2Id, events);
  });
```

**Test 5** (`'still cleans up the game from Redis when recordMatchResult fails...'`) - replace its loop:

```ts
  it('still cleans up the game from Redis when recordMatchResult fails (e.g. an FK violation from a bogus userId)', async () => {
    const { fakeIO, events } = createFakeIO();
    setIOForTesting(fakeIO as any);

    const bogusUserId = 999_999_999;
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const gameId = randomUUID();
    await startGame(
      gameId,
      'umumiy_bilim',
      { userId: player1Id, socketId: 'sock1' },
      { userId: bogusUserId, socketId: 'sock2' }
    );

    await playRoundsUntilGameOver(gameId, player1Id, bogusUserId, events);

    const gameOverEvent = events.find((e) => e.event === 'game_over');
    expect(gameOverEvent).toBeDefined();

    const failureLog = errorSpy.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('recordMatchResult FAILED')
    );
    expect(failureLog).toBeDefined();
    expect(failureLog![0]).toContain(gameId);
    expect(failureLog![0]).toContain(String(bogusUserId));

    const matchRow = await pool.query(
      `SELECT * FROM matches WHERE player1_id = $1 AND player2_id = $2`,
      [player1Id, bogusUserId]
    );
    expect(matchRow.rows.length).toBe(0);

    const gameAfter = await getGame(gameId);
    expect(gameAfter).toBeNull();

    errorSpy.mockRestore();
  });
```

- [ ] **Step 3: Run the updated existing tests to confirm they still pass (before the knockout feature exists)**

Run: `cd backend && npx jest tests/game/gameEngine.test.ts`
Expected: PASS (all 5 tests green - this confirms the loop-refactor alone didn't break anything, before any new behavior is added)

- [ ] **Step 4: Write the failing tests for the knockout mechanic**

Add this near the top of `backend/tests/game/gameEngine.test.ts`, with the other imports:

```ts
import * as questionRepository from '../../src/questions/questionRepository';
```

Add this new `describe` block at the end of the file, right before the final closing `});` of `describe('gameEngine full match flow', ...)` (i.e. as a sibling `describe` nested inside it, or immediately after it - either is fine, just keep it inside the same file):

```ts
  describe('HP/knockout mechanic', () => {
    function fixedQuestions(count: number) {
      return Array.from({ length: count }, (_, i) => ({
        id: 9000 + i,
        text: `Mock savol ${i}`,
        options: ["To'g'ri", 'Xato'],
        correctIndex: 0,
      }));
    }

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("ends the match immediately via knockout once a player's score reaches 500, without waiting for all 15 questions", async () => {
      jest.spyOn(questionRepository, 'getRandomQuestions').mockResolvedValue(fixedQuestions(15));

      const { fakeIO, events } = createFakeIO();
      setIOForTesting(fakeIO as any);

      const gameId = randomUUID();
      await startGame(gameId, 'umumiy_bilim', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' });

      // player1 always answers correctly (option 0, matching every mock
      // question's correctIndex), player2 always wrong (option 1). Near-
      // instant answers score close to the 200-point max (100 base + ~100
      // speed bonus), so player1 crosses HP_MAX=500 within 3 rounds.
      await playRoundsUntilGameOver(gameId, player1Id, player2Id, events);

      const questionEvents = events.filter((e) => e.event === 'question');
      expect(questionEvents.length).toBeLessThan(15);

      const gameOverEvent = events.find((e) => e.event === 'game_over');
      expect(gameOverEvent).toBeDefined();
      const payload = gameOverEvent!.payload as { winnerId: number | null; knockout: boolean };
      expect(payload.winnerId).toBe(player1Id);
      expect(payload.knockout).toBe(true);
    });

    it('ends the match without a knockout once the question pool is exhausted, if neither player reaches 500', async () => {
      // Both players always answer wrong - scores stay 0-0 the whole match,
      // so it can only end via the question pool running out (here, 3
      // questions), never via knockout.
      jest.spyOn(questionRepository, 'getRandomQuestions').mockResolvedValue(fixedQuestions(3));

      const { fakeIO, events } = createFakeIO();
      setIOForTesting(fakeIO as any);

      const gameId = randomUUID();
      await startGame(gameId, 'umumiy_bilim', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' });

      for (let i = 0; i < 3; i += 1) {
        await submitAnswer(gameId, player1Id, 1);
        await submitAnswer(gameId, player2Id, 1);
      }

      const gameOverEvent = events.find((e) => e.event === 'game_over');
      expect(gameOverEvent).toBeDefined();
      const payload = gameOverEvent!.payload as { winnerId: number | null; knockout: boolean };
      expect(payload.winnerId).toBeNull();
      expect(payload.knockout).toBe(false);
    });

    it('does not mark a normal (non-knockout) match completion as a knockout', async () => {
      // 2-question pool, player1 answers correctly both times (~200/round,
      // ~400 total - comfortably under HP_MAX=500 the whole match). The
      // match ends because the pool ran out, not because anyone was
      // knocked out, even though player1 clearly won on points. (Using a
      // 3-question pool here instead would have player1 cross 500 on the
      // final question and turn this into an actual knockout - the pool
      // size is deliberately small enough to stay under the threshold.)
      jest.spyOn(questionRepository, 'getRandomQuestions').mockResolvedValue(fixedQuestions(2));

      const { fakeIO, events } = createFakeIO();
      setIOForTesting(fakeIO as any);

      const gameId = randomUUID();
      await startGame(gameId, 'umumiy_bilim', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' });

      for (let i = 0; i < 2; i += 1) {
        await submitAnswer(gameId, player1Id, 0);
        await submitAnswer(gameId, player2Id, 1);
      }

      const gameOverEvent = events.find((e) => e.event === 'game_over');
      expect(gameOverEvent).toBeDefined();
      const payload = gameOverEvent!.payload as { winnerId: number | null; knockout: boolean };
      expect(payload.winnerId).toBe(player1Id);
      expect(payload.knockout).toBe(false);
    });
  });
```

- [ ] **Step 5: Run the new tests to verify they fail**

Run: `cd backend && npx jest tests/game/gameEngine.test.ts`
Expected: The 3 new "HP/knockout mechanic" tests FAIL (the `knockout` field doesn't exist on the emitted payload yet, and nothing currently ends a match early on reaching 500 points).

- [ ] **Step 6: Implement the knockout logic in `gameEngine.ts`**

In `backend/src/game/gameEngine.ts`:

Change the `QUESTIONS_PER_GAME` constant:

```ts
const QUESTIONS_PER_GAME = 15;
```

Add a new constant right below it:

```ts
// A player's HP is derived, not stored: myHP = HP_MAX - opponentScore. So
// "opponent's score has reached HP_MAX" and "opponent's HP has reached 0"
// are the exact same condition - this constant is the only new piece of
// state this feature needs.
const HP_MAX = 500;
```

Change `resolveQuestion()` from:

```ts
async function resolveQuestion(gameId: string): Promise<void> {
  activeTimers.delete(gameId);
  const game = await getGame(gameId);
  if (!game) return;
  const question = game.questions[game.currentQuestionIndex];
  getIO().to(gameId).emit('question_result', {
    index: game.currentQuestionIndex,
    correctIndex: question.correctIndex,
    scores: game.players.map((p) => ({ userId: p.userId, score: p.score })),
  });
  // Give clients a moment to actually see the correct-answer reveal before
  // the next question replaces it - without this, sendNextQuestion below ran
  // in the very same tick as the emit above, so the green/red highlight was
  // effectively invisible (reported from live testing: "bosilishi bilan
  // tezda keyingi savolga o'tib ketyapti"). env.resultRevealMs defaults to 0
  // (no delay) so local dev and the test suite - which play through full
  // matches in a tight loop - stay fast; production sets a real value via
  // docker-compose.
  if (env.resultRevealMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, env.resultRevealMs));
  }
  await sendNextQuestion(gameId);
}
```

to:

```ts
async function resolveQuestion(gameId: string): Promise<void> {
  activeTimers.delete(gameId);
  const game = await getGame(gameId);
  if (!game) return;
  const question = game.questions[game.currentQuestionIndex];
  getIO().to(gameId).emit('question_result', {
    index: game.currentQuestionIndex,
    correctIndex: question.correctIndex,
    scores: game.players.map((p) => ({ userId: p.userId, score: p.score })),
  });
  // Give clients a moment to actually see the correct-answer reveal before
  // the next question replaces it - without this, sendNextQuestion below ran
  // in the very same tick as the emit above, so the green/red highlight was
  // effectively invisible (reported from live testing: "bosilishi bilan
  // tezda keyingi savolga o'tib ketyapti"). env.resultRevealMs defaults to 0
  // (no delay) so local dev and the test suite - which play through full
  // matches in a tight loop - stay fast; production sets a real value via
  // docker-compose.
  if (env.resultRevealMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, env.resultRevealMs));
  }

  // A player's score reaching HP_MAX means the OPPONENT's derived HP has
  // reached 0 - end the match right now instead of waiting for the
  // remaining questions. If both players cross HP_MAX in the very same
  // round (both answered this question correctly), finishGame's existing
  // winner-determination logic (higher score wins, exact tie = draw)
  // handles it correctly with no extra logic needed here.
  const anyoneKnockedOut = game.players.some((p) => p.score >= HP_MAX);
  if (anyoneKnockedOut) {
    await finishGame(gameId, { knockout: true });
    return;
  }

  await sendNextQuestion(gameId);
}
```

Change `finishGame()`'s signature and emit from:

```ts
async function finishGame(gameId: string): Promise<void> {
  const game = await getGame(gameId);
  if (!game) return;
  game.status = 'finished';
  await saveGame(game);
  const [p1, p2] = game.players;
  const winnerId = p1.score === p2.score ? null : p1.score > p2.score ? p1.userId : p2.userId;

  getIO().to(gameId).emit('game_over', {
    scores: game.players.map((p) => ({ userId: p.userId, score: p.score })),
    winnerId,
  });
```

to:

```ts
async function finishGame(gameId: string, opts?: { knockout?: boolean }): Promise<void> {
  const game = await getGame(gameId);
  if (!game) return;
  game.status = 'finished';
  await saveGame(game);
  const [p1, p2] = game.players;
  const winnerId = p1.score === p2.score ? null : p1.score > p2.score ? p1.userId : p2.userId;

  getIO().to(gameId).emit('game_over', {
    scores: game.players.map((p) => ({ userId: p.userId, score: p.score })),
    winnerId,
    knockout: opts?.knockout ?? false,
  });
```

(Everything below that line in `finishGame` - `persistMatchResult`, timer cleanup, `clearSocketGameId`, `deleteGame` - is unchanged.)

**Do not touch `forfeitIfStillDisconnected`** - it emits its own `game_over` directly (it doesn't call `finishGame`) and simply never sets `knockout`, which is fine: the frontend already treats a missing `knockout` field as `false`.

- [ ] **Step 7: Run all of `gameEngine.test.ts` to verify everything passes**

Run: `cd backend && npx jest tests/game/gameEngine.test.ts`
Expected: PASS (all 8 tests green - 5 pre-existing + 3 new)

- [ ] **Step 8: Run the full backend suite to check for regressions**

Run: `cd backend && npx jest`
Expected: PASS (no regressions in other files - `gameEngineDisconnect.test.ts` and others don't play a match to completion, so they're unaffected)

- [ ] **Step 9: Commit**

```bash
cd backend
git add src/game/gameEngine.ts tests/game/gameEngine.test.ts
git commit -m "Add HP/knockout match ending - a player's score reaching 500 ends the match immediately"
```

---

### Task 2: Frontend — thread `knockout` through the stack + BattleScreen K.O. overlay

**Files:**
- Modify: `frontend/src/socket/useGameSocket.ts`
- Modify: `frontend/src/context/NavigationContext.tsx`
- Modify: `frontend/src/screens/BattleScreen.tsx`
- Modify: `frontend/src/screens/BattleScreen.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Add `knockout` to the type definitions**

In `frontend/src/socket/useGameSocket.ts`, change:

```ts
export interface GameOverPayload {
  scores: ScoreEntry[];
  winnerId: number | null;
  forfeited?: boolean;
}
```

to:

```ts
export interface GameOverPayload {
  scores: ScoreEntry[];
  winnerId: number | null;
  forfeited?: boolean;
  knockout?: boolean;
}
```

In `frontend/src/context/NavigationContext.tsx`, change:

```ts
  | { name: 'result'; scores: ScoreEntry[]; winnerId: number | null; forfeited: boolean; category: string }
```

to:

```ts
  | { name: 'result'; scores: ScoreEntry[]; winnerId: number | null; forfeited: boolean; knockout: boolean; category: string }
```

- [ ] **Step 2: Run typecheck to see the now-broken call sites**

Run: `cd frontend && npx tsc --noEmit`
Expected: FAIL - `BattleScreen.tsx`'s `replace({name: 'result', ...})` call and `App.tsx`'s `<ResultScreen ... />` call are both now missing the required `knockout` field.

- [ ] **Step 3: Write the failing test for the K.O. overlay**

In `frontend/src/screens/BattleScreen.test.tsx`, update the import line at the top to add `act`:

```ts
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
```

Update the existing `'navigates to the result screen (via replace) when gameOver arrives'` test to expect the new `knockout` field:

```ts
  it('navigates to the result screen (via replace) when gameOver arrives', async () => {
    mockSocket({
      gameOver: { scores: [{ userId: 1, score: 400 }], winnerId: 1, forfeited: false },
    });
    render(<BattleScreen gameId="g1" category="umumiy_bilim" />);

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({
        name: 'result', scores: [{ userId: 1, score: 400 }], winnerId: 1, forfeited: false, knockout: false, category: 'umumiy_bilim',
      })
    );
    expect(clearGameOver).toHaveBeenCalledOnce();
  });
```

Add a new test right after it:

```ts
  it('shows a "K.O.!" overlay before navigating to the result screen when the match ends by knockout', async () => {
    vi.useFakeTimers();
    try {
      mockSocket({
        gameOver: {
          scores: [{ userId: 1, score: 500 }, { userId: 2, score: 200 }],
          winnerId: 1,
          forfeited: false,
          knockout: true,
        },
      });
      render(<BattleScreen gameId="g1" category="umumiy_bilim" />);

      expect(screen.getByText('K.O.!')).toBeInTheDocument();
      expect(replace).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(1200);
      });

      expect(replace).toHaveBeenCalledWith({
        name: 'result',
        scores: [{ userId: 1, score: 500 }, { userId: 2, score: 200 }],
        winnerId: 1,
        forfeited: false,
        knockout: true,
        category: 'umumiy_bilim',
      });
      expect(clearGameOver).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/screens/BattleScreen.test.tsx`
Expected: FAIL - the updated assertion doesn't match the current `replace` call (missing `knockout`), and the new K.O. test can't find "K.O.!" text anywhere.

- [ ] **Step 5: Add the K.O. animation keyframe**

In `frontend/src/index.css`, add this line inside the `@theme { ... }` block, right after `--animate-shine: shine 4s ease-in-out infinite;`:

```css
  --animate-ko-reveal: ko-reveal 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both;
```

Add this new keyframe block right after the existing `@keyframes shine { ... }` block (before the `@media (prefers-reduced-motion: reduce)` block):

```css
@keyframes ko-reveal {
  from {
    opacity: 0;
    transform: scale(0.5);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
```

- [ ] **Step 6: Update `BattleScreen.tsx`**

Add a `KO_REVEAL_MS` constant right before the `export function BattleScreen` line:

```ts
const KO_REVEAL_MS = 1200;
```

Add a new state right after the existing `const [restoredScores, setRestoredScores] = useState<ScoreEntry[]>([]);` line:

```ts
  const [showKnockout, setShowKnockout] = useState(false);
```

Replace the existing `gameOver` effect:

```tsx
  useEffect(() => {
    if (gameOver) {
      replace({
        name: 'result',
        scores: gameOver.scores,
        winnerId: gameOver.winnerId,
        forfeited: gameOver.forfeited ?? false,
        category,
      });
      clearGameOver();
      clearQuestionResult();
    }
  }, [gameOver, replace, clearGameOver, clearQuestionResult, category]);
```

with these three effects:

```tsx
  // A knockout ending shows a brief "K.O.!" overlay before transitioning -
  // flip this flag here, but don't navigate/clear state yet; the
  // delayed-transition effect below owns that once the overlay has had its
  // moment.
  useEffect(() => {
    if (gameOver?.knockout) {
      setShowKnockout(true);
    }
  }, [gameOver]);

  // Non-knockout endings (the match ran its full course, or a player
  // forfeited) transition immediately - no overlay, matches the original
  // behavior exactly.
  useEffect(() => {
    if (!gameOver || gameOver.knockout) return;
    replace({
      name: 'result',
      scores: gameOver.scores,
      winnerId: gameOver.winnerId,
      forfeited: gameOver.forfeited ?? false,
      knockout: false,
      category,
    });
    clearGameOver();
    clearQuestionResult();
  }, [gameOver, replace, clearGameOver, clearQuestionResult, category]);

  // Knockout endings hold on the "K.O.!" overlay for KO_REVEAL_MS before
  // transitioning. This MUST be its own effect with these exact
  // dependencies (not folded into the one above, and not keyed off
  // `showKnockout` alone) - see WaitingScreen.tsx's VS-reveal effect for the
  // identical pattern and the production bug it was written to avoid: a
  // cleanup tied to a dependency that changes more than once fires on every
  // change, not just on unmount, which would immediately undo the state
  // transition it's supposed to survive.
  useEffect(() => {
    if (!showKnockout || !gameOver) return;
    const timer = setTimeout(() => {
      replace({
        name: 'result',
        scores: gameOver.scores,
        winnerId: gameOver.winnerId,
        forfeited: gameOver.forfeited ?? false,
        knockout: true,
        category,
      });
      clearGameOver();
      clearQuestionResult();
    }, KO_REVEAL_MS);
    return () => clearTimeout(timer);
  }, [showKnockout, gameOver, replace, clearGameOver, clearQuestionResult, category]);
```

Add a new early-return in the render, right before the existing `if (!question) { ... }` block:

```tsx
  if (showKnockout) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-ios-bg">
        <span className="animate-ko-reveal text-6xl font-black text-ios-red">K.O.!</span>
      </div>
    );
  }

```

- [ ] **Step 7: Update `App.tsx`**

Change:

```tsx
    case 'result':
      return (
        <ResultScreen
          scores={current.scores}
          winnerId={current.winnerId}
          forfeited={current.forfeited}
          category={current.category}
        />
      );
```

to:

```tsx
    case 'result':
      return (
        <ResultScreen
          scores={current.scores}
          winnerId={current.winnerId}
          forfeited={current.forfeited}
          knockout={current.knockout}
          category={current.category}
        />
      );
```

(This will still show a type error until Task 4 adds `knockout` to `ResultScreen`'s props - that's expected and fixed by the next task, not this one. `npx tsc --noEmit` will not be fully clean until Task 4 lands.)

- [ ] **Step 8: Run the BattleScreen tests to verify they pass**

Run: `cd frontend && npx vitest run src/screens/BattleScreen.test.tsx`
Expected: PASS (all tests green, including the new K.O. overlay test)

- [ ] **Step 9: Commit**

```bash
cd frontend
git add src/socket/useGameSocket.ts src/context/NavigationContext.tsx src/screens/BattleScreen.tsx src/screens/BattleScreen.test.tsx src/App.tsx src/index.css
git commit -m "Thread knockout through the stack and show a K.O. overlay before the result screen"
```

---

### Task 3: Frontend — BattleHeader hit effects

**Files:**
- Modify: `frontend/src/components/BattleHeader.tsx`
- Modify: `frontend/src/components/BattleHeader.test.tsx`
- Modify: `frontend/src/index.css`

The tug-of-war bar's position FORMULA does not change (it's already mathematically an HP difference - see the design spec section 1). This task only adds visual hit-impact effects on top: a damage-number popup, a bouncier bar transition, and a brief shake for big hits.

- [ ] **Step 1: Write the failing tests**

Add these tests to `frontend/src/components/BattleHeader.test.tsx`, inside the existing `describe('BattleHeader', ...)` block (after the last existing test):

```ts
  it('shows a damage number on the opponent side when my score increases (I land a hit)', () => {
    const { rerender } = render(
      <BattleHeader
        scores={[{ userId: 1, score: 0 }, { userId: 2, score: 0 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={0}
        totalQuestions={7}
      />
    );

    rerender(
      <BattleHeader
        scores={[{ userId: 1, score: 200 }, { userId: 2, score: 0 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={1}
        totalQuestions={7}
      />
    );

    expect(screen.getByTestId('damage-opponent')).toHaveTextContent('-200');
    expect(screen.queryByTestId('damage-me')).not.toBeInTheDocument();
  });

  it('shows a damage number on my side when the opponent lands a hit on me', () => {
    const { rerender } = render(
      <BattleHeader
        scores={[{ userId: 1, score: 0 }, { userId: 2, score: 0 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={0}
        totalQuestions={7}
      />
    );

    rerender(
      <BattleHeader
        scores={[{ userId: 1, score: 0 }, { userId: 2, score: 150 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={1}
        totalQuestions={7}
      />
    );

    expect(screen.getByTestId('damage-me')).toHaveTextContent('-150');
    expect(screen.queryByTestId('damage-opponent')).not.toBeInTheDocument();
  });

  it('shows both damage numbers when both players score in the same round', () => {
    const { rerender } = render(
      <BattleHeader
        scores={[{ userId: 1, score: 0 }, { userId: 2, score: 0 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={0}
        totalQuestions={7}
      />
    );

    rerender(
      <BattleHeader
        scores={[{ userId: 1, score: 180 }, { userId: 2, score: 120 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={1}
        totalQuestions={7}
      />
    );

    expect(screen.getByTestId('damage-opponent')).toHaveTextContent('-180');
    expect(screen.getByTestId('damage-me')).toHaveTextContent('-120');
  });

  it('does not show a damage number when the score is unchanged from the previous render', () => {
    const { rerender } = render(
      <BattleHeader
        scores={[{ userId: 1, score: 200 }, { userId: 2, score: 0 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={0}
        totalQuestions={7}
      />
    );

    rerender(
      <BattleHeader
        scores={[{ userId: 1, score: 200 }, { userId: 2, score: 0 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={0}
        totalQuestions={7}
      />
    );

    expect(screen.queryByTestId('damage-opponent')).not.toBeInTheDocument();
    expect(screen.queryByTestId('damage-me')).not.toBeInTheDocument();
  });

  it('clears the damage number after it has been shown for a moment', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(
        <BattleHeader
          scores={[{ userId: 1, score: 0 }, { userId: 2, score: 0 }]}
          opponent={{ telegramId: 222, firstName: 'Vali' }}
          questionIndex={0}
          totalQuestions={7}
        />
      );

      rerender(
        <BattleHeader
          scores={[{ userId: 1, score: 200 }, { userId: 2, score: 0 }]}
          opponent={{ telegramId: 222, firstName: 'Vali' }}
          questionIndex={1}
          totalQuestions={7}
        />
      );
      expect(screen.getByTestId('damage-opponent')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(800);
      });

      expect(screen.queryByTestId('damage-opponent')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies a shake animation only when a hit exceeds the shake threshold', () => {
    const { rerender, container } = render(
      <BattleHeader
        scores={[{ userId: 1, score: 0 }, { userId: 2, score: 0 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={0}
        totalQuestions={7}
      />
    );

    rerender(
      <BattleHeader
        scores={[{ userId: 1, score: 100 }, { userId: 2, score: 0 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={1}
        totalQuestions={7}
      />
    );
    expect(container.querySelector('.animate-battle-shake')).not.toBeInTheDocument();

    rerender(
      <BattleHeader
        scores={[{ userId: 1, score: 300 }, { userId: 2, score: 0 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={2}
        totalQuestions={7}
      />
    );
    expect(container.querySelector('.animate-battle-shake')).toBeInTheDocument();
  });
```

Update the import line at the top of the file to add `act`:

```ts
import { render, screen, act } from '@testing-library/react';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/BattleHeader.test.tsx`
Expected: FAIL - none of `damage-opponent`/`damage-me`/`animate-battle-shake` exist yet.

- [ ] **Step 3: Add the new animation keyframes**

In `frontend/src/index.css`, add these two lines inside the `@theme { ... }` block, right after the `--animate-ko-reveal` line added in Task 2:

```css
  --animate-damage-pop: damage-pop 0.8s ease-out both;
  --animate-battle-shake: battle-shake 0.15s ease-in-out;
```

Add these two keyframe blocks right after the `@keyframes ko-reveal { ... }` block:

```css
@keyframes damage-pop {
  0% {
    opacity: 0;
    transform: translateY(0);
  }
  20% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translateY(-16px);
  }
}

@keyframes battle-shake {
  0%,
  100% {
    transform: translateX(0);
  }
  25% {
    transform: translateX(-3px);
  }
  75% {
    transform: translateX(3px);
  }
}
```

- [ ] **Step 4: Implement the hit effects in `BattleHeader.tsx`**

Replace the full contents of `frontend/src/components/BattleHeader.tsx` with:

```tsx
// frontend/src/components/BattleHeader.tsx
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { BattleAvatar } from './BattleAvatar';
import { ScoreEntry } from '../api/types';
import { OpponentInfo } from '../socket/useGameSocket';
import { findMyScore, findOpponentScore } from '../utils/score';

// At a 500-point lead, the bar is fully at one edge. Chosen as a simple,
// legible starting point (a 7-question match's realistic score spread) -
// adjustable later without needing to touch anything else. This is also
// exactly HP_MAX on the backend (backend/src/game/gameEngine.ts) - a
// player's HP is `HP_MAX - opponentScore`, so this bar's position was
// already mathematically an HP difference before the HP/knockout feature
// existed; nothing about the position formula below changes for it.
const MAX_SWING_POINTS = 500;
const DAMAGE_POPUP_MS = 800;
const SHAKE_THRESHOLD = 150;
const SHAKE_MS = 150;

interface HitInfo {
  toOpponent: number;
  toMe: number;
  id: number;
}

export function BattleHeader({
  scores,
  opponent,
  questionIndex,
  totalQuestions,
}: {
  scores: ScoreEntry[];
  opponent: OpponentInfo | null;
  questionIndex: number;
  totalQuestions: number;
}) {
  const { user } = useAuth();
  const myUserId = user?.id ?? -1;
  const myScore = findMyScore(scores, myUserId);
  const opponentScore = findOpponentScore(scores, myUserId);

  const rawPosition = 50 + ((myScore - opponentScore) / MAX_SWING_POINTS) * 50;
  const position = Math.min(100, Math.max(0, rawPosition));

  const prevScoresRef = useRef({ my: myScore, opponent: opponentScore });
  const hitIdRef = useRef(0);
  const [hit, setHit] = useState<HitInfo | null>(null);
  const [shaking, setShaking] = useState(false);

  // Detects a score increase since the last render (a "hit" landing) by
  // comparing against the previous values, rather than reacting to the
  // `scores` prop identity - `scores` is a fresh array/objects on every
  // question_result even when the numbers inside haven't changed, so
  // comparing prop identity would misfire.
  useEffect(() => {
    const prev = prevScoresRef.current;
    const toOpponent = myScore - prev.my;
    const toMe = opponentScore - prev.opponent;
    prevScoresRef.current = { my: myScore, opponent: opponentScore };

    if (toOpponent <= 0 && toMe <= 0) return;

    hitIdRef.current += 1;
    setHit({ toOpponent, toMe, id: hitIdRef.current });
    const popupTimer = setTimeout(() => setHit(null), DAMAGE_POPUP_MS);

    let shakeTimer: ReturnType<typeof setTimeout> | undefined;
    if (toOpponent > SHAKE_THRESHOLD || toMe > SHAKE_THRESHOLD) {
      setShaking(true);
      shakeTimer = setTimeout(() => setShaking(false), SHAKE_MS);
    }

    return () => {
      clearTimeout(popupTimer);
      if (shakeTimer) clearTimeout(shakeTimer);
    };
  }, [myScore, opponentScore]);

  return (
    <div
      className={`flex flex-col gap-3 rounded-2xl bg-ios-card p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)] ${
        shaking ? 'animate-battle-shake' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BattleAvatar telegramId={user?.telegramId ?? null} size={36} borderColorClass="border-ios-blue" />
          <span className="text-sm font-semibold text-ios-blue">{user?.firstName ?? 'Siz'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ios-red">{opponent?.firstName ?? 'Raqib'}</span>
          <BattleAvatar telegramId={opponent?.telegramId ?? null} size={36} borderColorClass="border-ios-red" />
        </div>
      </div>
      <span className="text-center text-xs font-semibold tabular-nums text-ios-secondary-label">
        {questionIndex + 1}/{totalQuestions}
      </span>
      <div className="flex h-2 w-full overflow-hidden rounded-full">
        <div
          data-testid="tugofwar-blue"
          className="h-full bg-ios-blue transition-[width] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          style={{ width: `${position}%` }}
        />
        <div
          data-testid="tugofwar-red"
          className="h-full bg-ios-red transition-[width] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          style={{ width: `${100 - position}%` }}
        />
      </div>
      {hit && (hit.toMe > 0 || hit.toOpponent > 0) && (
        <div className="flex items-center justify-between text-sm font-bold">
          <span>
            {hit.toMe > 0 && (
              <span key={`me-${hit.id}`} data-testid="damage-me" className="animate-damage-pop text-ios-red">
                -{hit.toMe}
              </span>
            )}
          </span>
          <span>
            {hit.toOpponent > 0 && (
              <span
                key={`opp-${hit.id}`}
                data-testid="damage-opponent"
                className="animate-damage-pop text-ios-blue"
              >
                -{hit.toOpponent}
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/BattleHeader.test.tsx`
Expected: PASS (all tests green, including the 6 new ones)

- [ ] **Step 6: Commit**

```bash
cd frontend
git add src/components/BattleHeader.tsx src/components/BattleHeader.test.tsx src/index.css
git commit -m "Add hit-impact effects (damage popup, shake) to the battle header"
```

---

### Task 4: Frontend — ResultScreen victory stars

**Files:**
- Modify: `frontend/src/screens/ResultScreen.tsx`
- Modify: `frontend/src/screens/ResultScreen.test.tsx`
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `frontend/src/screens/ResultScreen.test.tsx` with:

```tsx
// frontend/src/screens/ResultScreen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResultScreen, calculateStars } from './ResultScreen';
import * as authContext from '../context/AuthContext';
import * as navigationContext from '../context/NavigationContext';
import * as gameSocketContext from '../context/GameSocketContext';
import * as telegram from '../telegram/webApp';
import * as feedback from '../utils/feedback';

describe('ResultScreen', () => {
  const reset = vi.fn();
  const joinQueue = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    reset.mockClear();
    joinQueue.mockClear();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1, firstName: 'Aziz' } as any, loading: false, error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'result', scores: [], winnerId: null, forfeited: false, knockout: false, category: 'umumiy_bilim' },
      navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn(), reset,
    });
    vi.spyOn(gameSocketContext, 'useGameSocketContext').mockReturnValue({
      joinQueue,
    } as any);
    vi.spyOn(feedback, 'playResultFeedback').mockImplementation(() => {});
  });

  it('shows a win message and the player\'s own score when they are the winner', () => {
    render(
      <ResultScreen
        scores={[{ userId: 1, score: 550 }, { userId: 2, score: 300 }]}
        winnerId={1}
        forfeited={false}
        knockout={false}
        category="umumiy_bilim"
      />
    );

    expect(screen.getByText(/G'alaba qozondingiz/)).toBeInTheDocument();
    expect(screen.getByText(/550/)).toBeInTheDocument();
  });

  it('shows a loss message when the other player won', () => {
    render(
      <ResultScreen
        scores={[{ userId: 1, score: 200 }, { userId: 2, score: 500 }]}
        winnerId={2}
        forfeited={false}
        knockout={true}
        category="umumiy_bilim"
      />
    );

    expect(screen.getByText(/Mag'lubiyat/)).toBeInTheDocument();
  });

  it('shows a draw message when winnerId is null', () => {
    render(
      <ResultScreen
        scores={[{ userId: 1, score: 300 }, { userId: 2, score: 300 }]}
        winnerId={null}
        forfeited={false}
        knockout={false}
        category="umumiy_bilim"
      />
    );

    expect(screen.getByText(/Durrang/)).toBeInTheDocument();
  });

  it('shows a forfeit note when the match ended by forfeit', () => {
    render(
      <ResultScreen
        scores={[{ userId: 1, score: 100 }, { userId: 2, score: 0 }]}
        winnerId={1}
        forfeited
        knockout={false}
        category="umumiy_bilim"
      />
    );

    expect(screen.getByText(/o'yindan chiqib ketdi/)).toBeInTheDocument();
  });

  it('joins the queue and resets navigation to a fresh quick-match search when "Yana o\'ynash" is clicked', () => {
    render(<ResultScreen scores={[]} winnerId={null} forfeited={false} knockout={false} category="umumiy_bilim" />);

    fireEvent.click(screen.getByText("Yana o'ynash"));

    expect(joinQueue).toHaveBeenCalledWith('umumiy_bilim');
    expect(reset).toHaveBeenCalledWith({ name: 'waiting', category: 'umumiy_bilim', intent: 'quick' });
  });

  it('resets navigation to home when "Bosh sahifa" is clicked, without joining a queue', () => {
    render(<ResultScreen scores={[]} winnerId={null} forfeited={false} knockout={false} category="umumiy_bilim" />);

    fireEvent.click(screen.getByText('Bosh sahifa'));

    expect(reset).toHaveBeenCalledWith({ name: 'home' });
    expect(joinQueue).not.toHaveBeenCalled();
  });

  it('shares the result when "Do\'stga ulashish" is clicked', () => {
    const shareSpy = vi.spyOn(telegram, 'shareInviteLink').mockImplementation(() => {});

    render(
      <ResultScreen
        scores={[{ userId: 1, score: 450 }]}
        winnerId={1}
        forfeited={false}
        knockout={false}
        category="umumiy_bilim"
      />
    );
    fireEvent.click(screen.getByText("Do'stga ulashish"));

    expect(shareSpy).toHaveBeenCalledOnce();
    const [, text] = shareSpy.mock.calls[0];
    expect(text).toContain('450');
  });

  it('plays "win" result feedback when the player won', () => {
    render(
      <ResultScreen scores={[{ userId: 1, score: 550 }]} winnerId={1} forfeited={false} knockout={false} category="umumiy_bilim" />
    );
    expect(feedback.playResultFeedback).toHaveBeenCalledWith('win');
  });

  it('plays "loss" result feedback when the other player won', () => {
    render(
      <ResultScreen scores={[{ userId: 1, score: 200 }]} winnerId={2} forfeited={false} knockout={false} category="umumiy_bilim" />
    );
    expect(feedback.playResultFeedback).toHaveBeenCalledWith('loss');
  });

  it('plays "draw" result feedback when winnerId is null', () => {
    render(
      <ResultScreen scores={[{ userId: 1, score: 300 }]} winnerId={null} forfeited={false} knockout={false} category="umumiy_bilim" />
    );
    expect(feedback.playResultFeedback).toHaveBeenCalledWith('draw');
  });

  it('shows 5 stars for a dominant win (opponent nearly at full HP loss)', () => {
    render(
      <ResultScreen
        scores={[{ userId: 1, score: 200 }, { userId: 2, score: 50 }]}
        winnerId={1}
        forfeited={false}
        knockout={true}
        category="umumiy_bilim"
      />
    );

    const stars = screen.getByTestId('victory-stars').querySelectorAll('span');
    const filled = Array.from(stars).filter((s) => s.className.includes('text-ios-gold'));
    expect(filled.length).toBe(5);
  });

  it('shows fewer stars for a narrower win', () => {
    render(
      <ResultScreen
        scores={[{ userId: 1, score: 200 }, { userId: 2, score: 420 }]}
        winnerId={1}
        forfeited={false}
        knockout={false}
        category="umumiy_bilim"
      />
    );

    const stars = screen.getByTestId('victory-stars').querySelectorAll('span');
    const filled = Array.from(stars).filter((s) => s.className.includes('text-ios-gold'));
    expect(filled.length).toBe(1);
  });

  it('does not show stars when the player lost', () => {
    render(
      <ResultScreen
        scores={[{ userId: 1, score: 200 }, { userId: 2, score: 500 }]}
        winnerId={2}
        forfeited={false}
        knockout={true}
        category="umumiy_bilim"
      />
    );
    expect(screen.queryByTestId('victory-stars')).not.toBeInTheDocument();
  });

  it('does not show stars in a draw', () => {
    render(
      <ResultScreen
        scores={[{ userId: 1, score: 300 }, { userId: 2, score: 300 }]}
        winnerId={null}
        forfeited={false}
        knockout={false}
        category="umumiy_bilim"
      />
    );
    expect(screen.queryByTestId('victory-stars')).not.toBeInTheDocument();
  });

  it('does not show stars when the win was by forfeit', () => {
    render(
      <ResultScreen
        scores={[{ userId: 1, score: 100 }, { userId: 2, score: 0 }]}
        winnerId={1}
        forfeited
        knockout={false}
        category="umumiy_bilim"
      />
    );
    expect(screen.queryByTestId('victory-stars')).not.toBeInTheDocument();
  });
});

describe('calculateStars', () => {
  it('returns 5 stars at 80% or more remaining HP', () => {
    expect(calculateStars(50)).toBe(5);
    expect(calculateStars(100)).toBe(5);
  });

  it('returns 4 stars in the 60-79% band', () => {
    expect(calculateStars(200)).toBe(4);
    expect(calculateStars(140)).toBe(4);
  });

  it('returns 3 stars in the 40-59% band', () => {
    expect(calculateStars(300)).toBe(3);
  });

  it('returns 2 stars in the 20-39% band', () => {
    expect(calculateStars(400)).toBe(2);
  });

  it('returns 1 star below 20%, including a loser score at or above 500 (0% or negative, clamped)', () => {
    expect(calculateStars(420)).toBe(1);
    expect(calculateStars(500)).toBe(1);
    expect(calculateStars(600)).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/screens/ResultScreen.test.tsx`
Expected: FAIL - `calculateStars` doesn't exist, `ResultScreen` doesn't accept a `knockout` prop, and no `victory-stars` element exists yet.

- [ ] **Step 3: Add the star animation keyframe**

In `frontend/src/index.css`, add this line inside the `@theme { ... }` block, right after the `--animate-battle-shake` line added in Task 3:

```css
  --animate-star-pop: star-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) both;
```

Add this keyframe block right after `@keyframes battle-shake { ... }`:

```css
@keyframes star-pop {
  from {
    opacity: 0;
    transform: scale(0.3);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
```

- [ ] **Step 4: Implement `calculateStars` and the star display in `ResultScreen.tsx`**

Replace the full contents of `frontend/src/screens/ResultScreen.tsx` with:

```tsx
// frontend/src/screens/ResultScreen.tsx
import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import { useGameSocketContext } from '../context/GameSocketContext';
import { shareInviteLink } from '../telegram/webApp';
import { findMyScore, findOpponentScore } from '../utils/score';
import { playResultFeedback } from '../utils/feedback';
import { ScoreEntry } from '../api/types';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';

const HP_MAX = 500;

// A star rating for the WINNER only, based on how much HP they had left
// (i.e. how little the loser managed to score) when the match ended - a
// near-full-HP win (the loser barely scored) is a 5-star "dominant" victory,
// a narrow win (the loser almost caught up) is a 1-star "close call".
export function calculateStars(loserScore: number): number {
  const remainingHpPct = Math.max(0, (HP_MAX - loserScore) / HP_MAX) * 100;
  if (remainingHpPct >= 80) return 5;
  if (remainingHpPct >= 60) return 4;
  if (remainingHpPct >= 40) return 3;
  if (remainingHpPct >= 20) return 2;
  return 1;
}

export function ResultScreen({
  scores,
  winnerId,
  forfeited,
  knockout,
  category,
}: {
  scores: ScoreEntry[];
  winnerId: number | null;
  forfeited: boolean;
  knockout: boolean;
  category: string;
}) {
  const { user } = useAuth();
  const { reset } = useNavigation();
  const { joinQueue } = useGameSocketContext();
  const isWinner = winnerId === user?.id;
  const isDraw = winnerId === null;

  // Fires once on mount (the outcome for a given result screen never
  // changes) - not gated behind the `!user` guard below since hooks must
  // run unconditionally on every render; user is always set by the time
  // this screen is reachable in practice (see HomeScreen's identical guard).
  useEffect(() => {
    if (!user) return;
    playResultFeedback(isDraw ? 'draw' : isWinner ? 'win' : 'loss');
  }, []);

  if (!user) return null;

  const myScore = findMyScore(scores, user.id);
  const opponentScore = findOpponentScore(scores, user.id);
  const resultText = isDraw ? 'Durrang!' : isWinner ? "G'alaba qozondingiz!" : "Mag'lubiyat";
  // Stars are a "how good was this win" signal - a forfeit win isn't a
  // battle performance to rate, so it's excluded even though the player
  // technically won.
  const showStars = isWinner && !forfeited;
  const stars = showStars ? calculateStars(opponentScore) : 0;

  const handleShare = () => {
    const botUsername = import.meta.env.VITE_BOT_USERNAME ?? 'bilimbattle_bot';
    shareInviteLink(`https://t.me/${botUsername}`, `BilimBattle'da ${myScore} ball to'pladim!`);
  };

  const handlePlayAgain = () => {
    joinQueue(category);
    reset({ name: 'waiting', category, intent: 'quick' });
  };

  const resultColor = isDraw ? 'text-ios-secondary-label' : isWinner ? 'text-ios-green' : 'text-ios-red';

  return (
    <div className="flex min-h-full flex-col justify-center gap-8 p-6">
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-ios-card px-6 py-10 text-center shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
        <h2 className={`text-2xl font-bold ${resultColor}`}>{resultText}</h2>
        {forfeited && (
          <p className="text-sm text-ios-secondary-label">Raqibingiz o'yindan chiqib ketdi</p>
        )}
        {showStars && (
          <div className="flex gap-1" data-testid="victory-stars">
            {Array.from({ length: 5 }, (_, i) => (
              <span
                key={i}
                className={`animate-star-pop text-2xl ${i < stars ? 'text-ios-gold' : 'text-ios-divider'}`}
                style={{ animationDelay: `${i * 150}ms` }}
              >
                ★
              </span>
            ))}
          </div>
        )}
        <div className="mt-2 flex flex-col items-center">
          <span className="text-xs font-medium text-ios-secondary-label">Sizning ballingiz</span>
          <span className="text-4xl font-bold tabular-nums text-ios-label">{myScore}</span>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <PrimaryButton onClick={handlePlayAgain}>Yana o'ynash</PrimaryButton>
        <SecondaryButton onClick={handleShare}>Do'stga ulashish</SecondaryButton>
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

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/screens/ResultScreen.test.tsx`
Expected: PASS (all tests green)

- [ ] **Step 6: Run the full frontend test suite and typecheck**

Run: `cd frontend && npx vitest run`
Expected: PASS (no regressions anywhere)

Run: `cd frontend && npx tsc --noEmit`
Expected: clean (this is the first point in the plan where the whole stack's types line up end to end)

- [ ] **Step 7: Commit**

```bash
cd frontend
git add src/screens/ResultScreen.tsx src/screens/ResultScreen.test.tsx src/index.css
git commit -m "Add victory star rating to the result screen"
```

---

## After All Tasks: Final Verification

- [ ] Run the full backend suite: `cd backend && npx jest`
- [ ] Run backend typecheck: `cd backend && npx tsc --noEmit`
- [ ] Run the full frontend suite: `cd frontend && npx vitest run`
- [ ] Run frontend typecheck + build: `cd frontend && npx tsc --noEmit && npm run build`
- [ ] Visually verify in a browser: a quick match where one side answers fast/correctly several times in a row should show the damage popup, an occasional shake on a big hit, and (if it reaches 500 first) the "K.O.!" overlay followed by a starred result screen.

Then proceed to `superpowers:finishing-a-development-branch` (this project has been working directly on `master` throughout this session - if that's still the case, the only relevant action is running final verification and offering to push).
