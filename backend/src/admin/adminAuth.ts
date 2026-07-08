import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { env } from '../config/env';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on mismatched buffer lengths rather than
  // returning false, and comparing length first is itself safe (the
  // password's length isn't secret - only its content is).
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  if (!env.adminPassword) {
    res.status(503).send('Admin dashboard is not configured (set ADMIN_PASSWORD).');
    return;
  }

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice('Basic '.length), 'base64').toString('utf-8');
    const separatorIndex = decoded.indexOf(':');
    const password = separatorIndex === -1 ? '' : decoded.slice(separatorIndex + 1);
    if (password && safeEqual(password, env.adminPassword)) {
      next();
      return;
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="BilimBattle Admin"');
  res.status(401).send('Authentication required.');
}
