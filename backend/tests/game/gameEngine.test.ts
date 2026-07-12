import { pool } from '../../src/config/db';
import { redis, closeRedis } from '../../src/config/redis';
import { setIOForTesting } from '../../src/socket/socketServer';
import { startGame, submitAnswer } from '../../src/game/gameEngine';
import { getGame } from '../../src/game/gameState';
import { upsertUser } from '../../src/users/userRepository';
import { env } from '../../src/config/env';
import { randomUUID } from 'crypto';
import * as questionRepository from '../../src/questions/questionRepository';

// See gameEngineDisconnect.test.ts's identical helper for why this specific
// combination (fake setTimeout/setInterval, real nextTick/setImmediate/
// hrtime/Date, plus polling instead of a fixed number of microtask flushes)
// is required to test a real setTimeout-based delay that itself awaits real
// Redis/Postgres I/O.
async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function createFakeIO() {
  const events: { room: string; event: string; payload: unknown }[] = [];
  const sockets = new Map<string, { id: string; data: Record<string, unknown> }>();
  const fakeIO = {
    sockets: {
      sockets: {
        get(id: string) {
          if (!sockets.has(id)) {
            sockets.set(id, { id, data: {} });
          }
          return sockets.get(id);
        },
      },
    },
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          events.push({ room, event, payload });
        },
      };
    },
  };
  return { fakeIO, events, sockets };
}

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

describe('gameEngine full match flow', () => {
  let player1Id: number;
  let player2Id: number;

  beforeAll(async () => {
    const p1 = await upsertUser(7001, 'p1', 'Player1', null);
    const p2 = await upsertUser(7002, 'p2', 'Player2', null);
    player1Id = p1.id;
    player2Id = p2.id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM matches WHERE player1_id = $1 OR player2_id = $1`, [player1Id]);
    await pool.query(`DELETE FROM users WHERE telegram_id IN (7001, 7002)`);
    await pool.end();
    await closeRedis();
  });

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

  it('clears socket.data.gameId for both players once the match finishes, so their socket can join_queue again', async () => {
    // Regression test: socket.data.gameId used to only ever be SET (on match
    // start/reconnect) and never cleared, so every join_queue/create_invite/
    // join_invite call on the same long-lived socket after a player's first
    // game would be silently ignored forever by socketServer.ts's
    // `if (socket.data.gameId) return;` guards - reported from live testing
    // as "can't start a second game after the first one ends".
    const { fakeIO, events, sockets } = createFakeIO();
    setIOForTesting(fakeIO as any);

    const gameId = randomUUID();
    await startGame(gameId, 'umumiy_bilim', { userId: player1Id, socketId: 'sockA' }, { userId: player2Id, socketId: 'sockB' });

    // Mirror what matchmaker.ts actually does on match start, so this test
    // observes the same before/after transition a real game does. Use the
    // fakeIO's own lazy-creating getter (not the raw `sockets` map directly)
    // so the entries actually exist before we set data on them.
    fakeIO.sockets.sockets.get('sockA')!.data.gameId = gameId;
    fakeIO.sockets.sockets.get('sockB')!.data.gameId = gameId;

    await playRoundsUntilGameOver(gameId, player1Id, player2Id, events);

    expect(events.find((e) => e.event === 'game_over')).toBeDefined();
    expect(sockets.get('sockA')!.data.gameId).toBeUndefined();
    expect(sockets.get('sockB')!.data.gameId).toBeUndefined();
  });

  it('waits env.resultRevealMs after question_result before sending the next question', async () => {
    const originalDelay = env.resultRevealMs;
    (env as { resultRevealMs: number }).resultRevealMs = 2000;
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'hrtime', 'Date'] });

    try {
      const { fakeIO, events } = createFakeIO();
      setIOForTesting(fakeIO as any);

      const gameId = randomUUID();
      await startGame(gameId, 'umumiy_bilim', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' });

      await submitAnswer(gameId, player1Id, 0);
      // Do NOT await this directly: submitAnswer awaits resolveQuestion,
      // which now awaits a real (fake-timer-controlled) setTimeout - with
      // useFakeTimers active, that setTimeout never fires until
      // advanceTimersByTime is called below, so awaiting it here would hang
      // the test forever.
      const secondAnswer = submitAnswer(gameId, player2Id, 1);

      // Let resolveQuestion's synchronous-up-to-the-delay code run (the
      // question_result emit happens BEFORE the delay) and let real
      // Redis/Postgres I/O leading up to that point settle.
      await waitUntil(() => events.some((e) => e.event === 'question_result'));

      // The reveal is showing, but the next question must NOT have been
      // sent yet - this is the actual behavior being tested.
      expect(events.filter((e) => e.event === 'question').length).toBe(1);

      jest.advanceTimersByTime(2000);
      await waitUntil(() => events.filter((e) => e.event === 'question').length >= 2);

      expect(events.filter((e) => e.event === 'question').length).toBe(2);

      await secondAnswer;
    } finally {
      jest.useRealTimers();
      (env as { resultRevealMs: number }).resultRevealMs = originalDelay;
    }
  });

  it('ignores a second answer submission for the same question', async () => {
    const { fakeIO, events } = createFakeIO();
    setIOForTesting(fakeIO as any);

    const gameId = randomUUID();
    await startGame(gameId, 'umumiy_bilim', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' });

    await submitAnswer(gameId, player1Id, 0);
    await submitAnswer(gameId, player1Id, 2); // ignored: player1 already answered question 0

    // Assert the duplicate was ignored *before* the question resolves and the
    // game advances — resolveQuestion() eventually deletes the Redis game
    // state once the match finishes, so this has to be checked mid-game.
    const midGame = await getGame(gameId);
    expect(midGame!.players.find((p) => p.userId === player1Id)!.answers[0]?.selectedOption).toBe(0);

    // Play the rest of the match to completion instead of abandoning it after
    // question 0. Answering only one question leaves every *subsequent*
    // question's 10s timer pending (resolveQuestion() always schedules the
    // next question's timer until the match finishes) — that dangling timer
    // fires ~10s later, after this test file's Redis connection is already
    // closed in afterAll, producing "Jest did not exit" / "Connection is
    // closed" noise on every run. Finishing the match lets finishGame() clear
    // and delete all game state cleanly, with no leftover timer.
    await submitAnswer(gameId, player2Id, 1);
    await playRoundsUntilGameOver(gameId, player1Id, player2Id, events);
  });

  it('still cleans up the game from Redis when recordMatchResult fails (e.g. an FK violation from a bogus userId)', async () => {
    const { fakeIO, events } = createFakeIO();
    setIOForTesting(fakeIO as any);

    // No corresponding row in `users` for this id, so the `matches` table's
    // FK constraint on player2_id rejects the INSERT inside recordMatchResult
    // - the same failure mode the Task 24 load test hit for real (a caller
    // passing a userId that didn't correspond to an actual users row).
    const bogusUserId = 999_999_999;

    // persistMatchResult() is expected to console.error the failure - silence
    // it here so the test output isn't misread as an unhandled crash, while
    // still asserting on it below to confirm the failure was actually logged
    // (not silently swallowed with no trace).
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const gameId = randomUUID();
    await startGame(
      gameId,
      'umumiy_bilim',
      { userId: player1Id, socketId: 'sock1' },
      { userId: bogusUserId, socketId: 'sock2' }
    );

    await playRoundsUntilGameOver(gameId, player1Id, bogusUserId, events);

    // The match still completed from the clients' point of view...
    const gameOverEvent = events.find((e) => e.event === 'game_over');
    expect(gameOverEvent).toBeDefined();

    // ...recordMatchResult's failure was logged with enough context to
    // reconstruct the match manually (not silently dropped)...
    const failureLog = errorSpy.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('recordMatchResult FAILED')
    );
    expect(failureLog).toBeDefined();
    expect(failureLog![0]).toContain(gameId);
    expect(failureLog![0]).toContain(String(bogusUserId));

    // ...no match row was persisted (the write genuinely failed)...
    const matchRow = await pool.query(
      `SELECT * FROM matches WHERE player1_id = $1 AND player2_id = $2`,
      [player1Id, bogusUserId]
    );
    expect(matchRow.rows.length).toBe(0);

    // ...and, critically, the game was still removed from Redis instead of
    // being left stranded in a "finished" state until the 30-minute TTL.
    const gameAfter = await getGame(gameId);
    expect(gameAfter).toBeNull();

    errorSpy.mockRestore();
  });

  it('includes extraDefinitions in question_result only when the resolved question has them', async () => {
    const gameId = randomUUID();
    const { fakeIO, events } = createFakeIO();
    setIOForTesting(fakeIO as any);

    // Force getRandomQuestions to return a single fixture question with
    // extraDefinitions so resolveQuestion() definitely resolves it - real
    // seeded umumiy_bilim questions would make which question comes up (and
    // therefore whether extraDefinitions is present) non-deterministic.
    jest.spyOn(questionRepository, 'getRandomQuestions').mockResolvedValueOnce([
      { id: 999999, text: 'TEST_ENGINE_WithExtra', options: ['a', 'b', 'c', 'd'], correctIndex: 0, extraDefinitions: ['second meaning'] },
    ]);

    await startGame(gameId, 'umumiy_bilim', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' });
    await submitAnswer(gameId, player1Id, 0, 0);
    await submitAnswer(gameId, player2Id, 0, 0);

    const resultEvent = events.find((e) => e.event === 'question_result');
    expect((resultEvent?.payload as { extraDefinitions?: string[] })?.extraDefinitions).toEqual(['second meaning']);
  });

  it('omits extraDefinitions from question_result for a question that has none', async () => {
    const gameId = randomUUID();
    const { fakeIO, events } = createFakeIO();
    setIOForTesting(fakeIO as any);

    jest.spyOn(questionRepository, 'getRandomQuestions').mockResolvedValueOnce([
      { id: 999998, text: 'TEST_ENGINE_NoExtra', options: ['a', 'b', 'c', 'd'], correctIndex: 0 },
    ]);

    await startGame(gameId, 'umumiy_bilim', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' });
    await submitAnswer(gameId, player1Id, 0, 0);
    await submitAnswer(gameId, player2Id, 0, 0);

    const resultEvent = events.find((e) => e.event === 'question_result');
    expect((resultEvent?.payload as { extraDefinitions?: string[] })?.extraDefinitions).toBeUndefined();
  });

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

    it('ends the match as a knockout when both players cross HP_MAX in the same round', async () => {
      // Both players always answer correctly (option 0, matching every mock
      // question's correctIndex), so both scores climb together at ~200/
      // round and cross HP_MAX=500 on the same round (round 3). Their exact
      // scores will likely differ by a few points due to speed-bonus timing
      // variance between the two submitAnswer calls, so this asserts on the
      // general shape of the outcome (match ends, knockout reported, a
      // legitimate winner-or-draw is picked) rather than a hand-computed
      // exact tie - the point is to lock in that finishGame's existing
      // higher-score-wins/exact-tie-is-a-draw logic still runs safely when
      // BOTH players are knocked out in the same round, not to pin down the
      // exact numbers.
      jest.spyOn(questionRepository, 'getRandomQuestions').mockResolvedValue(fixedQuestions(3));

      const { fakeIO, events } = createFakeIO();
      setIOForTesting(fakeIO as any);

      const gameId = randomUUID();
      await startGame(gameId, 'umumiy_bilim', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' });

      for (let i = 0; i < 3; i += 1) {
        await submitAnswer(gameId, player1Id, 0);
        await submitAnswer(gameId, player2Id, 0);
      }

      const gameOverEvent = events.find((e) => e.event === 'game_over');
      expect(gameOverEvent).toBeDefined();
      const payload = gameOverEvent!.payload as { winnerId: number | null; knockout: boolean };
      expect(
        payload.winnerId === null || payload.winnerId === player1Id || payload.winnerId === player2Id
      ).toBe(true);
      expect(payload.knockout).toBe(true);
    });
  });
});
