import { Request, Response, NextFunction } from 'express';
import { verifySession } from './jwt';

export interface AuthenticatedRequest extends Request {
  userId?: number;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Sessiya topilmadi' });
    return;
  }
  const token = authHeader.slice('Bearer '.length);
  const payload = verifySession(token);
  if (!payload) {
    res.status(401).json({ error: 'Sessiya yaroqsiz' });
    return;
  }
  req.userId = payload.userId;
  next();
}
