import { Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../auth/authMiddleware';
import { ACHIEVEMENTS, getEarnedAchievements } from './achievements';

export const achievementsRouter = Router();

achievementsRouter.get('/achievements', requireAuth, async (req: AuthenticatedRequest, res) => {
  const earned = await getEarnedAchievements(req.userId!);
  res.json({ catalog: ACHIEVEMENTS, earned });
});
