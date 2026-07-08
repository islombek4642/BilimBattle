import express from 'express';
import cors from 'cors';
import { authRouter } from './auth/authRoutes';
import { questionsRouter } from './questions/questionsRoutes';
import { leaderboardRouter } from './leaderboard/leaderboardRoutes';
import { statsRouter } from './stats/statsRoutes';
import { adminRouter } from './admin/adminRoutes';
import { adminApiRouter } from './admin/adminApiRoutes';
import { env } from './config/env';

export function createApp() {
  const app = express();
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  // Mounted before the CORS/JSON middleware below: it's a directly
  // browser-navigated HTML page (Basic Auth prompt), not a JSON API called
  // via fetch from the Telegram WebApp origin, so it doesn't need either.
  app.use(adminRouter);
  app.use(cors({ origin: env.webappUrl }));
  app.use(express.json());
  app.use('/api', authRouter);
  app.use('/api', questionsRouter);
  app.use('/api', leaderboardRouter);
  app.use('/api', statsRouter);
  app.use('/api', adminApiRouter);
  return app;
}
