// NOTE: This module does NOT call dotenv.config() itself. It assumes the
// process environment has already been populated before this module is
// imported:
//   - In tests, Jest's `setupFiles: ['dotenv/config']` (see jest.config.js)
//     loads `.env` exactly once per test file, before any test code runs.
//   - In production, the entry point (src/server.ts, added in a later task)
//     MUST have `import 'dotenv/config';` as its very first line/import.
// This avoids re-reading .env on every require() of this module, which
// previously caused deleted/mocked process.env values to be silently
// refilled from the real .env file during tests.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  databaseUrl: required('DATABASE_URL'),
  redisUrl: required('REDIS_URL'),
  jwtSecret: required('JWT_SECRET'),
  telegramBotToken: required('TELEGRAM_BOT_TOKEN'),
  webappUrl: required('WEBAPP_URL'),
};
