import { Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../auth/authMiddleware';
import { getUserById } from '../users/userRepository';

export const statsRouter = Router();

statsRouter.get('/stats/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = await getUserById(req.userId!);
  if (!user) {
    res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    return;
  }
  res.json({
    gamesPlayed: user.gamesPlayed,
    gamesWon: user.gamesWon,
    winRate: user.gamesPlayed === 0 ? 0 : Math.round((user.gamesWon / user.gamesPlayed) * 100),
    currentStreak: user.currentStreak,
    bestStreak: user.bestStreak,
    rating: user.rating,
  });
});
