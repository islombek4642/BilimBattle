import express, { Response } from 'express';
import request from 'supertest';
import { requireAuth, AuthenticatedRequest } from '../../src/auth/authMiddleware';
import { signSession } from '../../src/auth/jwt';

describe('requireAuth middleware', () => {
  function buildApp() {
    const app = express();
    app.get('/protected', requireAuth, (req: AuthenticatedRequest, res: Response) => {
      res.json({ userId: req.userId });
    });
    return app;
  }

  it('rejects requests without an Authorization header', async () => {
    const res = await request(buildApp()).get('/protected');
    expect(res.status).toBe(401);
  });

  it('rejects requests with an invalid token', async () => {
    const res = await request(buildApp()).get('/protected').set('Authorization', 'Bearer garbage');
    expect(res.status).toBe(401);
  });

  it('allows requests with a valid token and attaches userId', async () => {
    const token = signSession({ userId: 42, telegramId: 999 });
    const res = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(42);
  });

  it('also attaches telegramId from the session payload', async () => {
    const app = express();
    app.get('/protected', requireAuth, (req: AuthenticatedRequest, res: Response) => {
      res.json({ telegramId: req.telegramId });
    });

    const token = signSession({ userId: 42, telegramId: 999 });
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.telegramId).toBe(999);
  });
});
