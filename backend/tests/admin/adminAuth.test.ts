// ADMIN_PASSWORD must be set before importing ../../src/config/env (which
// reads process.env once, at module-load time) - Jest gives each test FILE
// its own fresh module registry, so this doesn't leak into other test files.
process.env.ADMIN_PASSWORD = 'test-admin-secret';

import express, { Response } from 'express';
import request from 'supertest';
import { requireAdminAuth } from '../../src/admin/adminAuth';

describe('requireAdminAuth middleware', () => {
  function buildApp() {
    const app = express();
    app.get('/protected', requireAdminAuth, (_req, res: Response) => {
      res.send('ok');
    });
    return app;
  }

  it('rejects requests with no Authorization header', async () => {
    const res = await request(buildApp()).get('/protected');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/^Basic/);
  });

  it('rejects requests with the wrong password', async () => {
    const res = await request(buildApp())
      .get('/protected')
      .auth('anything', 'wrong-password');
    expect(res.status).toBe(401);
  });

  it('allows requests with the correct password, regardless of username', async () => {
    const res = await request(buildApp())
      .get('/protected')
      .auth('admin', 'test-admin-secret');
    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
  });

  it('rejects a non-Basic Authorization header', async () => {
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', 'Bearer sometoken');
    expect(res.status).toBe(401);
  });
});

describe('requireAdminAuth when ADMIN_PASSWORD is not configured', () => {
  it('responds 503 instead of allowing or hard-crashing', async () => {
    jest.resetModules();
    delete process.env.ADMIN_PASSWORD;
    // Re-require after resetModules so this describe block's own copy of
    // env.ts picks up the just-deleted var, independent of the module cache
    // primed by the top-level import above.
    const { requireAdminAuth: requireAdminAuthUnconfigured } = require('../../src/admin/adminAuth');

    const app = express();
    app.get('/protected', requireAdminAuthUnconfigured, (_req: any, res: Response) => res.send('ok'));

    const res = await request(app).get('/protected').auth('admin', 'whatever');
    expect(res.status).toBe(503);

    process.env.ADMIN_PASSWORD = 'test-admin-secret';
  });
});
