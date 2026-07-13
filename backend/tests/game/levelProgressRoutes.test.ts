import express from 'express';
import request from 'supertest';
import { pool } from '../../src/config/db';
import { signSession } from '../../src/auth/jwt';
import { upsertUser } from '../../src/users/userRepository';
import { upsertLevelProgress } from '../../src/game/levelProgress';
import { levelProgressRouter } from '../../src/game/levelProgressRoutes';

describe('GET /api/level-progress', () => {
  const app = express();
  app.use('/api', levelProgressRouter);

  let userId: number;
  let token: string;

  beforeAll(async () => {
    const user = await upsertUser(8802001, 'levelRouteTestUser', 'LevelRouteTest', null);
    userId = user.id;
    token = signSession({ userId: user.id, telegramId: 8802001 });
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM level_progress WHERE user_id = $1`, [userId]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id = 8802001`);
    await pool.end();
  });

  it('returns 401 with no auth token', async () => {
    const res = await request(app).get('/api/level-progress');
    expect(res.status).toBe(401);
  });

  it('returns empty progress and a real maxAvailableLevel for a brand new user', async () => {
    const res = await request(app).get('/api/level-progress').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.progress).toEqual([]);
    expect(typeof res.body.maxAvailableLevel).toBe('number');
    expect(res.body.maxAvailableLevel).toBeGreaterThan(0);
  });

  it("returns this user's own progress rows, not other users'", async () => {
    await upsertLevelProgress(userId, 2, 3);
    const res = await request(app).get('/api/level-progress').set('Authorization', `Bearer ${token}`);
    expect(res.body.progress).toEqual([{ levelNumber: 2, stars: 3 }]);
  });
});
