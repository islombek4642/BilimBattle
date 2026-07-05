import { pool } from '../../src/config/db';
import { upsertUser, getUserByTelegramId, getOrCreateBotUser, recordMatchResult } from '../../src/users/userRepository';

describe('userRepository', () => {
  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM matches WHERE player1_id IN (SELECT id FROM users WHERE telegram_id IN (111, 222))`);
    await pool.query(`DELETE FROM users WHERE telegram_id IN (111, 222)`);
  });

  it('creates a new user on first upsert and updates on second', async () => {
    const created = await upsertUser(111, 'aziz01', 'Aziz', null);
    expect(created.telegramId).toBe(111);
    expect(created.gamesPlayed).toBe(0);

    const updated = await upsertUser(111, 'aziz_new', 'Aziz', null);
    expect(updated.id).toBe(created.id);
    expect(updated.username).toBe('aziz_new');
  });

  it('finds a user by telegram id', async () => {
    await upsertUser(111, 'aziz01', 'Aziz', null);
    const found = await getUserByTelegramId(111);
    expect(found?.username).toBe('aziz01');
  });

  it('reserves a single bot user across multiple calls', async () => {
    const first = await getOrCreateBotUser();
    const second = await getOrCreateBotUser();
    expect(first.id).toBe(second.id);
    expect(first.telegramId).toBe(0);
  });

  it('records a match result and updates winner/loser stats', async () => {
    const winner = await upsertUser(111, 'winner', 'Vinner', null);
    const loser = await upsertUser(222, 'loser', 'Luzer', null);

    await recordMatchResult({
      category: 'umumiy_bilim',
      player1Id: winner.id,
      player2Id: loser.id,
      player1Score: 500,
      player2Score: 300,
      winnerId: winner.id,
    });

    const updatedWinner = await getUserByTelegramId(111);
    const updatedLoser = await getUserByTelegramId(222);

    expect(updatedWinner?.gamesPlayed).toBe(1);
    expect(updatedWinner?.gamesWon).toBe(1);
    expect(updatedWinner?.currentStreak).toBe(1);
    expect(updatedWinner?.rating).toBe(1020);

    expect(updatedLoser?.gamesPlayed).toBe(1);
    expect(updatedLoser?.gamesWon).toBe(0);
    expect(updatedLoser?.rating).toBe(990);
  });
});
