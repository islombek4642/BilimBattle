describe('env config', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('throws when a required variable is missing', () => {
    delete process.env.DATABASE_URL;
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.JWT_SECRET = 'secret';
    process.env.TELEGRAM_BOT_TOKEN = 'token';
    process.env.WEBAPP_URL = 'https://example.com';
    expect(() => require('../../src/config/env')).toThrow(
      'Missing required environment variable: DATABASE_URL'
    );
  });

  it('loads values when all required variables are present', () => {
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.JWT_SECRET = 'secret';
    process.env.TELEGRAM_BOT_TOKEN = 'token';
    process.env.WEBAPP_URL = 'https://example.com';
    process.env.PORT = '4000';
    const { env } = require('../../src/config/env');
    expect(env.port).toBe(4000);
    expect(env.databaseUrl).toBe('postgres://localhost/test');
  });
});
