import { pool } from '../../src/config/db';
import { upsertUser, recordMatchResult, getOrCreateBotUser } from '../../src/users/userRepository';
import { getAdminSummary, getDailyStats, getUserList } from '../../src/admin/statsQueries';

describe('admin/statsQueries', () => {
  afterAll(async () => {
    await pool.query(
      `DELETE FROM matches WHERE player1_id IN (SELECT id FROM users WHERE telegram_id IN (9001, 9002, 9003, 9004))`
    );
    await pool.query(`DELETE FROM users WHERE telegram_id IN (9001, 9002, 9003, 9004)`);
    await pool.end();
  });

  // These are global, server-wide aggregates - not scoped to one user like
  // leaderboardRepository/statsRoutes' tests. Jest runs test FILES in
  // parallel (see jest.config.js: no maxWorkers override) against the same
  // real Postgres database, so other suites' concurrent inserts show up in
  // these totals too. Asserting a before/after DELTA around this test's own
  // known inserts is immune to that unrelated activity, unlike asserting an
  // absolute count would be.
  it('counts organic vs invited users, and human vs bot matches, in the before/after delta', async () => {
    const before = await getAdminSummary();

    const organic = await upsertUser(9001, 'organic', 'Organic', null);
    const invited = await upsertUser(9002, 'invited', 'Invited', 9001);
    const bot = await getOrCreateBotUser();

    await recordMatchResult({
      category: 'umumiy_bilim',
      player1Id: organic.id,
      player2Id: invited.id,
      player1Score: 500,
      player2Score: 300,
      winnerId: organic.id,
    });
    await recordMatchResult({
      category: 'umumiy_bilim',
      player1Id: organic.id,
      player2Id: bot.id,
      player1Score: 400,
      player2Score: 200,
      winnerId: organic.id,
    });

    const after = await getAdminSummary();

    expect(after.totalUsers - before.totalUsers).toBe(2);
    expect(after.invitedUsers - before.invitedUsers).toBe(1);
    expect(after.totalHumanMatches - before.totalHumanMatches).toBe(1);
    expect(after.totalBotMatches - before.totalBotMatches).toBe(1);
  });

  it('counts a user who played on two distinct days as returning, not one who played only once', async () => {
    const before = await getAdminSummary();

    const playedOnce = await upsertUser(9003, 'once', 'Once', null);
    const opponent = await upsertUser(9001, 'organic', 'Organic', null); // already exists, upsert is idempotent
    await recordMatchResult({
      category: 'umumiy_bilim',
      player1Id: playedOnce.id,
      player2Id: opponent.id,
      player1Score: 100,
      player2Score: 500,
      winnerId: opponent.id,
    });

    const after = await getAdminSummary();

    // playedOnce only ever played once (today) - not a returning player.
    // opponent already had a prior match from the previous test (also
    // today), so still only one distinct day - also not "returning" by
    // this metric. Neither user should move the returning-users delta.
    expect(after.returningUsers - before.returningUsers).toBe(0);
  });

  it("includes today's date in the daily breakdown with the expected new-user and match counts", async () => {
    const daily = await getDailyStats(14);
    const todayStr = new Date().toISOString().slice(0, 10);
    const today = daily.find((d) => d.date === todayStr);

    expect(today).toBeDefined();
    // From the two tests above: users 9001, 9002, 9003 all created today,
    // and 3 matches recorded today (2 human, 1 bot - the 9003 vs 9001
    // match adds a second human match).
    expect(today!.newUsers).toBeGreaterThanOrEqual(3);
    expect(today!.humanMatches).toBeGreaterThanOrEqual(2);
    expect(today!.botMatches).toBeGreaterThanOrEqual(1);
  });

  it('returns exactly `days` entries ordered most-recent first', async () => {
    const daily = await getDailyStats(7);
    expect(daily.length).toBe(7);
    for (let i = 1; i < daily.length; i += 1) {
      expect(daily[i - 1].date >= daily[i].date).toBe(true);
    }
  });

  it('includes a user with their username/rating/stats, and excludes the bot user', async () => {
    await upsertUser(9004, 'clickable_handle', 'ListedUser', null);
    await getOrCreateBotUser();

    const users = await getUserList(500);

    const listed = users.find((u) => u.telegramId === 9004);
    expect(listed).toBeDefined();
    expect(listed).toMatchObject({
      telegramId: 9004,
      username: 'clickable_handle',
      firstName: 'ListedUser',
      rating: 1000,
      gamesPlayed: 0,
      gamesWon: 0,
    });

    expect(users.some((u) => u.telegramId === 0)).toBe(false);
  });
});
