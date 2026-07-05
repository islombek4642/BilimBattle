import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface SessionPayload {
  userId: number;
  telegramId: number;
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: '7d', algorithm: 'HS256' });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
    if (typeof decoded !== 'object' || decoded === null) {
      return null;
    }
    const { userId, telegramId } = decoded as Record<string, unknown>;
    if (typeof userId !== 'number' || typeof telegramId !== 'number') {
      return null;
    }
    return { userId, telegramId };
  } catch {
    return null;
  }
}
