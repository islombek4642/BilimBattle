import express from 'express';
import cors from 'cors';
import { authRouter } from './auth/authRoutes';
import { questionsRouter } from './questions/questionsRoutes';
import { leaderboardRouter } from './leaderboard/leaderboardRoutes';
import { statsRouter } from './stats/statsRoutes';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api', authRouter);
  app.use('/api', questionsRouter);
  app.use('/api', leaderboardRouter);
  app.use('/api', statsRouter);
  return app;
}
