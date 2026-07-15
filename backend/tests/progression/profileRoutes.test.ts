import express from 'express';
import request from 'supertest';
import { pool } from '../../src/config/db';
import { signSession } from '../../src/auth/jwt';
import { upsertUser } from '../../src/users/userRepository';
import { addSubjectProgress } from '../../src/progression/xpRepository';
import { recordDailyMatch } from '../../src/progression/dailyProgressRepository';
import { profileRouter } from '../../src/progression/profileRoutes';

describe('GET /api/profile', () => {
  const app = express();
  app.use('/api', profileRouter);

  let userId: number;
  let token: string;

  beforeAll(async () => {
    const user = await upsertUser(881301, 'profileRouteTestUser', 'ProfileRouteTest', null);
    userId = user.id;
    token = signSession({ userId: user.id, telegramId: 881301 });
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM subject_xp WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM daily_quest_progress WHERE user_id = $1`, [userId]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id = 881301`);
    await pool.end();
  });

  it('returns 401 with no auth token', async () => {
    const res = await request(app).get('/api/profile');
    expect(res.status).toBe(401);
  });

  it('returns zeroed progress and Boshlangich rank for a brand new user', async () => {
    const res = await request(app).get('/api/profile').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.xp).toBe(0);
    expect(res.body.masteryRank).toBe('Boshlangich');
    expect(res.body.category).toBe('ingliz_tili');
    expect(res.body.dailyQuests.length).toBe(3);
    expect(res.body.dailyQuests.every((q: any) => !q.completed)).toBe(true);
    expect(res.body.streak.freezeAvailable).toBe(true);
  });

  it('reflects accumulated XP, mastery points and a completed daily quest', async () => {
    await addSubjectProgress(userId, 'ingliz_tili', 500, 200);
    await recordDailyMatch(userId, 10, null);
    const res = await request(app).get('/api/profile').set('Authorization', `Bearer ${token}`);
    expect(res.body.xp).toBe(500);
    expect(res.body.masteryRank).toBe('Orta');
    const correctQuest = res.body.dailyQuests.find((q: any) => q.key === 'correct_10');
    expect(correctQuest.completed).toBe(true);
  });
});
