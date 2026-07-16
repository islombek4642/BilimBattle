// backend/src/league/leagueRoutes.ts
import { Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../auth/authMiddleware';
import { getUserLeague, getWeeklyXp, getWeeklyBracket } from './leagueRepository';

export const leagueRouter = Router();

leagueRouter.get('/league', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const [tier, weeklyXp] = await Promise.all([getUserLeague(userId), getWeeklyXp(userId)]);
  const bracket = await getWeeklyBracket(tier, 10);
  res.json({ tier, weeklyXp, bracket });
});
