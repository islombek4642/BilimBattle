# Rate Limiting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the highest-priority security gap found in the earlier audit — zero rate-limiting anywhere in the backend — by adding Redis-backed REST rate limiting and in-process Socket.IO per-event throttling.

**Architecture:** Task 1 adds a new `backend/src/middleware/rateLimiters.ts` (four named `express-rate-limit` instances backed by the existing shared Redis connection) wired into `app.ts`, plus fixes the missing `trust proxy` config required for correct IP-based limiting behind this deployment's `nginx-proxy`. Task 2 adds a new `backend/src/socket/socketThrottle.ts` (a small in-process, per-socket-per-event fixed-window counter, consistent with this backend's existing single-instance-only state patterns) wired into every Socket.IO event handler in `socketServer.ts`.

**Tech Stack:** Backend: Node/TypeScript/Express 5/Socket.IO 4/PostgreSQL/Redis (`ioredis`). New dependencies: `express-rate-limit`, `rate-limit-redis`. Jest tests against a real local Postgres+Redis (this project never mocks the DB/Redis in tests).

**Spec:** `docs/superpowers/specs/2026-07-16-rate-limiting-design.md`

---

### Task 1: REST API rate limiting

**Files:**
- Create: `backend/src/middleware/rateLimiters.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/tests/middleware/rateLimiters.test.ts`

- [ ] **Step 1: Install dependencies**

Run (from `backend/`):
```bash
npm install express-rate-limit rate-limit-redis
```

Expected: both packages added to `backend/package.json` dependencies. **Important:** `rate-limit-redis`'s exact API for wrapping an `ioredis` client (the `sendCommand` function shape) has changed across major versions. After installing, check `node_modules/rate-limit-redis/dist/*.d.ts` (or its README) to confirm the `RedisStore` constructor's expected shape matches what Step 3 below assumes (`sendCommand: (...args: string[]) => Promise<any>`, calling `redis.call(...args)` on the existing `ioredis` instance). If it doesn't match, adjust Step 3's `createRedisStore` implementation to match the actually-installed version's API — the given code is based on the current documented `ioredis` integration pattern for `rate-limit-redis` v4+, but do not blindly trust it over what's actually installed.

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/middleware/rateLimiters.test.ts`:

```typescript
import express from 'express';
import request from 'supertest';
import rateLimit from 'express-rate-limit';
import { redis } from '../../src/config/redis';
import { createRedisStore } from '../../src/middleware/rateLimiters';

describe('createRedisStore', () => {
  const TEST_PREFIX = 'rl:test-store:';

  afterEach(async () => {
    const keys = await redis.keys(`${TEST_PREFIX}*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  it('blocks requests once the configured limit is exceeded within the window', async () => {
    const app = express();
    app.use(
      rateLimit({
        windowMs: 60_000,
        limit: 3,
        standardHeaders: true,
        legacyHeaders: false,
        store: createRedisStore(TEST_PREFIX),
      })
    );
    app.get('/probe', (_req, res) => res.json({ ok: true }));

    const res1 = await request(app).get('/probe');
    const res2 = await request(app).get('/probe');
    const res3 = await request(app).get('/probe');
    const res4 = await request(app).get('/probe');

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res3.status).toBe(200);
    expect(res4.status).toBe(429);
  });
});

describe('named rate limiters wired into the real app', () => {
  const TEST_PREFIXES = ['rl:auth:', 'rl:admin-import:', 'rl:avatar:', 'rl:api:'];

  afterAll(async () => {
    for (const prefix of TEST_PREFIXES) {
      const keys = await redis.keys(`${prefix}*`);
      if (keys.length > 0) await redis.del(...keys);
    }
  });

  it('applies the strict auth-login limiter (limit 10) to POST /api/auth/login, not the general 100-limit', async () => {
    const { createApp } = await import('../../src/app');
    const app = createApp();
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.headers['ratelimit-limit']).toBe('10');
  });

  it('applies the general API limiter (limit 100) to a route with no specific limiter, e.g. GET /api/categories', async () => {
    const { createApp } = await import('../../src/app');
    const app = createApp();
    const res = await request(app).get('/api/categories');
    expect(res.headers['ratelimit-limit']).toBe('100');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run (from `backend/`):
```bash
npx jest tests/middleware/rateLimiters.test.ts
```
Expected: FAIL — `Cannot find module '../../src/middleware/rateLimiters'`.

- [ ] **Step 4: Implement `rateLimiters.ts`**

Create `backend/src/middleware/rateLimiters.ts`:

```typescript
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
    sendCommand: (...args: string[]) => redis.call(...args) as any,
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
```

- [ ] **Step 5: Wire into `app.ts`**

In `backend/src/app.ts`, add this import alongside the existing imports:

```typescript
import { authLoginLimiter, adminImportLimiter, avatarLimiter, generalApiLimiter } from './middleware/rateLimiters';
```

Change:

```typescript
export function createApp() {
  const app = express();
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
```

to:

```typescript
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
```

Change:

```typescript
  app.use(cors({ origin: env.webappUrl }));
  app.use(express.json());
  app.use('/api', authRouter);
```

to:

```typescript
  app.use(cors({ origin: env.webappUrl }));
  app.use(express.json());
  app.use('/api/auth/login', authLoginLimiter);
  app.use('/api/admin/questions/import', adminImportLimiter);
  app.use('/api/users', avatarLimiter);
  app.use('/api', generalApiLimiter);
  app.use('/api', authRouter);
```

(The three specific limiters are mounted before the general one, on their exact routes; the general limiter's `skip` function excludes those same routes so a request never gets double-counted against two different limiters.)

- [ ] **Step 6: Run to verify it passes**

Run (from `backend/`):
```bash
npx jest tests/middleware/rateLimiters.test.ts
```
Expected: PASS — all tests.

- [ ] **Step 7: Run the full backend suite to check for regressions**

Run (from `backend/`):
```bash
npm test
```
Expected: PASS — all tests. Pay particular attention to any existing route test file (`tests/auth/authRoutes.test.ts`, `tests/admin/adminApiRoutes.test.ts`, `tests/users/avatarRoutes.test.ts` if it exists, etc.) that might make MANY requests to the same route in a single test run — with real rate limiting now active, a test that calls a limited route more times than its configured limit within one test run could start failing with 429s where it previously got 200s. If you find such a test, do NOT weaken the new rate limiter to make it pass — instead check whether that test can reasonably be expected to fire more than the configured limit in real usage (if so, this is a genuine signal the limit may be tuned too low and worth flagging in your report; if not, the test itself needs a small adjustment, e.g. clearing the relevant Redis rate-limit keys between its own repeated calls, or you've found a real, worth-reporting tension between test convenience and the new limit).

- [ ] **Step 8: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/middleware/rateLimiters.ts backend/src/app.ts backend/tests/middleware/rateLimiters.test.ts
git commit -m "Add Redis-backed rate limiting to all REST routes"
```

---

### Task 2: Socket.IO per-event throttling

**Files:**
- Create: `backend/src/socket/socketThrottle.ts`
- Modify: `backend/src/socket/socketServer.ts`
- Test: `backend/tests/socket/socketThrottle.test.ts`
- Test: `backend/tests/integration/socketServer.test.ts` (add one new test)

- [ ] **Step 1: Write the failing tests for `socketThrottle.ts`**

Create `backend/tests/socket/socketThrottle.test.ts`:

```typescript
import { isThrottled, clearSocketThrottleState } from '../../src/socket/socketThrottle';

describe('isThrottled', () => {
  it('allows up to maxPerWindow calls within the window, then blocks', () => {
    const socketId = 'test-socket-1';
    expect(isThrottled(socketId, 'test_event', 3, 1000)).toBe(false);
    expect(isThrottled(socketId, 'test_event', 3, 1000)).toBe(false);
    expect(isThrottled(socketId, 'test_event', 3, 1000)).toBe(false);
    expect(isThrottled(socketId, 'test_event', 3, 1000)).toBe(true);
  });

  it('tracks separate windows independently per event name for the same socket', () => {
    const socketId = 'test-socket-2';
    expect(isThrottled(socketId, 'event_a', 1, 1000)).toBe(false);
    expect(isThrottled(socketId, 'event_a', 1, 1000)).toBe(true);
    expect(isThrottled(socketId, 'event_b', 1, 1000)).toBe(false);
  });

  it('tracks separate windows independently per socket for the same event', () => {
    expect(isThrottled('socket-a', 'shared_event', 1, 1000)).toBe(false);
    expect(isThrottled('socket-b', 'shared_event', 1, 1000)).toBe(false);
  });

  it('resets the count once the window has elapsed', async () => {
    const socketId = 'test-socket-3';
    expect(isThrottled(socketId, 'test_event', 1, 50)).toBe(false);
    expect(isThrottled(socketId, 'test_event', 1, 50)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(isThrottled(socketId, 'test_event', 1, 50)).toBe(false);
  });

  it('clearSocketThrottleState removes all bucket state for that socket', () => {
    const socketId = 'test-socket-4';
    expect(isThrottled(socketId, 'test_event', 1, 1000)).toBe(false);
    expect(isThrottled(socketId, 'test_event', 1, 1000)).toBe(true);
    clearSocketThrottleState(socketId);
    expect(isThrottled(socketId, 'test_event', 1, 1000)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `backend/`):
```bash
npx jest tests/socket/socketThrottle.test.ts
```
Expected: FAIL — `Cannot find module '../../src/socket/socketThrottle'`.

- [ ] **Step 3: Implement `socketThrottle.ts`**

Create `backend/src/socket/socketThrottle.ts`:

```typescript
// backend/src/socket/socketThrottle.ts

// Simple in-process, fixed-window, per-socket-per-event counter. In-process
// only (not shared across server instances) - consistent with this
// backend's other single-instance-only state (matchmaker.ts's
// categoryLocks, gameEngine.ts's activeTimers): a given socket connection
// only ever lives on one server process at a time, so per-connection
// throttling doesn't need cross-instance visibility to be effective.
interface Bucket {
  count: number;
  windowStart: number;
}

const bucketsBySocket = new Map<string, Map<string, Bucket>>();

export function isThrottled(socketId: string, eventName: string, maxPerWindow: number, windowMs: number): boolean {
  const now = Date.now();
  let socketBuckets = bucketsBySocket.get(socketId);
  if (!socketBuckets) {
    socketBuckets = new Map();
    bucketsBySocket.set(socketId, socketBuckets);
  }

  const bucket = socketBuckets.get(eventName);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    socketBuckets.set(eventName, { count: 1, windowStart: now });
    return false;
  }

  bucket.count += 1;
  return bucket.count > maxPerWindow;
}

// Called on socket disconnect (see socketServer.ts's trackActiveSocket) so
// this map doesn't grow unboundedly as sockets connect and disconnect over
// the process's lifetime.
export function clearSocketThrottleState(socketId: string): void {
  bucketsBySocket.delete(socketId);
}
```

- [ ] **Step 4: Run to verify it passes**

Run (from `backend/`):
```bash
npx jest tests/socket/socketThrottle.test.ts
```
Expected: PASS — all tests.

- [ ] **Step 5: Wire throttling into every event handler in `socketServer.ts`**

In `backend/src/socket/socketServer.ts`, add this import alongside the existing imports:

```typescript
import { isThrottled, clearSocketThrottleState } from './socketThrottle';
```

Add these constants right after the existing `let activeSocketsByUser = new Map<number, string>();` line:

```typescript
// Per-event throttle budgets. submit_answer gets the highest budget since
// it's the hottest legitimate path (one emit per question, but a fast
// double-tap or a client retry shouldn't be punished); the queue/invite
// events are all much rarer in legitimate use, so a tighter budget there
// doesn't affect real users.
const SUBMIT_ANSWER_THROTTLE = { max: 10, windowMs: 1000 };
const QUEUE_THROTTLE = { max: 5, windowMs: 1000 };
const INVITE_THROTTLE = { max: 5, windowMs: 1000 };
const RECONNECT_THROTTLE = { max: 5, windowMs: 1000 };
```

In `trackActiveSocket`, change:

```typescript
  socket.on('disconnect', (reason) => {
    console.log(`socketServer: socket=${socket.id} (userId=${userId}) disconnected, reason=${reason}`);
    if (activeSocketsByUser.get(userId) === socket.id) {
      activeSocketsByUser.delete(userId);
    }
  });
```

to:

```typescript
  socket.on('disconnect', (reason) => {
    console.log(`socketServer: socket=${socket.id} (userId=${userId}) disconnected, reason=${reason}`);
    if (activeSocketsByUser.get(userId) === socket.id) {
      activeSocketsByUser.delete(userId);
    }
    clearSocketThrottleState(socket.id);
  });
```

Now add a throttle guard as the very first line inside each of the following 9 event handler bodies (in every case, if throttled, `return` immediately — no ack, no error emitted back to the client, so a spamming client gets no signal that it was detected):

1. `submit_answer` — change:
```typescript
    socket.on('submit_answer', ({ gameId, questionIndex, selectedOption }: { gameId: string; questionIndex: number; selectedOption: number }) => {
      submitAnswer(gameId, socket.data.userId, selectedOption, questionIndex).catch((err) => {
```
to:
```typescript
    socket.on('submit_answer', ({ gameId, questionIndex, selectedOption }: { gameId: string; questionIndex: number; selectedOption: number }) => {
      if (isThrottled(socket.id, 'submit_answer', SUBMIT_ANSWER_THROTTLE.max, SUBMIT_ANSWER_THROTTLE.windowMs)) return;
      submitAnswer(gameId, socket.data.userId, selectedOption, questionIndex).catch((err) => {
```

2. `join_queue` — change:
```typescript
    socket.on('join_queue', ({ category }: { category: string }) => {
      // Refuse to queue this socket while it's already in an active game -
```
to:
```typescript
    socket.on('join_queue', ({ category }: { category: string }) => {
      if (isThrottled(socket.id, 'join_queue', QUEUE_THROTTLE.max, QUEUE_THROTTLE.windowMs)) return;
      // Refuse to queue this socket while it's already in an active game -
```

3. `leave_queue` — change:
```typescript
    socket.on('leave_queue', ({ category }: { category: string }) => {
      cancelWaiting(socket.data.userId, category);
    });
```
to:
```typescript
    socket.on('leave_queue', ({ category }: { category: string }) => {
      if (isThrottled(socket.id, 'leave_queue', QUEUE_THROTTLE.max, QUEUE_THROTTLE.windowMs)) return;
      cancelWaiting(socket.data.userId, category);
    });
```

4. `create_invite` — change:
```typescript
    socket.on('create_invite', async ({ category }: { category: string }) => {
      try {
        if (!(await isValidCategory(category))) return;
```
to:
```typescript
    socket.on('create_invite', async ({ category }: { category: string }) => {
      if (isThrottled(socket.id, 'create_invite', INVITE_THROTTLE.max, INVITE_THROTTLE.windowMs)) return;
      try {
        if (!(await isValidCategory(category))) return;
```

5. `join_invite` — change:
```typescript
    socket.on('join_invite', async ({ inviterTelegramId, category }: { inviterTelegramId: number; category: string }) => {
      try {
        // inviterTelegramId comes straight from client input, unlike
```
to:
```typescript
    socket.on('join_invite', async ({ inviterTelegramId, category }: { inviterTelegramId: number; category: string }) => {
      if (isThrottled(socket.id, 'join_invite', INVITE_THROTTLE.max, INVITE_THROTTLE.windowMs)) return;
      try {
        // inviterTelegramId comes straight from client input, unlike
```

6. `join_level_queue` — change:
```typescript
    socket.on('join_level_queue', ({ level }: { level: number }) => {
      if (!Number.isInteger(level) || level < 1) return;
```
to:
```typescript
    socket.on('join_level_queue', ({ level }: { level: number }) => {
      if (isThrottled(socket.id, 'join_level_queue', QUEUE_THROTTLE.max, QUEUE_THROTTLE.windowMs)) return;
      if (!Number.isInteger(level) || level < 1) return;
```

7. `leave_level_queue` — change:
```typescript
    socket.on('leave_level_queue', ({ level }: { level: number }) => {
      if (!Number.isInteger(level) || level < 1) return;
      cancelWaiting(socket.data.userId, `level:${level}`);
    });
```
to:
```typescript
    socket.on('leave_level_queue', ({ level }: { level: number }) => {
      if (isThrottled(socket.id, 'leave_level_queue', QUEUE_THROTTLE.max, QUEUE_THROTTLE.windowMs)) return;
      if (!Number.isInteger(level) || level < 1) return;
      cancelWaiting(socket.data.userId, `level:${level}`);
    });
```

8. `create_level_invite` — change:
```typescript
    socket.on('create_level_invite', async ({ level }: { level: number }) => {
      try {
        if (!Number.isInteger(level) || level < 1) return;
```
to:
```typescript
    socket.on('create_level_invite', async ({ level }: { level: number }) => {
      if (isThrottled(socket.id, 'create_level_invite', INVITE_THROTTLE.max, INVITE_THROTTLE.windowMs)) return;
      try {
        if (!Number.isInteger(level) || level < 1) return;
```

9. `join_level_invite` — change:
```typescript
    socket.on('join_level_invite', async ({ inviterTelegramId }: { inviterTelegramId: number }) => {
      try {
        if (typeof inviterTelegramId !== 'number' || !Number.isFinite(inviterTelegramId)) return;
```
to:
```typescript
    socket.on('join_level_invite', async ({ inviterTelegramId }: { inviterTelegramId: number }) => {
      if (isThrottled(socket.id, 'join_level_invite', INVITE_THROTTLE.max, INVITE_THROTTLE.windowMs)) return;
      try {
        if (typeof inviterTelegramId !== 'number' || !Number.isFinite(inviterTelegramId)) return;
```

10. `reconnect_game` — change:
```typescript
    socket.on('reconnect_game', ({ gameId }: { gameId: string }, ack: (state: unknown) => void) => {
      // A client that emits this event with no ack callback (buggy client,
```
to:
```typescript
    socket.on('reconnect_game', ({ gameId }: { gameId: string }, ack: (state: unknown) => void) => {
      if (isThrottled(socket.id, 'reconnect_game', RECONNECT_THROTTLE.max, RECONNECT_THROTTLE.windowMs)) return;
      // A client that emits this event with no ack callback (buggy client,
```

- [ ] **Step 6: Write the failing integration test proving real wiring**

Add this test to the existing `backend/tests/integration/socketServer.test.ts`, as a new `it(...)` inside the existing `describe('socket server session handling', ...)` block (anywhere after the existing tests):

```typescript
  it('throttles rapid join_queue emissions from the same socket', (done) => {
    const handleJoinQueueSpy = jest.spyOn(matchmaker, 'handleJoinQueue').mockResolvedValue(undefined);
    const token = signSession({ userId: 8888, telegramId: 8888 });
    const client: ClientSocket = ioClient(`http://localhost:${port}`, { auth: { token } });

    client.on('connect', () => {
      for (let i = 0; i < 10; i += 1) {
        client.emit('join_queue', { category: 'umumiy_bilim' });
      }
      setTimeout(() => {
        expect(handleJoinQueueSpy.mock.calls.length).toBeGreaterThan(0);
        expect(handleJoinQueueSpy.mock.calls.length).toBeLessThanOrEqual(5);
        handleJoinQueueSpy.mockRestore();
        client.close();
        done();
      }, 100);
    });
  });
```

- [ ] **Step 7: Prove the test genuinely exercises the throttle, then confirm it passes**

Since Step 5 (wiring) and Step 6 (this test) are both in this same task, the normal red-then-green TDD sequence doesn't directly apply — instead, PROVE the test would fail without the guard: temporarily comment out just the one `isThrottled(...)` line added to `join_queue` in Step 5, run the test below, and confirm it FAILS (because `handleJoinQueueSpy.mock.calls.length` will be `10`, not `≤5`). Then restore that line and re-run to confirm it PASSES.

Run (from `backend/`):
```bash
npx jest tests/integration/socketServer.test.ts
```

Expected final state (with the `join_queue` throttle guard restored): PASS.

- [ ] **Step 8: Run the full backend suite to check for regressions**

Run (from `backend/`):
```bash
npm test
```
Expected: PASS — all tests, including `tests/integration/socketServer.test.ts`'s existing tests and `tests/game/gameEngine.test.ts`/`gameEngineDisconnect.test.ts`/`gameEngineProgression.test.ts` (which drive real matches via rapid `submitAnswer` calls in tight loops — with `SUBMIT_ANSWER_THROTTLE` at 10/second, verify none of these existing tests submit more than 10 answers to the same socket within any single real second; if any does and starts failing, do NOT weaken the throttle to make it pass - instead report this clearly, since it would mean the chosen limit is too tight for even legitimate rapid-fire automated play, and the fix is to raise `SUBMIT_ANSWER_THROTTLE.max`, not to remove the guard).

- [ ] **Step 9: Commit**

```bash
git add backend/src/socket/socketThrottle.ts backend/src/socket/socketServer.ts backend/tests/socket/socketThrottle.test.ts backend/tests/integration/socketServer.test.ts
git commit -m "Add per-socket, per-event throttling to all Socket.IO handlers"
```

---

## After both tasks

Run the full backend suite one final time:
```bash
cd backend && npm test
```
Expected: green. At this point the feature is complete per the design spec: every REST route has an appropriate rate limit (Redis-backed, survives restarts), every Socket.IO event has an appropriate per-socket throttle (in-process, cleaned up on disconnect), and `trust proxy` is correctly configured for this deployment's reverse-proxy setup.
