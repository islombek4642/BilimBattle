import express from 'express';
import request from 'supertest';
import { pool } from '../../src/config/db';
import { upsertUser } from '../../src/users/userRepository';
import { signSession } from '../../src/auth/jwt';
import { leaderboardRouter } from '../../src/leaderboard/leaderboardRoutes';

describe('GET /api/leaderboard', () => {
  const app = express();
  app.use('/api', leaderboardRouter);

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id IN (8101, 8102)`);
    await pool.end();
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/leaderboard/global');
    expect(res.status).toBe(401);
  });

  it('returns the global leaderboard for an authenticated user', async () => {
    const user = await upsertUser(8101, 'gplayer', 'GPlayer', null);
    const token = signSession({ userId: user.id, telegramId: user.telegramId });

    const res = await request(app).get('/api/leaderboard/global').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.leaderboard)).toBe(true);
  });

  it('returns the friends leaderboard for an authenticated user', async () => {
    const inviter = await upsertUser(8102, 'inv', 'Inv', null);
    const token = signSession({ userId: inviter.id, telegramId: inviter.telegramId });

    const res = await request(app).get('/api/leaderboard/friends').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.leaderboard.some((e: { telegramId: number }) => e.telegramId === 8102)).toBe(true);
  });
});
