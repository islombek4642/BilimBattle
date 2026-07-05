import jwt from 'jsonwebtoken';

describe('jwt session', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.JWT_SECRET = 'test-secret';
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.TELEGRAM_BOT_TOKEN = 'token';
  });

  it('signs and verifies a valid session token', () => {
    const { signSession, verifySession } = require('../../src/auth/jwt');
    const token = signSession({ userId: 1, telegramId: 12345 });
    const payload = verifySession(token);
    expect(payload).toMatchObject({ userId: 1, telegramId: 12345 });
  });

  it('returns null for an invalid token', () => {
    const { verifySession } = require('../../src/auth/jwt');
    expect(verifySession('not-a-real-token')).toBeNull();
  });

  it('returns null when the decoded payload has the wrong shape', () => {
    const { verifySession } = require('../../src/auth/jwt');
    const token = jwt.sign({ userId: 'not-a-number', telegramId: 12345 }, 'test-secret', {
      algorithm: 'HS256',
    });
    expect(verifySession(token)).toBeNull();
  });

  it('returns null for a token signed with a different algorithm', () => {
    const { verifySession } = require('../../src/auth/jwt');
    const token = jwt.sign({ userId: 1, telegramId: 12345 }, 'test-secret', {
      algorithm: 'HS384',
    });
    expect(verifySession(token)).toBeNull();
  });
});
