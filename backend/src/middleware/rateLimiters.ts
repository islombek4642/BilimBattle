// backend/src/middleware/rateLimiters.ts
import rateLimit, { Store } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../config/redis';

// Reuses the single shared ioredis connection (config/redis.ts) rather than
// opening a second one. rate-limit-redis's RedisStore expects a
// `sendCommand` function; ioredis exposes the equivalent natively via
// `.call(...)`.
export function createRedisStore(prefix: string): Store {
  return new RedisStore({
    sendCommand: (...args: string[]) => (redis.call as any)(...args),
    prefix,
  });
}

const RATE_LIMIT_HEADERS = { standardHeaders: true as const, legacyHeaders: false as const };

// Unauthenticated and the single most sensitive route in this backend (see
// the audit and design spec) - strictest limit of any route.
export const authLoginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 10,
  ...RATE_LIMIT_HEADERS,
  store: createRedisStore('rl:auth:'),
});

// Already requireAuth + requireAdmin gated (see adminApiRoutes.ts), but an
// expensive operation (multer upload, mammoth docx parsing, bulk insert)
// worth bounding even against a compromised/leaked admin session.
export const adminImportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  ...RATE_LIMIT_HEADERS,
  store: createRedisStore('rl:admin-import:'),
});

// Deliberately public/unauthenticated by design (see avatarRoutes.ts's own
// comment), but does a real buffer fetch per request.
export const avatarLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  ...RATE_LIMIT_HEADERS,
  store: createRedisStore('rl:avatar:'),
});

// Baseline for every other /api/* route. Skips paths that already have their
// own stricter limiter above (checked against req.originalUrl, NOT
// req.path/req.url - Express rebases the latter two relative to wherever
// this middleware happens to be mounted, which would make the check wrong
// depending on mount point; originalUrl is always the full, unmodified
// incoming URL regardless of mount point).
const SPECIFIC_LIMIT_PATHS = ['/api/auth/login', '/api/admin/questions/import', '/api/users'];

export const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  ...RATE_LIMIT_HEADERS,
  store: createRedisStore('rl:api:'),
  skip: (req) => SPECIFIC_LIMIT_PATHS.some((p) => req.originalUrl.startsWith(p)),
});
