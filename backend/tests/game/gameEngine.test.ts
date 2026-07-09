import { pool } from '../../src/config/db';
import { redis, closeRedis } from '../../src/config/redis';
import { setIOForTesting } from '../../src/socket/socketServer';
import { startGame, submitAnswer } from '../../src/game/gameEngine';
import { getGame } from '../../src/game/gameState';
import { upsertUser } from '../../src/users/userRepository';
import { env } from '../../src/config/env';
import { randomUUID } from 'crypto';

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

  it('runs a full 7-question match and persists the result', async () => {
    const { fakeIO, events } = createFakeIO();
    setIOForTesting(fakeIO as any);

    const gameId = randomUUID();
    await startGame(gameId, 'umumiy_bilim', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' });

    for (let i = 0; i < 7; i += 1) {
      const questionEvent = events.filter((e) => e.event === 'question')[i];
      expect(questionEvent).toBeDefined();

      await submitAnswer(gameId, player1Id, 0);
      await submitAnswer(gameId, player2Id, 1);
    }

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

    for (let i = 0; i < 7; i += 1) {
      expect(events.filter((e) => e.event === 'question')[i]).toBeDefined();
      await submitAnswer(gameId, player1Id, 0);
      await submitAnswer(gameId, player2Id, 1);
    }

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
    const { fakeIO } = createFakeIO();
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
    for (let i = 1; i < 7; i += 1) {
      await submitAnswer(gameId, player1Id, 0);
      await submitAnswer(gameId, player2Id, 1);
    }
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

    for (let i = 0; i < 7; i += 1) {
      await submitAnswer(gameId, player1Id, 0);
      await submitAnswer(gameId, bogusUserId, 1);
    }

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
});
