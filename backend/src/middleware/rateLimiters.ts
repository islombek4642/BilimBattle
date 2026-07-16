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

// A plain object `message` (as opposed to a string) makes express-rate-limit's
// default handler call `response.send(message)`, and Express's res.send()
// forwards any non-null object straight to res.json() - giving a real
// `application/json` body instead of the library's default plain-text
// "Too many requests, please try again later." This keeps 429s consistent
// with every other error path in this backend (res.status(xxx).json({error})),
// which frontend/src/api/client.ts depends on being able to JSON-parse.
const TOO_MANY_REQUESTS_MESSAGE = { error: "Juda ko'p so'rov yuborildi. Birozdan so'ng qayta urinib ko'ring." };

// Unauthenticated and the single most sensitive route in this backend (see
// the audit and design spec) - strictest limit of any route.
export const authLoginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 10,
  ...RATE_LIMIT_HEADERS,
  message: TOO_MANY_REQUESTS_MESSAGE,
  store: createRedisStore('rl:auth:'),
});

// Already requireAuth + requireAdmin gated (see adminApiRoutes.ts), but an
// expensive operation (multer upload, mammoth docx parsing, bulk insert)
// worth bounding even against a compromised/leaked admin session.
export const adminImportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  ...RATE_LIMIT_HEADERS,
  message: TOO_MANY_REQUESTS_MESSAGE,
  store: createRedisStore('rl:admin-import:'),
});

// Deliberately public/unauthenticated by design (see avatarRoutes.ts's own
// comment), but does a real buffer fetch per request.
export const avatarLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  ...RATE_LIMIT_HEADERS,
  message: TOO_MANY_REQUESTS_MESSAGE,
  store: createRedisStore('rl:avatar:'),
});

// Baseline for every other /api/* route. Skips paths that already have their
// own stricter limiter above (checked against req.originalUrl, NOT
// req.path/req.url - Express rebases the latter two relative to wherever
// this middleware happens to be mounted, which would make the check wrong
// depending on mount point; originalUrl is always the full, unmodified
// incoming URL regardless of mount point).
//
// WARNING - /api/users is a bare PREFIX match, not an exact route: it skips
// this general limiter for anything starting with /api/users, on the
// assumption that avatarLimiter (mounted in app.ts on the same prefix)
// already covers it. That's only true today because GET
// /users/:telegramId/avatar is the sole route under /api/users. If you add
// another route under /api/users/* (e.g. /api/users/preferences), it will
// silently get NO baseline rate limit at all (skipped here) AND silently
// inherit avatarLimiter's public/unauthenticated-tuned 60/min budget via the
// same prefix match in app.ts - with no compile error or test failure to
// catch it. Give any new /api/users/* route its OWN specific limiter and its
// OWN exact path entry instead of relying on this prefix.
const SPECIFIC_LIMIT_PATHS = ['/api/auth/login', '/api/admin/questions/import', '/api/users'];

export const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  ...RATE_LIMIT_HEADERS,
  message: TOO_MANY_REQUESTS_MESSAGE,
  store: createRedisStore('rl:api:'),
  skip: (req) => SPECIFIC_LIMIT_PATHS.some((p) => req.originalUrl.startsWith(p)),
});
