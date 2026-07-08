process.env.ADMIN_PASSWORD = 'route-test-secret';

import express from 'express';
import request from 'supertest';
import { pool } from '../../src/config/db';
import { adminRouter } from '../../src/admin/adminRoutes';

describe('GET /admin/stats', () => {
  const app = express();
  app.use(adminRouter);

  afterAll(async () => {
    await pool.end();
  });

  it('rejects requests without valid admin credentials', async () => {
    const res = await request(app).get('/admin/stats');
    expect(res.status).toBe(401);
  });

  it('renders the dashboard as HTML when authenticated', async () => {
    const res = await request(app).get('/admin/stats').auth('admin', 'route-test-secret');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('BilimBattle');
    expect(res.text).toContain('Jami foydalanuvchilar');
    expect(res.text).toContain('<table');
  });
});
