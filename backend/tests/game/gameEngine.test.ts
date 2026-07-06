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
    await submitAnswer(gameId, player1Id, 2);

    const game = await getGame(gameId);
    expect(game!.players.find((p) => p.userId === player1Id)!.answers[0]?.selectedOption).toBe(0);
  });
});
