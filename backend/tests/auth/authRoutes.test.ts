import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import { pool } from '../../src/config/db';
import { authRouter } from '../../src/auth/authRoutes';

// Importing authRoutes above does not trigger any dotenv loading itself —
// env.ts no longer calls dotenv.config(). Instead, Jest's
// `setupFiles: ['dotenv/config']` (see jest.config.js) loads `.env` once,
// before this test file's top-level code runs at all. So by this line
// process.env.TELEGRAM_BOT_TOKEN is already populated from the real .env value.
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN as string;

function buildInitData(userObj: object): string {
  return buildInitDataWithToken(userObj, BOT_TOKEN);
}

function buildInitDataWithToken(userObj: object, botToken: string): string {
  const params = new URLSearchParams();
  params.set('user', JSON.stringify(userObj));
  params.set('auth_date', '1700000000');
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

describe('POST /api/auth/login', () => {
  const app = express();
  app.use(express.json());
  app.use('/api', authRouter);

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id IN (555, 556, 557)`);
    await pool.end();
  });

  it('rejects requests with no initData', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });

  it('rejects requests with invalid initData', async () => {
    const initData = buildInitDataWithToken({ id: 555, first_name: 'Dilnoza' }, 'wrong-bot-token');
    const res = await request(app).post('/api/auth/login').send({ initData });
    expect(res.status).toBe(401);
  });

  it('creates a session for valid initData', async () => {
    const initData = buildInitData({ id: 555, first_name: 'Dilnoza', username: 'dilnoza' });
    const res = await request(app).post('/api/auth/login').send({ initData });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.telegramId).toBe(555);
  });

  it('records the inviter from startParam on first login', async () => {
    const initData = buildInitData({ id: 556, first_name: 'Sardor' });
    const res = await request(app).post('/api/auth/login').send({ initData, startParam: 'invite_555' });
    expect(res.status).toBe(200);
    expect(res.body.user.invitedByTelegramId).toBe(555);
  });

  it('ignores a startParam that points at the user\'s own telegram id', async () => {
    const initData = buildInitData({ id: 557, first_name: 'Kamola' });
    const res = await request(app).post('/api/auth/login').send({ initData, startParam: 'invite_557' });
    expect(res.status).toBe(200);
    expect(res.body.user.invitedByTelegramId).toBeNull();
  });
});
