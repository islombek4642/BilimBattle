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
    await pool.end();
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
