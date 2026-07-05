import crypto from 'crypto';
import { env } from '../config/env';

export interface TelegramUser {
  id: number;
  username?: string;
  first_name: string;
}

export function validateInitData(initData: string): TelegramUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(env.telegramBotToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) return null;

  const userJson = params.get('user');
  if (!userJson) return null;

  const user = JSON.parse(userJson);
  return { id: user.id, username: user.username, first_name: user.first_name };
}
