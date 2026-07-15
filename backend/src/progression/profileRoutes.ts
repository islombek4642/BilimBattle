// backend/src/progression/profileRoutes.ts
import { Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../auth/authMiddleware';
import { getUserById } from '../users/userRepository';
import { getSubjectProgress } from './xpRepository';
import { masteryRankForPoints } from './masteryTiers';
import { DAILY_QUESTS } from './dailyQuests';
import { getTodayProgress } from './dailyProgressRepository';
import { isFreezeAvailable } from './streakLogic';

export const profileRouter = Router();

const TRACKED_CATEGORY = 'ingliz_tili';

profileRouter.get('/profile', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = await getUserById(req.userId!);
  if (!user) {
    res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    return;
  }

  const [subjectProgress, todayProgress] = await Promise.all([
    getSubjectProgress(user.id, TRACKED_CATEGORY),
    getTodayProgress(user.id),
  ]);
  const dailyQuests = DAILY_QUESTS.map((quest) => {
    const progress = todayProgress[quest.metric];
    return {
      key: quest.key,
      label: quest.label,
      progress,
      target: quest.target,
      completed: progress >= quest.target,
    };
  });

  const freezeAvailable = isFreezeAvailable(
    new Date(),
    user.streakFreezeUsedAt ? new Date(user.streakFreezeUsedAt) : null
  );

  res.json({
    xp: subjectProgress.xp,
    masteryPoints: subjectProgress.masteryPoints,
    masteryRank: masteryRankForPoints(subjectProgress.masteryPoints),
    category: TRACKED_CATEGORY,
    dailyQuests,
    streak: {
      current: user.dailyStreak,
      best: user.bestDailyStreak,
      freezeAvailable,
    },
  });
});
