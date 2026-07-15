import { pool } from '../../src/config/db';
import { upsertUser, getUserById, recordDailyActivity } from '../../src/users/userRepository';

describe('recordDailyActivity', () => {
  let userId: number;

  beforeAll(async () => {
    const user = await upsertUser(881203, 'dailyActivityTestUser', 'DailyActivityTest', null);
    userId = user.id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id = 881203`);
    await pool.end();
  });

  it('starts a new streak at 1 for a user with no prior activity', async () => {
    const result = await recordDailyActivity(userId);
    expect(result.dailyStreak).toBe(1);
    expect(result.bestDailyStreak).toBe(1);
    const user = await getUserById(userId);
    expect(user?.dailyStreak).toBe(1);
    expect(user?.lastActiveDate).not.toBeNull();
  });

  it('does not increment the streak again for a second activity the same day', async () => {
    const before = await recordDailyActivity(userId);
    const after = await recordDailyActivity(userId);
    expect(after.dailyStreak).toBe(before.dailyStreak);
  });
});
