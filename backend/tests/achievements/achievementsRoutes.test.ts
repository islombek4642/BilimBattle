import express from 'express';
import request from 'supertest';
import { pool } from '../../src/config/db';
import { signSession } from '../../src/auth/jwt';
import { upsertUser } from '../../src/users/userRepository';
import { awardAchievements } from '../../src/achievements/achievements';
import { achievementsRouter } from '../../src/achievements/achievementsRoutes';

describe('GET /api/achievements', () => {
  const app = express();
  app.use('/api', achievementsRouter);

  let userId: number;
  let token: string;

  beforeAll(async () => {
    const user = await upsertUser(881102, 'achievementsRouteTestUser', 'AchievementsRouteTest', null);
    userId = user.id;
    token = signSession({ userId: user.id, telegramId: 881102 });
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM user_achievements WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM league_weekly_xp WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM user_league WHERE user_id = $1`, [userId]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id = 881102`);
    await pool.end();
  });

  it('returns 401 with no auth token', async () => {
    const res = await request(app).get('/api/achievements');
    expect(res.status).toBe(401);
  });

  it('returns the full catalog and an empty earned list for a brand new user', async () => {
    const res = await request(app).get('/api/achievements').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.catalog.length).toBeGreaterThan(0);
    expect(res.body.earned).toEqual([]);
  });

  it("returns this user's own earned achievements, not other users'", async () => {
    await awardAchievements(userId, ['games_1']);
    const res = await request(app).get('/api/achievements').set('Authorization', `Bearer ${token}`);
    expect(res.body.earned.map((e: any) => e.key)).toEqual(['games_1']);
  });
});
