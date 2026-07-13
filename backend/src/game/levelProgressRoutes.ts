import { Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../auth/authMiddleware';
import { getLevelProgressForUser } from './levelProgress';
import { maxAvailableLevel } from '../questions/questionRepository';

export const levelProgressRouter = Router();

levelProgressRouter.get('/level-progress', requireAuth, async (req: AuthenticatedRequest, res) => {
  const [progress, max] = await Promise.all([
    getLevelProgressForUser(req.userId!),
    maxAvailableLevel(),
  ]);
  res.json({ progress, maxAvailableLevel: max });
});
