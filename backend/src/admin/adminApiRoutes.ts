import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../auth/authMiddleware';
import { env } from '../config/env';
import { getAdminSummary, getDailyStats, getUserList } from './statsQueries';

export const adminApiRouter = Router();

adminApiRouter.get('/admin/stats', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  // Same gate as scripts/healthcheck-alert.sh's Telegram DMs and the
  // standalone /admin/stats HTML page - just checked against the
  // already-authenticated session's telegramId instead of a separate
  // password, so the dashboard can live inside the Mini App itself.
  if (!env.adminTelegramId || req.telegramId !== env.adminTelegramId) {
    res.status(403).json({ error: "Ruxsat yo'q" });
    return;
  }

  const [summary, daily, users] = await Promise.all([getAdminSummary(), getDailyStats(14), getUserList()]);
  res.json({ summary, daily, users });
});
