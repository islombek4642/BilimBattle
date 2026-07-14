import { Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../auth/authMiddleware';
import { getLevelProgressForUser } from './levelProgress';
import { maxAvailableLevel, getLevelTierBoundaries } from '../questions/questionRepository';

export const levelProgressRouter = Router();

levelProgressRouter.get('/level-progress', requireAuth, async (req: AuthenticatedRequest, res) => {
  const [progress, max, tierBoundaries] = await Promise.all([
    getLevelProgressForUser(req.userId!),
    maxAvailableLevel(),
    getLevelTierBoundaries(),
  ]);
  res.json({ progress, maxAvailableLevel: max, tierBoundaries });
});
