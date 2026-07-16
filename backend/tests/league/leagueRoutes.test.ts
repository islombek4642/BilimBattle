import express from 'express';
import request from 'supertest';
import { pool } from '../../src/config/db';
import { signSession } from '../../src/auth/jwt';
import { upsertUser } from '../../src/users/userRepository';
import { accumulateWeeklyXp } from '../../src/league/leagueRepository';
import { leagueRouter } from '../../src/league/leagueRoutes';

describe('GET /api/league', () => {
  const app = express();
  app.use('/api', leagueRouter);

  let userId: number;
  let token: string;

  beforeAll(async () => {
    const user = await upsertUser(882201, 'leagueRouteTestUser', 'LeagueRouteTest', null);
    userId = user.id;
    token = signSession({ userId: user.id, telegramId: 882201 });
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM league_weekly_xp WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM user_league WHERE user_id = $1`, [userId]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id = 882201`);
    await pool.end();
  });

  it('returns 401 with no auth token', async () => {
    const res = await request(app).get('/api/league');
    expect(res.status).toBe(401);
  });

  it('returns Bronza tier and zero weekly XP for a brand new user', async () => {
    const res = await request(app).get('/api/league').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('Bronza');
    expect(res.body.weeklyXp).toBe(0);
    expect(res.body.bracket).toEqual([]);
  });

  it('reflects accumulated weekly XP and includes the user in their own bracket', async () => {
    await accumulateWeeklyXp(userId, 150);
    const res = await request(app).get('/api/league').set('Authorization', `Bearer ${token}`);
    expect(res.body.weeklyXp).toBe(150);
    expect(res.body.bracket.some((b: any) => b.telegramId === 882201 && b.weeklyXp === 150)).toBe(true);
  });
});
