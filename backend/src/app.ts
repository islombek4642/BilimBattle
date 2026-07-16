import express from 'express';
import cors from 'cors';
import { authRouter } from './auth/authRoutes';
import { questionsRouter } from './questions/questionsRoutes';
import { leaderboardRouter } from './leaderboard/leaderboardRoutes';
import { statsRouter } from './stats/statsRoutes';
import { levelProgressRouter } from './game/levelProgressRoutes';
import { achievementsRouter } from './achievements/achievementsRoutes';
import { profileRouter } from './progression/profileRoutes';
import { leagueRouter } from './league/leagueRoutes';
import { adminRouter } from './admin/adminRoutes';
import { adminApiRouter } from './admin/adminApiRoutes';
import { avatarRouter } from './users/avatarRoutes';
import { env } from './config/env';
import { authLoginLimiter, adminImportLimiter, avatarLimiter, generalApiLimiter } from './middleware/rateLimiters';

export function createApp() {
  const app = express();
  // Required for express-rate-limit's IP-based keying to see the real
  // client IP: this backend runs behind an nginx-proxy reverse proxy in
  // production (see docker-compose.yml), so without this, req.ip reflects
  // the proxy's internal Docker network address for every request, not the
  // real client - either collapsing all clients into one shared rate-limit
  // bucket, or (on newer express-rate-limit versions) throwing a validation
  // error outright. `1` trusts exactly one proxy hop, not an unbounded
  // chain - safer than `true`, which would trust any X-Forwarded-For header
  // a client cares to send directly.
  app.set('trust proxy', 1);
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  // Mounted before the CORS/JSON middleware below: it's a directly
  // browser-navigated HTML page (Basic Auth prompt), not a JSON API called
  // via fetch from the Telegram WebApp origin, so it doesn't need either.
  app.use(adminRouter);
  app.use(cors({ origin: env.webappUrl }));
  app.use(express.json());
  app.use('/api/auth/login', authLoginLimiter);
  app.use('/api/admin/questions/import', adminImportLimiter);
  // WARNING: this is a prefix mount, not an exact route match - every
  // current and future path under /api/users/* runs through avatarLimiter's
  // public/unauthenticated-tuned 60/min budget (see rateLimiters.ts's
  // SPECIFIC_LIMIT_PATHS comment, which also excludes this whole prefix from
  // generalApiLimiter below). Today that's fine because GET
  // /users/:telegramId/avatar is the only route here. If you add another
  // route under /api/users/*, give it its OWN specific rate limiter and path
  // - don't let it silently inherit avatarLimiter's budget via this prefix
  // match, and don't forget it will otherwise also be silently skipped by
  // generalApiLimiter.
  app.use('/api/users', avatarLimiter);
  app.use('/api', generalApiLimiter);
  app.use('/api', authRouter);
  app.use('/api', questionsRouter);
  app.use('/api', leaderboardRouter);
  app.use('/api', statsRouter);
  app.use('/api', levelProgressRouter);
  app.use('/api', achievementsRouter);
  app.use('/api', profileRouter);
  app.use('/api', leagueRouter);
  app.use('/api', adminApiRouter);
  app.use('/api', avatarRouter);
  return app;
}
