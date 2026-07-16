import { pool } from '../../src/config/db';
import { upsertUser } from '../../src/users/userRepository';
import {
  accumulateWeeklyXp,
  getUserLeague,
  getWeeklyXp,
  getWeeklyBracket,
  getFullBracket,
  applyTierChange,
  isWeekProcessed,
  markWeekProcessed,
  previousWeekStartDateString,
} from '../../src/league/leagueRepository';

describe('leagueRepository', () => {
  let userId: number;

  beforeAll(async () => {
    const user = await upsertUser(882001, 'leagueRepoTestUser', 'LeagueRepoTest', null);
    userId = user.id;
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM league_weekly_xp WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM user_league WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM league_processing_log WHERE week_start_date = '2020-01-06'`);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id = 882001`);
    await pool.end();
  });

  it('defaults a user with no rows to Bronza tier and zero weekly XP', async () => {
    expect(await getUserLeague(userId)).toBe('Bronza');
    expect(await getWeeklyXp(userId)).toBe(0);
  });

  it('accumulates weekly XP and lazily creates a Bronza user_league row', async () => {
    await accumulateWeeklyXp(userId, 50);
    await accumulateWeeklyXp(userId, 30);
    expect(await getWeeklyXp(userId)).toBe(80);
    expect(await getUserLeague(userId)).toBe('Bronza');
  });

  it('does not overwrite an already-promoted tier when accumulating more XP', async () => {
    await accumulateWeeklyXp(userId, 10);
    await applyTierChange(userId, 'Oltin');
    await accumulateWeeklyXp(userId, 10);
    expect(await getUserLeague(userId)).toBe('Oltin');
  });

  it('getWeeklyBracket returns members of the same tier ordered by weekly XP descending', async () => {
    const p2 = await upsertUser(882002, 'leagueRepoTestUser2', 'LeagueRepoTest2', null);
    await accumulateWeeklyXp(userId, 50);
    await accumulateWeeklyXp(p2.id, 100);

    const bracket = await getWeeklyBracket('Bronza', 10);
    const ids = bracket.map((b) => b.telegramId);
    expect(ids.indexOf(882002)).toBeLessThan(ids.indexOf(882001));

    await pool.query(`DELETE FROM league_weekly_xp WHERE user_id = $1`, [p2.id]);
    await pool.query(`DELETE FROM user_league WHERE user_id = $1`, [p2.id]);
    await pool.query(`DELETE FROM users WHERE telegram_id = 882002`);
  });

  it('getFullBracket returns every member of a tier for a given week, unlimited', async () => {
    await accumulateWeeklyXp(userId, 25);
    // Note: backend/src/config/db.ts registers a global Postgres type-parser
    // override for DATE (OID 1082) columns, added in the previous feature -
    // it returns them as plain 'YYYY-MM-DD' strings, NOT JS Date objects.
    // week_start_date below is already a string; do not call .toISOString()
    // on it (that override is exactly why it doesn't need it).
    const weekStart = (await pool.query(`SELECT week_start_date FROM league_weekly_xp WHERE user_id = $1`, [userId]))
      .rows[0].week_start_date;
    const full = await getFullBracket('Bronza', weekStart);
    expect(full.some((m) => m.userId === userId && m.weeklyXp === 25)).toBe(true);
  });

  it('isWeekProcessed/markWeekProcessed track idempotency per week', async () => {
    expect(await isWeekProcessed('2020-01-06')).toBe(false);
    await markWeekProcessed('2020-01-06');
    expect(await isWeekProcessed('2020-01-06')).toBe(true);
    // Marking again must not throw (ON CONFLICT DO NOTHING).
    await markWeekProcessed('2020-01-06');
    expect(await isWeekProcessed('2020-01-06')).toBe(true);
  });

  it('previousWeekStartDateString returns the Monday one week before the given date\'s week', () => {
    // 2026-07-16 is a Thursday; that week's Monday is 2026-07-13; the
    // previous week's Monday is 2026-07-06.
    expect(previousWeekStartDateString(new Date(Date.UTC(2026, 6, 16)))).toBe('2026-07-06');
  });
});
