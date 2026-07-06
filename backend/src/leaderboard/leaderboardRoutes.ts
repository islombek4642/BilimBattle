import { Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../auth/authMiddleware';
import { getGlobalLeaderboard, getFriendsLeaderboard } from './leaderboardRepository';
import { getUserById } from '../users/userRepository';

export const leaderboardRouter = Router();

leaderboardRouter.get('/leaderboard/global', requireAuth, async (_req, res) => {
  const board = await getGlobalLeaderboard(100);
  res.json({ leaderboard: board });
});

leaderboardRouter.get('/leaderboard/friends', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = await getUserById(req.userId!);
  if (!user) {
    res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    return;
  }
  const board = await getFriendsLeaderboard(user.telegramId);
  res.json({ leaderboard: board });
});
