import crypto from 'crypto';

const TEST_BOT_TOKEN = 'test-bot-token';

function buildInitData(userObj: object, botToken: string): string {
  const params = new URLSearchParams();
  params.set('user', JSON.stringify(userObj));
  params.set('auth_date', '1700000000');
  params.set('query_id', 'AAEXXXXX');

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

describe('validateInitData', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.TELEGRAM_BOT_TOKEN = TEST_BOT_TOKEN;
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.JWT_SECRET = 'secret';
  });

  it('returns the user for a correctly signed initData', () => {
    const { validateInitData } = require('../../src/auth/telegramAuth');
    const initData = buildInitData({ id: 12345, first_name: 'Aziz', username: 'aziz01' }, TEST_BOT_TOKEN);
    const result = validateInitData(initData);
    expect(result).toEqual({ id: 12345, username: 'aziz01', first_name: 'Aziz' });
  });

  it('returns null when the hash does not match', () => {
    const { validateInitData } = require('../../src/auth/telegramAuth');
    const initData = buildInitData({ id: 12345, first_name: 'Aziz' }, 'wrong-token');
    const result = validateInitData(initData);
    expect(result).toBeNull();
  });

  it('returns null when hash is missing', () => {
    const { validateInitData } = require('../../src/auth/telegramAuth');
    const result = validateInitData('user=%7B%7D&auth_date=1700000000');
    expect(result).toBeNull();
  });
});
