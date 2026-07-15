import { pool } from '../../src/config/db';
import { upsertUser } from '../../src/users/userRepository';
import { getTodayProgress, recordDailyMatch, todayDateString } from '../../src/progression/dailyProgressRepository';

describe('dailyProgressRepository', () => {
  let userId: number;

  beforeAll(async () => {
    const user = await upsertUser(881202, 'dailyProgressTestUser', 'DailyProgressTest', null);
    userId = user.id;
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM daily_quest_progress WHERE user_id = $1`, [userId]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id = 881202`);
    await pool.end();
  });

  it('returns all-zero progress before any match is recorded today', async () => {
    const progress = await getTodayProgress(userId);
    expect(progress).toEqual({ matchesPlayed: 0, correctAnswers: 0, bestStarsToday: 0 });
  });

  it('accumulates matches and correct answers across several quick matches', async () => {
    await recordDailyMatch(userId, 8, null);
    await recordDailyMatch(userId, 5, null);
    const progress = await getTodayProgress(userId);
    expect(progress).toEqual({ matchesPlayed: 2, correctAnswers: 13, bestStarsToday: 0 });
  });

  it('tracks the best stars across several level-mode matches, not the latest', async () => {
    await recordDailyMatch(userId, 14, 3);
    await recordDailyMatch(userId, 8, 1);
    const progress = await getTodayProgress(userId);
    expect(progress.bestStarsToday).toBe(3);
  });

  it("stores the row under today's UTC date", async () => {
    await recordDailyMatch(userId, 1, null);
    // Cast to text in SQL rather than reading back a JS Date: node-postgres's
    // default DATE parser builds the Date from local-timezone components, so
    // .toISOString() would shift the calendar day whenever the machine's UTC
    // offset is non-zero (e.g. UTC+5) - a driver quirk unrelated to what this
    // assertion is actually checking.
    const result = await pool.query(`SELECT quest_date::text FROM daily_quest_progress WHERE user_id = $1`, [
      userId,
    ]);
    expect(result.rows[0].quest_date).toBe(todayDateString());
  });
});
