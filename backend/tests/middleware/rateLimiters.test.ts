import express from 'express';
import request from 'supertest';
import rateLimit from 'express-rate-limit';
import { pool } from '../../src/config/db';
import { redis, closeRedis } from '../../src/config/redis';
import { createRedisStore } from '../../src/middleware/rateLimiters';

describe('createRedisStore', () => {
  const TEST_PREFIX = 'rl:test-store:';

  afterEach(async () => {
    const keys = await redis.keys(`${TEST_PREFIX}*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  it('blocks requests once the configured limit is exceeded within the window', async () => {
    const app = express();
    app.use(
      rateLimit({
        windowMs: 60_000,
        limit: 3,
        standardHeaders: true,
        legacyHeaders: false,
        store: createRedisStore(TEST_PREFIX),
      })
    );
    app.get('/probe', (_req, res) => res.json({ ok: true }));

    const res1 = await request(app).get('/probe');
    const res2 = await request(app).get('/probe');
    const res3 = await request(app).get('/probe');
    const res4 = await request(app).get('/probe');

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res3.status).toBe(200);
    expect(res4.status).toBe(429);
  });

  it('returns a JSON {error: string} body (not the library default plain-text message) once blocked', async () => {
    const app = express();
    app.use(
      rateLimit({
        windowMs: 60_000,
        limit: 3,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: "Juda ko'p so'rov yuborildi. Birozdan so'ng qayta urinib ko'ring." },
        store: createRedisStore(TEST_PREFIX),
      })
    );
    app.get('/probe', (_req, res) => res.json({ ok: true }));

    await request(app).get('/probe');
    await request(app).get('/probe');
    await request(app).get('/probe');
    const res4 = await request(app).get('/probe');

    expect(res4.status).toBe(429);
    expect(res4.headers['content-type']).toMatch(/^application\/json/);
    expect(res4.body).toEqual({ error: expect.any(String) });
  });
});

describe('named rate limiters wired into the real app', () => {
  const TEST_PREFIXES = ['rl:auth:', 'rl:admin-import:', 'rl:avatar:', 'rl:api:'];

  afterAll(async () => {
    for (const prefix of TEST_PREFIXES) {
      const keys = await redis.keys(`${prefix}*`);
      if (keys.length > 0) await redis.del(...keys);
    }
  });

  it('applies the strict auth-login limiter (limit 10) to POST /api/auth/login, not the general 100-limit', async () => {
    const { createApp } = await import('../../src/app');
    const app = createApp();
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.headers['ratelimit-limit']).toBe('10');
  });

  it('applies the general API limiter (limit 100) to a route with no specific limiter, e.g. GET /api/categories', async () => {
    const { createApp } = await import('../../src/app');
    const app = createApp();
    const res = await request(app).get('/api/categories');
    expect(res.headers['ratelimit-limit']).toBe('100');
  });
});

// The second describe block above imports the full app (createApp()),
// which transitively pulls in src/config/db.ts's Postgres `pool` (via
// questionsRoutes, leaderboardRoutes, etc.) in addition to the shared
// `redis` singleton - so both must be closed here for Jest to exit
// cleanly, not just Redis. Same convention/order as
// tests/integration/socketServer.test.ts, which also builds the full
// app/server.
afterAll(async () => {
  await pool.end();
  await closeRedis();
});
