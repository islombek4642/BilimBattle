process.env.ADMIN_PASSWORD = 'route-test-secret';

import express from 'express';
import request from 'supertest';
import { pool } from '../../src/config/db';
import { upsertUser } from '../../src/users/userRepository';
import { adminRouter } from '../../src/admin/adminRoutes';

describe('GET /admin/stats', () => {
  const app = express();
  app.use(adminRouter);

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id IN (9101, 9102)`);
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

  it('renders a clickable t.me link for a user with a username, and escapes a malicious first_name', async () => {
    await upsertUser(9101, 'clickable_handle', '<script>alert(1)</script>', null);
    await upsertUser(9102, undefined, 'NoUsernameUser', null);

    const res = await request(app).get('/admin/stats').auth('admin', 'route-test-secret');

    expect(res.status).toBe(200);
    expect(res.text).toContain('href="https://t.me/clickable_handle"');
    // The raw script tag must never appear unescaped in the response.
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(res.text).toContain("NoUsernameUser (username yo'q)");
  });
});
