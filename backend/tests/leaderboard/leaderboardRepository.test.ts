import { pool } from '../../src/config/db';
import { upsertUser } from '../../src/users/userRepository';
import { getGlobalLeaderboard, getFriendsLeaderboard } from '../../src/leaderboard/leaderboardRepository';

describe('leaderboardRepository', () => {
  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id IN (8001, 8002, 8003, 8004)`);
    await pool.end();
  });

  it('orders the global leaderboard by rating descending', async () => {
    await upsertUser(8001, 'low', 'Low', null);
    await pool.query(`UPDATE users SET rating = 900 WHERE telegram_id = 8001`);
    await upsertUser(8002, 'high', 'High', null);
    await pool.query(`UPDATE users SET rating = 1500 WHERE telegram_id = 8002`);

    const board = await getGlobalLeaderboard(10);
    const positions = board.map((e) => e.telegramId);
    expect(positions.indexOf(8002)).toBeLessThan(positions.indexOf(8001));
  });

  it('includes only the inviter and invitees in the friends leaderboard', async () => {
    await upsertUser(8003, 'inviter', 'Inviter', null);
    await upsertUser(8004, 'invitee', 'Invitee', 8003);

    const board = await getFriendsLeaderboard(8003);
    const ids = board.map((e) => e.telegramId).sort();
    expect(ids).toEqual([8003, 8004]);
  });
});
