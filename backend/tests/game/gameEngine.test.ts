import { pool } from '../../src/config/db';
import { redis, closeRedis } from '../../src/config/redis';
import { setIOForTesting } from '../../src/socket/socketServer';
import { startGame, submitAnswer } from '../../src/game/gameEngine';
import { getGame } from '../../src/game/gameState';
import { upsertUser } from '../../src/users/userRepository';
import { randomUUID } from 'crypto';

function createFakeIO() {
  const events: { room: string; event: string; payload: unknown }[] = [];
  const fakeIO = {
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          events.push({ room, event, payload });
        },
      };
    },
  };
  return { fakeIO, events };
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
