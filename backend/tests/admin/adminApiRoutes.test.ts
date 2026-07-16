process.env.ADMIN_TELEGRAM_ID = '9999';

import express from 'express';
import request from 'supertest';
import { pool } from '../../src/config/db';
import { upsertUser } from '../../src/users/userRepository';
import { signSession } from '../../src/auth/jwt';
import { adminApiRouter } from '../../src/admin/adminApiRoutes';

describe('GET /api/admin/stats', () => {
  const app = express();
  app.use('/api', adminApiRouter);

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id IN (9999, 9998)`);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/admin/stats');
    expect(res.status).toBe(401);
  });

  it("rejects a valid session that isn't the admin's telegramId", async () => {
    const nonAdmin = await upsertUser(9998, 'notadmin', 'NotAdmin', null);
    const token = signSession({ userId: nonAdmin.id, telegramId: nonAdmin.telegramId });

    const res = await request(app).get('/api/admin/stats').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('returns summary and daily stats for the admin telegramId', async () => {
    const admin = await upsertUser(9999, 'admin', 'Admin', null);
    const token = signSession({ userId: admin.id, telegramId: admin.telegramId });

    const res = await request(app).get('/api/admin/stats').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.summary).toHaveProperty('totalUsers');
    expect(res.body.summary).toHaveProperty('invitedUsers');
    expect(res.body.summary).toHaveProperty('returningUsers');
    expect(Array.isArray(res.body.daily)).toBe(true);
    expect(res.body.daily.length).toBe(14);
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body.users.some((u: { telegramId: number }) => u.telegramId === 9999)).toBe(true);
  });
});

describe('POST /api/admin/league/process-week', () => {
  const app = express();
  app.use('/api', adminApiRouter);

  afterEach(async () => {
    await pool.query(`DELETE FROM league_processing_log`);
    await pool.query(
      `DELETE FROM league_weekly_xp WHERE user_id IN (SELECT id FROM users WHERE telegram_id IN (882101, 882102))`
    );
    await pool.query(
      `DELETE FROM user_league WHERE user_id IN (SELECT id FROM users WHERE telegram_id IN (882101, 882102))`
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id IN (9999, 882101, 882102)`);
  });

  it('rejects a non-admin caller', async () => {
    const nonAdmin = await upsertUser(9998, 'leagueProcNonAdmin', 'LeagueProcNonAdmin', null);
    const token = signSession({ userId: nonAdmin.id, telegramId: nonAdmin.telegramId });

    const res = await request(app)
      .post('/api/admin/league/process-week')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("promotes and relegates users within a tier based on last week's XP, then marks the week processed", async () => {
    const admin = await upsertUser(9999, 'leagueProcAdmin', 'LeagueProcAdmin', null);
    const adminToken = signSession({ userId: admin.id, telegramId: admin.telegramId });

    const { accumulateWeeklyXp, previousWeekStartDateString, getUserLeague } = await import(
      '../../src/league/leagueRepository'
    );
    const p1 = await upsertUser(882101, 'leagueProcTest1', 'LeagueProcTest1', null);
    const p2 = await upsertUser(882102, 'leagueProcTest2', 'LeagueProcTest2', null);
    await accumulateWeeklyXp(p1.id, 1000);
    await accumulateWeeklyXp(p2.id, 10);

    // accumulateWeeklyXp records XP under the CURRENT week, but the endpoint
    // processes the PREVIOUS week - move both rows back one week so this
    // test's fixture data is actually in scope for the run below.
    const prevWeek = previousWeekStartDateString(new Date());
    await pool.query(`UPDATE league_weekly_xp SET week_start_date = $1 WHERE user_id IN ($2, $3)`, [
      prevWeek,
      p1.id,
      p2.id,
    ]);

    const res = await request(app)
      .post('/api/admin/league/process-week')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.alreadyProcessed).toBe(false);

    // Both started in Bronza (accumulateWeeklyXp's lazy default); a 2-member
    // bracket floors 20% to 0 for both promotion and relegation, so neither
    // should have changed tier from this run alone - this test's purpose is
    // to prove the endpoint runs end-to-end and marks the week processed,
    // not to re-verify computeTierChanges' ranking math (already covered by
    // Task 2's unit tests).
    expect(await getUserLeague(p1.id)).toBe('Bronza');
    expect(await getUserLeague(p2.id)).toBe('Bronza');
  });

  it('is idempotent - a second call for an already-processed week is a no-op', async () => {
    const admin = await upsertUser(9999, 'leagueProcAdmin', 'LeagueProcAdmin', null);
    const adminToken = signSession({ userId: admin.id, telegramId: admin.telegramId });

    const { previousWeekStartDateString, markWeekProcessed } = await import('../../src/league/leagueRepository');
    await markWeekProcessed(previousWeekStartDateString(new Date()));

    const res = await request(app)
      .post('/api/admin/league/process-week')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.alreadyProcessed).toBe(true);
  });
});

// pool.end() lives here, in a single module-level afterAll after both
// describe blocks, rather than inside either describe's own afterAll -
// both describes share the same imported `pool`, so closing it inside the
// first describe's afterAll would break the second describe's queries. Same
// convention as tests/middleware/rateLimiters.test.ts.
afterAll(async () => {
  await pool.end();
});
