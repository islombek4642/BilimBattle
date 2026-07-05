# BilimBattle Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the BilimBattle backend — a Node.js/TypeScript service that authenticates Telegram Mini App users, runs real-time 1v1 quiz battles over WebSocket, matches players (random or via friend invite), persists results, and serves a leaderboard. Fully testable without any frontend (via automated tests and a manual Socket.io test client).

**Architecture:** Express (REST for auth/questions/leaderboard/stats) + Socket.io (real-time matchmaking and battle flow) + PostgreSQL (durable data: users, questions, matches) + Redis (ephemeral data: matchmaking queue, active game state, pending invites). A single Node.js process is assumed for the MVP — no cross-instance coordination is implemented, since the lean MVP does not need horizontal scaling yet.

**Tech Stack:** Node.js, TypeScript, Express, Socket.io, PostgreSQL (`pg`), Redis (`ioredis`), `jsonwebtoken`, `node-telegram-bot-api`, Jest + `ts-jest` + `supertest` + `socket.io-client` for testing.

**Spec reference:** `docs/superpowers/specs/2026-07-06-bilimbattle-quiz-webapp-design.md`

**Resolved ambiguity — "do'stlar orasidagi reyting" (friends leaderboard):** Telegram Mini Apps cannot read a user's Telegram contacts/friends list (platform privacy restriction). The spec's "friends leaderboard" is therefore implemented as a **referral circle**: everyone the user invited (via their invite link) plus whoever invited the user. This is tracked with a single `invited_by_telegram_id` column on `users`, populated from the Mini App's `start_param` on first login. This is documented here because it is a concrete design decision the spec left implicit.

---

## File Structure

```
bilimbattle/backend/
  package.json
  tsconfig.json
  jest.config.js
  .env.example
  .gitignore
  scripts/
    loadTest.ts                    # manual load-test script (not part of `npm test`)
  src/
    config/
      env.ts                       # required env vars, throws if missing
      db.ts                        # pg Pool singleton
      redis.ts                     # ioredis client singleton
    db/
      schema.sql                   # idempotent CREATE TABLE IF NOT EXISTS statements
      migrate.ts                   # applies schema.sql
      seed.ts                      # seeds sample questions
    auth/
      telegramAuth.ts               # validates Telegram Mini App initData (HMAC)
      jwt.ts                        # signs/verifies session tokens
      authMiddleware.ts             # Express requireAuth middleware
      authRoutes.ts                 # POST /api/auth/login
    users/
      userRepository.ts             # upsert/get user, bot user, record match + stats
    questions/
      questionRepository.ts         # categories, random question draw
      questionsRoutes.ts            # GET /api/categories
    matchmaking/
      queue.ts                      # Redis FIFO queue join/leave/pop
      matchmaker.ts                 # pairs waiting players, bot fallback, createMatch
    game/
      gameState.ts                  # Redis-backed GameState CRUD
      scoring.ts                    # correctness + speed-bonus scoring formula
      gameEngine.ts                 # question flow, answers, disconnect/reconnect, finish
    invite/
      inviteRoom.ts                 # Redis-backed pending invite (create/consume)
    leaderboard/
      leaderboardRepository.ts      # global + friends-circle leaderboard queries
      leaderboardRoutes.ts          # GET /api/leaderboard/global, /friends
    stats/
      statsRoutes.ts                # GET /api/stats/me
    socket/
      socketServer.ts               # Socket.io init, auth, single-session, event wiring
    bot/
      telegramBot.ts                # Telegram Bot /start handler (opens the Mini App)
    app.ts                          # Express app assembly
    server.ts                       # HTTP server + Socket.io + bot bootstrap
  tests/
    config/env.test.ts
    auth/telegramAuth.test.ts
    auth/jwt.test.ts
    auth/authMiddleware.test.ts
    auth/authRoutes.test.ts
    users/userRepository.test.ts
    questions/questionRepository.test.ts
    questions/questionsRoutes.test.ts
    matchmaking/queue.test.ts
    game/gameState.test.ts
    game/scoring.test.ts
    game/gameEngine.test.ts
    game/gameEngineDisconnect.test.ts
    leaderboard/leaderboardRepository.test.ts
    leaderboard/leaderboardRoutes.test.ts
    invite/inviteRoom.test.ts
    integration/socketServer.test.ts
```

**Prerequisites before starting:** a local PostgreSQL server and a local Redis server, both reachable via the connection strings in `.env`. Tests run against these same local instances (no test containers or mocks for the database — this keeps the MVP simple, consistent with YAGNI).

---

## Task 1: Backend loyihasini boshlash (scaffolding)

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/jest.config.js`
- Create: `backend/.env.example`
- Create: `backend/.gitignore`
- Create: `backend/src/config/env.ts`
- Test: `backend/tests/config/env.test.ts`

- [ ] **Step 1: Initialize the npm project and install dependencies**

Run:
```bash
mkdir -p backend/src backend/tests backend/scripts
cd backend
npm init -y
npm install express socket.io pg ioredis jsonwebtoken dotenv cors node-telegram-bot-api
npm install -D typescript ts-node ts-node-dev jest ts-jest @types/jest @types/node @types/express @types/jsonwebtoken @types/cors @types/pg supertest @types/supertest socket.io-client @types/node-telegram-bot-api
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src", "scripts"]
}
```

- [ ] **Step 3: Create `jest.config.js`**

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  testTimeout: 15000,
};
```

- [ ] **Step 4: Create `.env.example` and `.gitignore`**

`.env.example`:
```
PORT=3000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/bilimbattle
REDIS_URL=redis://localhost:6379
JWT_SECRET=change-this-to-a-long-random-string
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
WEBAPP_URL=https://your-frontend-domain.example.com
```

`.gitignore`:
```
node_modules/
dist/
.env
```

Copy `.env.example` to `.env` and fill in real local values (a local Postgres/Redis connection string, any random string for `JWT_SECRET`, and a real bot token from @BotFather — a placeholder token is fine until Task 22).

- [ ] **Step 5: Add npm scripts to `package.json`**

Add to the `"scripts"` section:
```json
{
  "scripts": {
    "dev": "ts-node-dev --respawn src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "test": "jest",
    "migrate": "ts-node src/db/migrate.ts",
    "seed": "ts-node src/db/seed.ts",
    "loadtest": "ts-node scripts/loadTest.ts"
  }
}
```

- [ ] **Step 6: Write the failing test for `env.ts`**

```typescript
// backend/tests/config/env.test.ts
describe('env config', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('throws when a required variable is missing', () => {
    delete process.env.DATABASE_URL;
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.JWT_SECRET = 'secret';
    process.env.TELEGRAM_BOT_TOKEN = 'token';
    expect(() => require('../../src/config/env')).toThrow(
      'Missing required environment variable: DATABASE_URL'
    );
  });

  it('loads values when all required variables are present', () => {
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.JWT_SECRET = 'secret';
    process.env.TELEGRAM_BOT_TOKEN = 'token';
    process.env.PORT = '4000';
    const { env } = require('../../src/config/env');
    expect(env.port).toBe(4000);
    expect(env.databaseUrl).toBe('postgres://localhost/test');
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx jest tests/config/env.test.ts`
Expected: FAIL — `Cannot find module '../../src/config/env'`

- [ ] **Step 8: Implement `env.ts`**

```typescript
// backend/src/config/env.ts
import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  databaseUrl: required('DATABASE_URL'),
  redisUrl: required('REDIS_URL'),
  jwtSecret: required('JWT_SECRET'),
  telegramBotToken: required('TELEGRAM_BOT_TOKEN'),
};
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx jest tests/config/env.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 10: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/tsconfig.json backend/jest.config.js backend/.env.example backend/.gitignore backend/src/config/env.ts backend/tests/config/env.test.ts
git commit -m "chore: scaffold backend project with env config"
```

---

## Task 2: PostgreSQL sxemasi va migratsiya

**Files:**
- Create: `backend/src/config/db.ts`
- Create: `backend/src/db/schema.sql`
- Create: `backend/src/db/migrate.ts`

- [ ] **Step 1: Create the pg Pool singleton**

```typescript
// backend/src/config/db.ts
import { Pool } from 'pg';
import { env } from './env';

export const pool = new Pool({ connectionString: env.databaseUrl });
```

- [ ] **Step 2: Create `schema.sql`**

```sql
-- backend/src/db/schema.sql
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT NOT NULL,
  invited_by_telegram_id BIGINT,
  rating INTEGER NOT NULL DEFAULT 1000,
  games_played INTEGER NOT NULL DEFAULT 0,
  games_won INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS questions (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  question_text TEXT NOT NULL,
  options JSONB NOT NULL,
  correct_index SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  player1_id INTEGER NOT NULL REFERENCES users(id),
  player2_id INTEGER NOT NULL REFERENCES users(id),
  player1_score INTEGER NOT NULL,
  player2_score INTEGER NOT NULL,
  winner_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_questions_category ON questions(category);
CREATE INDEX IF NOT EXISTS idx_users_rating ON users(rating DESC);
```

- [ ] **Step 3: Create the migration runner**

```typescript
// backend/src/db/migrate.ts
import fs from 'fs';
import path from 'path';
import { pool } from '../config/db';

async function migrate(): Promise<void> {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  await pool.query(schema);
  console.log('Migration applied successfully.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
```

- [ ] **Step 4: Run the migration against your local database**

Run: `npm run migrate`
Expected: `Migration applied successfully.` — verify with `psql $DATABASE_URL -c '\dt'` that `users`, `questions`, `matches` exist.

- [ ] **Step 5: Commit**

```bash
git add backend/src/config/db.ts backend/src/db/schema.sql backend/src/db/migrate.ts
git commit -m "feat: add PostgreSQL schema and migration runner"
```

---

## Task 3: Redis ulanishi

**Files:**
- Create: `backend/src/config/redis.ts`

- [ ] **Step 1: Create the ioredis client singleton**

```typescript
// backend/src/config/redis.ts
import Redis from 'ioredis';
import { env } from './env';

export const redis = new Redis(env.redisUrl);
```

- [ ] **Step 2: Verify the connection manually**

Run:
```bash
node -e "require('ts-node/register'); const { redis } = require('./src/config/redis'); redis.set('ping','pong').then(() => redis.get('ping')).then(console.log).then(() => process.exit(0));"
```
Expected output: `pong`

- [ ] **Step 3: Commit**

```bash
git add backend/src/config/redis.ts
git commit -m "feat: add Redis client singleton"
```

---

## Task 4: Savollar banki jadvali va urug'lash (seed)

**Files:**
- Create: `backend/src/db/seed.ts`

- [ ] **Step 1: Write the seed script with sample questions for both MVP categories**

```typescript
// backend/src/db/seed.ts
import { pool } from '../config/db';

const questions = [
  // umumiy_bilim
  { category: 'umumiy_bilim', text: "Dunyodagi eng katta okean qaysi?", options: ["Atlantika", "Tinch okeani", "Hind okeani", "Shimoliy Muz okeani"], correctIndex: 1 },
  { category: 'umumiy_bilim', text: "Inson tanasida nechta suyak bor (kattalarda)?", options: ["186", "206", "226", "246"], correctIndex: 1 },
  { category: 'umumiy_bilim', text: "Yer kurrasining necha foizini suv egallaydi?", options: ["51%", "61%", "71%", "81%"], correctIndex: 2 },
  { category: 'umumiy_bilim', text: "Qaysi sayyora \"Qizil sayyora\" deb ataladi?", options: ["Venera", "Mars", "Yupiter", "Saturn"], correctIndex: 1 },
  { category: 'umumiy_bilim', text: "Dunyodagi eng baland tog' cho'qqisi?", options: ["K2", "Everest", "Kilimanjaro", "Elbrus"], correctIndex: 1 },
  { category: 'umumiy_bilim', text: "Fotosintez jarayonida o'simliklar nimani ishlab chiqaradi?", options: ["Karbonat angidrid", "Kislorod", "Azot", "Vodorod"], correctIndex: 1 },
  { category: 'umumiy_bilim', text: "Dunyoda eng ko'p gapiriladigan til qaysi?", options: ["Ingliz tili", "Xitoy tili", "Ispan tili", "Hind tili"], correctIndex: 1 },
  { category: 'umumiy_bilim', text: "Bir yilda necha kun bor (kabisa yili emas)?", options: ["364", "365", "366", "367"], correctIndex: 1 },
  { category: 'umumiy_bilim', text: "Insonning eng katta organi qaysi?", options: ["Jigar", "Miya", "Teri", "O'pka"], correctIndex: 2 },
  { category: 'umumiy_bilim', text: "Qaysi metall xona haroratida suyuq holatda bo'ladi?", options: ["Temir", "Simob", "Mis", "Kumush"], correctIndex: 1 },
  // sport_kino_musiqa
  { category: 'sport_kino_musiqa', text: "Futbolda bir jamoada nechta o'yinchi maydonda bo'ladi?", options: ["9", "10", "11", "12"], correctIndex: 2 },
  { category: 'sport_kino_musiqa', text: "Olimpiya o'yinlari necha yilda bir marta o'tkaziladi?", options: ["2", "3", "4", "5"], correctIndex: 2 },
  { category: 'sport_kino_musiqa', text: "\"Titanik\" filmi qaysi yili chiqqan?", options: ["1995", "1997", "1999", "2001"], correctIndex: 1 },
  { category: 'sport_kino_musiqa', text: "Basketbolda bir jamoada nechta o'yinchi maydonda bo'ladi?", options: ["4", "5", "6", "7"], correctIndex: 1 },
  { category: 'sport_kino_musiqa', text: "Michael Jackson qaysi janrning \"qiroli\" deb ataladi?", options: ["Rok", "Jaz", "Pop", "Klassik"], correctIndex: 2 },
  { category: 'sport_kino_musiqa', text: "Jahon chempionati (futbol) necha yilda bir o'tkaziladi?", options: ["2", "3", "4", "5"], correctIndex: 2 },
  { category: 'sport_kino_musiqa', text: "\"Harry Potter\" seriyasi nechta asosiy kitobdan iborat?", options: ["5", "6", "7", "8"], correctIndex: 2 },
  { category: 'sport_kino_musiqa', text: "Tennisda \"Grand Slam\" turnirlaridan biri qaysi?", options: ["Wimbledon", "Champions League", "Super Bowl", "NBA Finals"], correctIndex: 0 },
  { category: 'sport_kino_musiqa', text: "Real Madrid va Barcelona qaysi mamlakat klublari?", options: ["Portugaliya", "Italiya", "Ispaniya", "Fransiya"], correctIndex: 2 },
  { category: 'sport_kino_musiqa', text: "Qaysi cholg'u asbobi \"musiqa asboblari qiroli\" deb ataladi?", options: ["Skripka", "Pianino", "Gitara", "Nay"], correctIndex: 1 },
];

async function seed(): Promise<void> {
  for (const q of questions) {
    await pool.query(
      `INSERT INTO questions (category, question_text, options, correct_index) VALUES ($1, $2, $3, $4)`,
      [q.category, q.text, JSON.stringify(q.options), q.correctIndex]
    );
  }
  console.log(`Seeded ${questions.length} questions.`);
  await pool.end();
}

seed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the seed script**

Run: `npm run seed`
Expected: `Seeded 20 questions.` — verify with `psql $DATABASE_URL -c 'SELECT category, count(*) FROM questions GROUP BY category;'` showing 10 rows per category.

- [ ] **Step 3: Commit**

```bash
git add backend/src/db/seed.ts
git commit -m "feat: seed sample questions for both MVP categories"
```

---

## Task 5: questionRepository.ts

**Files:**
- Create: `backend/src/questions/questionRepository.ts`
- Test: `backend/tests/questions/questionRepository.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/tests/questions/questionRepository.test.ts
import { pool } from '../../src/config/db';
import { getRandomQuestions, isValidCategory } from '../../src/questions/questionRepository';

describe('questionRepository', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('recognizes valid and invalid categories', () => {
    expect(isValidCategory('umumiy_bilim')).toBe(true);
    expect(isValidCategory('notogri_kategoriya')).toBe(false);
  });

  it('returns the requested number of questions from the category', async () => {
    const questions = await getRandomQuestions('umumiy_bilim', 7);
    expect(questions.length).toBe(7);
    questions.forEach((q) => {
      expect(q.options.length).toBe(4);
      expect(typeof q.correctIndex).toBe('number');
    });
  });

  it('does not return duplicate questions in one draw', async () => {
    const questions = await getRandomQuestions('umumiy_bilim', 7);
    const ids = questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/questions/questionRepository.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `questionRepository.ts`**

```typescript
// backend/src/questions/questionRepository.ts
import { pool } from '../config/db';

export interface QuestionForClient {
  id: number;
  text: string;
  options: string[];
  correctIndex: number;
}

export const CATEGORIES = [
  { key: 'umumiy_bilim', label: "Umumiy bilim" },
  { key: 'sport_kino_musiqa', label: "Sport/Kino/Musiqa" },
];

export function isValidCategory(key: string): boolean {
  return CATEGORIES.some((c) => c.key === key);
}

export async function getRandomQuestions(category: string, count: number): Promise<QuestionForClient[]> {
  const result = await pool.query(
    `SELECT id, question_text, options, correct_index FROM questions WHERE category = $1 ORDER BY RANDOM() LIMIT $2`,
    [category, count]
  );
  return result.rows.map((row) => ({
    id: row.id,
    text: row.question_text,
    options: row.options,
    correctIndex: row.correct_index,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/questions/questionRepository.test.ts`
Expected: PASS (3 tests). Requires the seed from Task 4 to have run already.

- [ ] **Step 5: Commit**

```bash
git add backend/src/questions/questionRepository.ts backend/tests/questions/questionRepository.test.ts
git commit -m "feat: add question repository with random draw"
```

---

## Task 6: GET /api/categories

**Files:**
- Create: `backend/src/questions/questionsRoutes.ts`
- Test: `backend/tests/questions/questionsRoutes.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/tests/questions/questionsRoutes.test.ts
import express from 'express';
import request from 'supertest';
import { questionsRouter } from '../../src/questions/questionsRoutes';

describe('GET /api/categories', () => {
  const app = express();
  app.use('/api', questionsRouter);

  it('returns the list of categories', async () => {
    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(200);
    expect(res.body.categories).toEqual([
      { key: 'umumiy_bilim', label: 'Umumiy bilim' },
      { key: 'sport_kino_musiqa', label: 'Sport/Kino/Musiqa' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/questions/questionsRoutes.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the route**

```typescript
// backend/src/questions/questionsRoutes.ts
import { Router } from 'express';
import { CATEGORIES } from './questionRepository';

export const questionsRouter = Router();

questionsRouter.get('/categories', (_req, res) => {
  res.json({ categories: CATEGORIES });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/questions/questionsRoutes.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add backend/src/questions/questionsRoutes.ts backend/tests/questions/questionsRoutes.test.ts
git commit -m "feat: add GET /api/categories endpoint"
```

---

## Task 7: Telegram initData validatsiyasi

**Files:**
- Create: `backend/src/auth/telegramAuth.ts`
- Test: `backend/tests/auth/telegramAuth.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/tests/auth/telegramAuth.test.ts
import crypto from 'crypto';

const TEST_BOT_TOKEN = 'test-bot-token';

function buildInitData(userObj: object, botToken: string): string {
  const params = new URLSearchParams();
  params.set('user', JSON.stringify(userObj));
  params.set('auth_date', '1700000000');
  params.set('query_id', 'AAEXXXXX');

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

describe('validateInitData', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.TELEGRAM_BOT_TOKEN = TEST_BOT_TOKEN;
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.JWT_SECRET = 'secret';
  });

  it('returns the user for a correctly signed initData', () => {
    const { validateInitData } = require('../../src/auth/telegramAuth');
    const initData = buildInitData({ id: 12345, first_name: 'Aziz', username: 'aziz01' }, TEST_BOT_TOKEN);
    const result = validateInitData(initData);
    expect(result).toEqual({ id: 12345, username: 'aziz01', first_name: 'Aziz' });
  });

  it('returns null when the hash does not match', () => {
    const { validateInitData } = require('../../src/auth/telegramAuth');
    const initData = buildInitData({ id: 12345, first_name: 'Aziz' }, 'wrong-token');
    const result = validateInitData(initData);
    expect(result).toBeNull();
  });

  it('returns null when hash is missing', () => {
    const { validateInitData } = require('../../src/auth/telegramAuth');
    const result = validateInitData('user=%7B%7D&auth_date=1700000000');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/auth/telegramAuth.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `telegramAuth.ts`**

```typescript
// backend/src/auth/telegramAuth.ts
import crypto from 'crypto';
import { env } from '../config/env';

export interface TelegramUser {
  id: number;
  username?: string;
  first_name: string;
}

export function validateInitData(initData: string): TelegramUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(env.telegramBotToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) return null;

  const userJson = params.get('user');
  if (!userJson) return null;

  const user = JSON.parse(userJson);
  return { id: user.id, username: user.username, first_name: user.first_name };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/auth/telegramAuth.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/auth/telegramAuth.ts backend/tests/auth/telegramAuth.test.ts
git commit -m "feat: validate Telegram Mini App initData"
```

---

## Task 8: JWT sessiyasi

**Files:**
- Create: `backend/src/auth/jwt.ts`
- Test: `backend/tests/auth/jwt.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/tests/auth/jwt.test.ts
describe('jwt session', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.JWT_SECRET = 'test-secret';
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.TELEGRAM_BOT_TOKEN = 'token';
  });

  it('signs and verifies a valid session token', () => {
    const { signSession, verifySession } = require('../../src/auth/jwt');
    const token = signSession({ userId: 1, telegramId: 12345 });
    const payload = verifySession(token);
    expect(payload).toMatchObject({ userId: 1, telegramId: 12345 });
  });

  it('returns null for an invalid token', () => {
    const { verifySession } = require('../../src/auth/jwt');
    expect(verifySession('not-a-real-token')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/auth/jwt.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `jwt.ts`**

```typescript
// backend/src/auth/jwt.ts
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface SessionPayload {
  userId: number;
  telegramId: number;
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: '7d' });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, env.jwtSecret) as SessionPayload;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/auth/jwt.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/auth/jwt.ts backend/tests/auth/jwt.test.ts
git commit -m "feat: add JWT session signing and verification"
```

---

## Task 9: userRepository.ts

**Files:**
- Create: `backend/src/users/userRepository.ts`
- Test: `backend/tests/users/userRepository.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/tests/users/userRepository.test.ts
import { pool } from '../../src/config/db';
import { upsertUser, getUserByTelegramId, getOrCreateBotUser, recordMatchResult } from '../../src/users/userRepository';

describe('userRepository', () => {
  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM matches WHERE player1_id IN (SELECT id FROM users WHERE telegram_id IN (111, 222))`);
    await pool.query(`DELETE FROM users WHERE telegram_id IN (111, 222)`);
  });

  it('creates a new user on first upsert and updates on second', async () => {
    const created = await upsertUser(111, 'aziz01', 'Aziz', null);
    expect(created.telegramId).toBe(111);
    expect(created.gamesPlayed).toBe(0);

    const updated = await upsertUser(111, 'aziz_new', 'Aziz', null);
    expect(updated.id).toBe(created.id);
    expect(updated.username).toBe('aziz_new');
  });

  it('finds a user by telegram id', async () => {
    await upsertUser(111, 'aziz01', 'Aziz', null);
    const found = await getUserByTelegramId(111);
    expect(found?.username).toBe('aziz01');
  });

  it('reserves a single bot user across multiple calls', async () => {
    const first = await getOrCreateBotUser();
    const second = await getOrCreateBotUser();
    expect(first.id).toBe(second.id);
    expect(first.telegramId).toBe(0);
  });

  it('records a match result and updates winner/loser stats', async () => {
    const winner = await upsertUser(111, 'winner', 'Vinner', null);
    const loser = await upsertUser(222, 'loser', 'Luzer', null);

    await recordMatchResult({
      category: 'umumiy_bilim',
      player1Id: winner.id,
      player2Id: loser.id,
      player1Score: 500,
      player2Score: 300,
      winnerId: winner.id,
    });

    const updatedWinner = await getUserByTelegramId(111);
    const updatedLoser = await getUserByTelegramId(222);

    expect(updatedWinner?.gamesPlayed).toBe(1);
    expect(updatedWinner?.gamesWon).toBe(1);
    expect(updatedWinner?.currentStreak).toBe(1);
    expect(updatedWinner?.rating).toBe(1020);

    expect(updatedLoser?.gamesPlayed).toBe(1);
    expect(updatedLoser?.gamesWon).toBe(0);
    expect(updatedLoser?.rating).toBe(990);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/users/userRepository.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `userRepository.ts`**

```typescript
// backend/src/users/userRepository.ts
import { pool } from '../config/db';

export interface User {
  id: number;
  telegramId: number;
  username: string | null;
  firstName: string;
  invitedByTelegramId: number | null;
  rating: number;
  gamesPlayed: number;
  gamesWon: number;
  currentStreak: number;
  bestStreak: number;
}

function mapRow(row: any): User {
  return {
    id: row.id,
    telegramId: Number(row.telegram_id),
    username: row.username,
    firstName: row.first_name,
    invitedByTelegramId: row.invited_by_telegram_id ? Number(row.invited_by_telegram_id) : null,
    rating: row.rating,
    gamesPlayed: row.games_played,
    gamesWon: row.games_won,
    currentStreak: row.current_streak,
    bestStreak: row.best_streak,
  };
}

export async function upsertUser(
  telegramId: number,
  username: string | undefined,
  firstName: string,
  invitedByTelegramId: number | null
): Promise<User> {
  const result = await pool.query(
    `INSERT INTO users (telegram_id, username, first_name, invited_by_telegram_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (telegram_id) DO UPDATE SET username = EXCLUDED.username, first_name = EXCLUDED.first_name
     RETURNING *`,
    [telegramId, username ?? null, firstName, invitedByTelegramId]
  );
  return mapRow(result.rows[0]);
}

export async function getUserByTelegramId(telegramId: number): Promise<User | null> {
  const result = await pool.query(`SELECT * FROM users WHERE telegram_id = $1`, [telegramId]);
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function getUserById(id: number): Promise<User | null> {
  const result = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

const BOT_TELEGRAM_ID = 0;

export async function getOrCreateBotUser(): Promise<User> {
  const existing = await getUserByTelegramId(BOT_TELEGRAM_ID);
  if (existing) return existing;
  return upsertUser(BOT_TELEGRAM_ID, 'bilimbattle_bot', 'Bot', null);
}

export async function recordMatchResult(params: {
  category: string;
  player1Id: number;
  player2Id: number;
  player1Score: number;
  player2Score: number;
  winnerId: number | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO matches (category, player1_id, player2_id, player1_score, player2_score, winner_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [params.category, params.player1Id, params.player2Id, params.player1Score, params.player2Score, params.winnerId]
  );

  await updatePlayerStats(params.player1Id, params.winnerId === params.player1Id, params.winnerId !== null);
  await updatePlayerStats(params.player2Id, params.winnerId === params.player2Id, params.winnerId !== null);
}

async function updatePlayerStats(userId: number, won: boolean, hasWinner: boolean): Promise<void> {
  if (won) {
    await pool.query(
      `UPDATE users SET
         games_played = games_played + 1,
         games_won = games_won + 1,
         current_streak = current_streak + 1,
         best_streak = GREATEST(best_streak, current_streak + 1),
         rating = rating + 20
       WHERE id = $1`,
      [userId]
    );
  } else if (hasWinner) {
    await pool.query(
      `UPDATE users SET
         games_played = games_played + 1,
         current_streak = 0,
         rating = GREATEST(rating - 10, 0)
       WHERE id = $1`,
      [userId]
    );
  } else {
    await pool.query(`UPDATE users SET games_played = games_played + 1 WHERE id = $1`, [userId]);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/users/userRepository.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/users/userRepository.ts backend/tests/users/userRepository.test.ts
git commit -m "feat: add user repository with match result and stats tracking"
```

---

## Task 10: requireAuth middleware

**Files:**
- Create: `backend/src/auth/authMiddleware.ts`
- Test: `backend/tests/auth/authMiddleware.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/tests/auth/authMiddleware.test.ts
import express, { Response } from 'express';
import request from 'supertest';
import { requireAuth, AuthenticatedRequest } from '../../src/auth/authMiddleware';
import { signSession } from '../../src/auth/jwt';

describe('requireAuth middleware', () => {
  function buildApp() {
    const app = express();
    app.get('/protected', requireAuth, (req: AuthenticatedRequest, res: Response) => {
      res.json({ userId: req.userId });
    });
    return app;
  }

  it('rejects requests without an Authorization header', async () => {
    const res = await request(buildApp()).get('/protected');
    expect(res.status).toBe(401);
  });

  it('rejects requests with an invalid token', async () => {
    const res = await request(buildApp()).get('/protected').set('Authorization', 'Bearer garbage');
    expect(res.status).toBe(401);
  });

  it('allows requests with a valid token and attaches userId', async () => {
    const token = signSession({ userId: 42, telegramId: 999 });
    const res = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(42);
  });
});
```

This relies on `.env` (created in Task 1) already having a real `JWT_SECRET` — no per-test override is needed here because, unlike the HMAC tests in Task 7, the actual secret value doesn't affect what this test is checking.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/auth/authMiddleware.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `authMiddleware.ts`**

```typescript
// backend/src/auth/authMiddleware.ts
import { Request, Response, NextFunction } from 'express';
import { verifySession } from './jwt';

export interface AuthenticatedRequest extends Request {
  userId?: number;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Sessiya topilmadi' });
    return;
  }
  const token = authHeader.slice('Bearer '.length);
  const payload = verifySession(token);
  if (!payload) {
    res.status(401).json({ error: 'Sessiya yaroqsiz' });
    return;
  }
  req.userId = payload.userId;
  next();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/auth/authMiddleware.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/auth/authMiddleware.ts backend/tests/auth/authMiddleware.test.ts
git commit -m "feat: add requireAuth Express middleware"
```

---

## Task 11: POST /api/auth/login

**Files:**
- Create: `backend/src/auth/authRoutes.ts`
- Test: `backend/tests/auth/authRoutes.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/tests/auth/authRoutes.test.ts
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import { pool } from '../../src/config/db';
import { authRouter } from '../../src/auth/authRoutes';

// Importing authRoutes above triggers env.ts's dotenv.config(), so by this
// line process.env.TELEGRAM_BOT_TOKEN already reflects the real .env value.
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN as string;

function buildInitData(userObj: object): string {
  const params = new URLSearchParams();
  params.set('user', JSON.stringify(userObj));
  params.set('auth_date', '1700000000');
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

describe('POST /api/auth/login', () => {
  const app = express();
  app.use(express.json());
  app.use('/api', authRouter);

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id IN (555, 556)`);
    await pool.end();
  });

  it('rejects requests with no initData', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });

  it('creates a session for valid initData', async () => {
    const initData = buildInitData({ id: 555, first_name: 'Dilnoza', username: 'dilnoza' });
    const res = await request(app).post('/api/auth/login').send({ initData });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.telegramId).toBe(555);
  });

  it('records the inviter from startParam on first login', async () => {
    const initData = buildInitData({ id: 556, first_name: 'Sardor' });
    const res = await request(app).post('/api/auth/login').send({ initData, startParam: 'invite_555' });
    expect(res.status).toBe(200);
    expect(res.body.user.invitedByTelegramId).toBe(555);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/auth/authRoutes.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `authRoutes.ts`**

```typescript
// backend/src/auth/authRoutes.ts
import { Router } from 'express';
import { validateInitData } from './telegramAuth';
import { signSession } from './jwt';
import { upsertUser, getUserByTelegramId } from '../users/userRepository';

export const authRouter = Router();

function parseInviterTelegramId(startParam: string | undefined): number | null {
  if (!startParam?.startsWith('invite_')) return null;
  const id = Number(startParam.slice('invite_'.length));
  return Number.isFinite(id) ? id : null;
}

authRouter.post('/auth/login', async (req, res) => {
  const { initData, startParam } = req.body as { initData?: string; startParam?: string };
  if (!initData) {
    res.status(400).json({ error: 'initData yuborilmadi' });
    return;
  }

  const telegramUser = validateInitData(initData);
  if (!telegramUser) {
    res.status(401).json({ error: 'Telegram autentifikatsiyasi muvaffaqiyatsiz' });
    return;
  }

  const existing = await getUserByTelegramId(telegramUser.id);
  const inviterTelegramId = existing ? existing.invitedByTelegramId : parseInviterTelegramId(startParam);

  const user = await upsertUser(telegramUser.id, telegramUser.username, telegramUser.first_name, inviterTelegramId);
  const token = signSession({ userId: user.id, telegramId: user.telegramId });

  res.json({ token, user });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/auth/authRoutes.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/auth/authRoutes.ts backend/tests/auth/authRoutes.test.ts
git commit -m "feat: add POST /api/auth/login with referral tracking"
```

---

## Task 12: gameState.ts (Redis-backed o'yin holati)

**Files:**
- Create: `backend/src/game/gameState.ts`
- Test: `backend/tests/game/gameState.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/tests/game/gameState.test.ts
import { redis } from '../../src/config/redis';
import { saveGame, getGame, deleteGame, GameState } from '../../src/game/gameState';

describe('gameState', () => {
  const sampleGame: GameState = {
    gameId: 'test-game-1',
    category: 'umumiy_bilim',
    questions: [{ id: 1, text: 'Q1?', options: ['A', 'B', 'C', 'D'], correctIndex: 0 }],
    currentQuestionIndex: -1,
    players: [
      { userId: 1, socketId: 'sock1', score: 0, answers: [], isBot: false },
      { userId: 2, socketId: 'sock2', score: 0, answers: [], isBot: false },
    ],
    status: 'active',
  };

  afterEach(async () => {
    await deleteGame('test-game-1');
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('saves and retrieves a game by id', async () => {
    await saveGame(sampleGame);
    const loaded = await getGame('test-game-1');
    expect(loaded).toEqual(sampleGame);
  });

  it('returns null for a game that does not exist', async () => {
    const loaded = await getGame('nonexistent');
    expect(loaded).toBeNull();
  });

  it('deletes a game', async () => {
    await saveGame(sampleGame);
    await deleteGame('test-game-1');
    const loaded = await getGame('test-game-1');
    expect(loaded).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/game/gameState.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `gameState.ts`**

```typescript
// backend/src/game/gameState.ts
import { redis } from '../config/redis';
import { QuestionForClient } from '../questions/questionRepository';

export interface PlayerAnswer {
  selectedOption: number;
  points: number;
}

export interface PlayerState {
  userId: number;
  socketId: string;
  score: number;
  answers: (PlayerAnswer | undefined)[];
  isBot: boolean;
  disconnectedAt?: number;
}

export interface GameState {
  gameId: string;
  category: string;
  questions: QuestionForClient[];
  currentQuestionIndex: number;
  questionStartedAt?: number;
  players: [PlayerState, PlayerState];
  status: 'active' | 'finished';
}

const GAME_TTL_SECONDS = 60 * 30;

function gameKey(gameId: string): string {
  return `game:${gameId}`;
}

export async function saveGame(game: GameState): Promise<void> {
  await redis.set(gameKey(game.gameId), JSON.stringify(game), 'EX', GAME_TTL_SECONDS);
}

export async function getGame(gameId: string): Promise<GameState | null> {
  const raw = await redis.get(gameKey(gameId));
  return raw ? JSON.parse(raw) : null;
}

export async function deleteGame(gameId: string): Promise<void> {
  await redis.del(gameKey(gameId));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/game/gameState.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/game/gameState.ts backend/tests/game/gameState.test.ts
git commit -m "feat: add Redis-backed game state storage"
```

---

## Task 13: scoring.ts (ball hisoblash formulasi)

**Files:**
- Create: `backend/src/game/scoring.ts`
- Test: `backend/tests/game/scoring.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/tests/game/scoring.test.ts
import { calculateScore, QUESTION_TIME_LIMIT_MS, BASE_CORRECT_POINTS, MAX_SPEED_BONUS } from '../../src/game/scoring';

describe('calculateScore', () => {
  it('returns 0 for an incorrect answer regardless of speed', () => {
    expect(calculateScore(false, 500)).toBe(0);
    expect(calculateScore(false, 9999)).toBe(0);
  });

  it('returns max points for an instant correct answer', () => {
    expect(calculateScore(true, 0)).toBe(BASE_CORRECT_POINTS + MAX_SPEED_BONUS);
  });

  it('returns base points with no speed bonus for a correct answer at the time limit', () => {
    expect(calculateScore(true, QUESTION_TIME_LIMIT_MS)).toBe(BASE_CORRECT_POINTS);
  });

  it('returns a partial speed bonus for a correct answer halfway through the time window', () => {
    expect(calculateScore(true, QUESTION_TIME_LIMIT_MS / 2)).toBe(BASE_CORRECT_POINTS + MAX_SPEED_BONUS / 2);
  });

  it('clamps answer times beyond the limit to zero bonus', () => {
    expect(calculateScore(true, QUESTION_TIME_LIMIT_MS * 2)).toBe(BASE_CORRECT_POINTS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/game/scoring.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `scoring.ts`**

```typescript
// backend/src/game/scoring.ts
export const QUESTION_TIME_LIMIT_MS = 10_000;
export const BASE_CORRECT_POINTS = 100;
export const MAX_SPEED_BONUS = 100;

export function calculateScore(isCorrect: boolean, answerTimeMs: number): number {
  if (!isCorrect) return 0;
  const clampedTime = Math.min(Math.max(answerTimeMs, 0), QUESTION_TIME_LIMIT_MS);
  const remainingMs = QUESTION_TIME_LIMIT_MS - clampedTime;
  const speedBonus = Math.round((remainingMs / QUESTION_TIME_LIMIT_MS) * MAX_SPEED_BONUS);
  return BASE_CORRECT_POINTS + speedBonus;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/game/scoring.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/game/scoring.ts backend/tests/game/scoring.test.ts
git commit -m "feat: add correctness + speed-bonus scoring formula"
```

---

## Task 14: Redis matchmaking navbati (queue.ts)

**Files:**
- Create: `backend/src/matchmaking/queue.ts`
- Test: `backend/tests/matchmaking/queue.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/tests/matchmaking/queue.test.ts
import { redis } from '../../src/config/redis';
import { joinQueue, leaveQueue, popTwoIfAvailable } from '../../src/matchmaking/queue';

describe('matchmaking queue', () => {
  const category = 'test_category';

  afterEach(async () => {
    await redis.del(`queue:${category}`);
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('returns null when fewer than two players are queued', async () => {
    await joinQueue(category, { userId: 1, socketId: 'a' });
    const result = await popTwoIfAvailable(category);
    expect(result).toBeNull();
  });

  it('pairs the first two players in FIFO order', async () => {
    await joinQueue(category, { userId: 1, socketId: 'a' });
    await joinQueue(category, { userId: 2, socketId: 'b' });
    await joinQueue(category, { userId: 3, socketId: 'c' });

    const pair = await popTwoIfAvailable(category);
    expect(pair).toEqual([
      { userId: 1, socketId: 'a' },
      { userId: 2, socketId: 'b' },
    ]);

    const remaining = await redis.llen(`queue:${category}`);
    expect(remaining).toBe(1);
  });

  it('removes a specific player from the queue', async () => {
    await joinQueue(category, { userId: 1, socketId: 'a' });
    await joinQueue(category, { userId: 2, socketId: 'b' });
    await leaveQueue(category, 1);

    const remaining = await redis.lrange(`queue:${category}`, 0, -1);
    expect(remaining.map((r) => JSON.parse(r).userId)).toEqual([2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/matchmaking/queue.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `queue.ts`**

```typescript
// backend/src/matchmaking/queue.ts
import { redis } from '../config/redis';

function queueKey(category: string): string {
  return `queue:${category}`;
}

export interface QueuedPlayer {
  userId: number;
  socketId: string;
}

export async function joinQueue(category: string, player: QueuedPlayer): Promise<void> {
  await redis.rpush(queueKey(category), JSON.stringify(player));
}

export async function leaveQueue(category: string, userId: number): Promise<void> {
  const items = await redis.lrange(queueKey(category), 0, -1);
  const match = items.find((item) => JSON.parse(item).userId === userId);
  if (match) {
    await redis.lrem(queueKey(category), 1, match);
  }
}

export async function popTwoIfAvailable(category: string): Promise<[QueuedPlayer, QueuedPlayer] | null> {
  const length = await redis.llen(queueKey(category));
  if (length < 2) return null;
  const first = await redis.lpop(queueKey(category));
  const second = await redis.lpop(queueKey(category));
  if (!first || !second) return null;
  return [JSON.parse(first), JSON.parse(second)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/matchmaking/queue.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/matchmaking/queue.ts backend/tests/matchmaking/queue.test.ts
git commit -m "feat: add Redis FIFO matchmaking queue"
```

---

## Task 15: Socket.io serveri (skeleton) — autentifikatsiya va yagona sessiya

**Files:**
- Create: `backend/src/socket/socketServer.ts`
- Test: `backend/tests/integration/socketServer.test.ts`

- [ ] **Step 1: Write the failing integration test**

```typescript
// backend/tests/integration/socketServer.test.ts
import { createServer } from 'http';
import { AddressInfo } from 'net';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { initSocketServer } from '../../src/socket/socketServer';
import { signSession } from '../../src/auth/jwt';

describe('socket server session handling', () => {
  let httpServer: ReturnType<typeof createServer>;
  let port: number;

  beforeAll((done) => {
    httpServer = createServer();
    initSocketServer(httpServer);
    httpServer.listen(0, () => {
      port = (httpServer.address() as AddressInfo).port;
      done();
    });
  });

  afterAll((done) => {
    httpServer.close(done);
  });

  it('rejects a connection without a valid token', (done) => {
    const client: ClientSocket = ioClient(`http://localhost:${port}`, { auth: { token: 'invalid' } });
    client.on('connect_error', (err) => {
      expect(err.message).toContain('yaroqsiz');
      client.close();
      done();
    });
  });

  it('disconnects the previous socket when the same user connects again', (done) => {
    const token = signSession({ userId: 9999, telegramId: 9999 });
    const clientA: ClientSocket = ioClient(`http://localhost:${port}`, { auth: { token } });

    clientA.on('connect', () => {
      const clientB: ClientSocket = ioClient(`http://localhost:${port}`, { auth: { token } });

      clientA.on('session_replaced', () => {
        clientA.close();
        clientB.close();
        done();
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/integration/socketServer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the socket server skeleton**

```typescript
// backend/src/socket/socketServer.ts
import { Server, Socket } from 'socket.io';
import { createServer } from 'http';
import { verifySession } from '../auth/jwt';

let io: Server | null = null;
const activeSocketsByUser = new Map<number, string>();

export function initSocketServer(httpServer: ReturnType<typeof createServer>): Server {
  io = new Server(httpServer, { cors: { origin: '*' } });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      next(new Error('Sessiya topilmadi'));
      return;
    }
    const payload = verifySession(token);
    if (!payload) {
      next(new Error('Sessiya yaroqsiz'));
      return;
    }
    socket.data.userId = payload.userId;
    socket.data.telegramId = payload.telegramId;
    next();
  });

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId as number;
    const existingSocketId = activeSocketsByUser.get(userId);
    if (existingSocketId && existingSocketId !== socket.id) {
      const existingSocket = io!.sockets.sockets.get(existingSocketId);
      existingSocket?.emit('session_replaced');
      existingSocket?.disconnect(true);
    }
    activeSocketsByUser.set(userId, socket.id);

    socket.on('disconnect', () => {
      if (activeSocketsByUser.get(userId) === socket.id) {
        activeSocketsByUser.delete(userId);
      }
    });
  });

  return io;
}

export function getIO(): Server {
  if (!io) {
    throw new Error('Socket.io server hali ishga tushirilmagan');
  }
  return io;
}

export function setIOForTesting(mockIO: Server): void {
  io = mockIO;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/integration/socketServer.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/socket/socketServer.ts backend/tests/integration/socketServer.test.ts
git commit -m "feat: add Socket.io server with auth and single-session enforcement"
```

---

## Task 16: gameEngine.ts — o'yin motori asosi

**Files:**
- Create: `backend/src/game/gameEngine.ts`
- Modify: `backend/src/socket/socketServer.ts` (add `submit_answer` handler)
- Test: `backend/tests/game/gameEngine.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/tests/game/gameEngine.test.ts
import { pool } from '../../src/config/db';
import { redis } from '../../src/config/redis';
import { setIOForTesting } from '../../src/socket/socketServer';
import { startGame, submitAnswer } from '../../src/game/gameEngine';
import { getGame } from '../../src/game/gameState';
import { upsertUser } from '../../src/users/userRepository';
import { randomUUID } from 'crypto';

function createFakeIO() {
  const events: { room: string; event: string; payload: unknown }[] = [];
  const fakeIO = {
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          events.push({ room, event, payload });
        },
      };
    },
  };
  return { fakeIO, events };
}

describe('gameEngine full match flow', () => {
  let player1Id: number;
  let player2Id: number;

  beforeAll(async () => {
    const p1 = await upsertUser(7001, 'p1', 'Player1', null);
    const p2 = await upsertUser(7002, 'p2', 'Player2', null);
    player1Id = p1.id;
    player2Id = p2.id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM matches WHERE player1_id = $1 OR player2_id = $1`, [player1Id]);
    await pool.query(`DELETE FROM users WHERE telegram_id IN (7001, 7002)`);
    await pool.end();
    await redis.quit();
  });

  it('runs a full 7-question match and persists the result', async () => {
    const { fakeIO, events } = createFakeIO();
    setIOForTesting(fakeIO as any);

    const gameId = randomUUID();
    await startGame(gameId, 'umumiy_bilim', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' });

    for (let i = 0; i < 7; i += 1) {
      const questionEvent = events.filter((e) => e.event === 'question')[i];
      expect(questionEvent).toBeDefined();

      await submitAnswer(gameId, player1Id, 0);
      await submitAnswer(gameId, player2Id, 1);
    }

    const gameOverEvent = events.find((e) => e.event === 'game_over');
    expect(gameOverEvent).toBeDefined();
    const payload = gameOverEvent!.payload as { scores: { userId: number; score: number }[] };
    expect(payload.scores.length).toBe(2);

    const matchRow = await pool.query(
      `SELECT * FROM matches WHERE player1_id = $1 AND player2_id = $2 ORDER BY id DESC LIMIT 1`,
      [player1Id, player2Id]
    );
    expect(matchRow.rows.length).toBe(1);
  });

  it('ignores a second answer submission for the same question', async () => {
    const { fakeIO } = createFakeIO();
    setIOForTesting(fakeIO as any);

    const gameId = randomUUID();
    await startGame(gameId, 'umumiy_bilim', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' });

    await submitAnswer(gameId, player1Id, 0);
    await submitAnswer(gameId, player1Id, 2);

    const game = await getGame(gameId);
    expect(game!.players.find((p) => p.userId === player1Id)!.answers[0]?.selectedOption).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/game/gameEngine.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `gameEngine.ts`**

```typescript
// backend/src/game/gameEngine.ts
import { getIO } from '../socket/socketServer';
import { getGame, saveGame, deleteGame, GameState } from './gameState';
import { calculateScore, QUESTION_TIME_LIMIT_MS } from './scoring';
import { getRandomQuestions, QuestionForClient } from '../questions/questionRepository';
import { recordMatchResult } from '../users/userRepository';

export interface PlayerInfo {
  userId: number;
  socketId: string;
  isBot?: boolean;
}

const QUESTIONS_PER_GAME = 7;
const activeTimers = new Map<string, NodeJS.Timeout>();

export async function startGame(gameId: string, category: string, player1: PlayerInfo, player2: PlayerInfo): Promise<void> {
  const questions = await getRandomQuestions(category, QUESTIONS_PER_GAME);
  const game: GameState = {
    gameId,
    category,
    questions,
    currentQuestionIndex: -1,
    players: [
      { userId: player1.userId, socketId: player1.socketId, score: 0, answers: [], isBot: player1.isBot ?? false },
      { userId: player2.userId, socketId: player2.socketId, score: 0, answers: [], isBot: player2.isBot ?? false },
    ],
    status: 'active',
  };
  await saveGame(game);
  await sendNextQuestion(gameId);
}

async function sendNextQuestion(gameId: string): Promise<void> {
  const game = await getGame(gameId);
  if (!game) return;
  game.currentQuestionIndex += 1;
  if (game.currentQuestionIndex >= game.questions.length) {
    await finishGame(gameId);
    return;
  }
  game.questionStartedAt = Date.now();
  await saveGame(game);
  const question = game.questions[game.currentQuestionIndex];
  getIO().to(gameId).emit('question', {
    index: game.currentQuestionIndex,
    total: game.questions.length,
    text: question.text,
    options: question.options,
    timeLimitMs: QUESTION_TIME_LIMIT_MS,
  });

  const botPlayer = game.players.find((p) => p.isBot);
  if (botPlayer) {
    scheduleBotAnswer(gameId, botPlayer.userId, question);
  }

  const timer = setTimeout(() => resolveQuestion(gameId), QUESTION_TIME_LIMIT_MS);
  activeTimers.set(gameId, timer);
}

function scheduleBotAnswer(gameId: string, botUserId: number, question: QuestionForClient): void {
  const delay = 2000 + Math.random() * 6000;
  const willAnswerCorrectly = Math.random() < 0.7;
  const selected = willAnswerCorrectly ? question.correctIndex : (question.correctIndex + 1) % question.options.length;
  setTimeout(() => {
    void submitAnswer(gameId, botUserId, selected);
  }, delay);
}

export async function submitAnswer(gameId: string, userId: number, selectedOption: number): Promise<void> {
  const game = await getGame(gameId);
  if (!game || game.status !== 'active') return;
  const player = game.players.find((p) => p.userId === userId);
  if (!player) return;
  if (player.answers[game.currentQuestionIndex] !== undefined) return;

  const answerTimeMs = Date.now() - (game.questionStartedAt ?? Date.now());
  const question = game.questions[game.currentQuestionIndex];
  const isCorrect = selectedOption === question.correctIndex;
  const points = calculateScore(isCorrect, answerTimeMs);
  player.answers[game.currentQuestionIndex] = { selectedOption, points };
  player.score += points;
  await saveGame(game);

  const bothAnswered = game.players.every((p) => p.answers[game.currentQuestionIndex] !== undefined);
  if (bothAnswered) {
    const timer = activeTimers.get(gameId);
    if (timer) clearTimeout(timer);
    await resolveQuestion(gameId);
  }
}

async function resolveQuestion(gameId: string): Promise<void> {
  activeTimers.delete(gameId);
  const game = await getGame(gameId);
  if (!game) return;
  const question = game.questions[game.currentQuestionIndex];
  getIO().to(gameId).emit('question_result', {
    index: game.currentQuestionIndex,
    correctIndex: question.correctIndex,
    scores: game.players.map((p) => ({ userId: p.userId, score: p.score })),
  });
  await sendNextQuestion(gameId);
}

async function finishGame(gameId: string): Promise<void> {
  const game = await getGame(gameId);
  if (!game) return;
  game.status = 'finished';
  await saveGame(game);
  const [p1, p2] = game.players;
  const winnerId = p1.score === p2.score ? null : p1.score > p2.score ? p1.userId : p2.userId;

  getIO().to(gameId).emit('game_over', {
    scores: game.players.map((p) => ({ userId: p.userId, score: p.score })),
    winnerId,
  });

  await recordMatchResult({
    category: game.category,
    player1Id: p1.userId,
    player2Id: p2.userId,
    player1Score: p1.score,
    player2Score: p2.score,
    winnerId,
  });

  await deleteGame(gameId);
}
```

- [ ] **Step 4: Add the `submit_answer` handler to `socketServer.ts`**

In `backend/src/socket/socketServer.ts`, add this import at the top:

```typescript
import { submitAnswer } from '../game/gameEngine';
```

And inside the `io.on('connection', (socket: Socket) => { ... })` block, after the existing `disconnect` handler, add:

```typescript
    socket.on('submit_answer', async ({ gameId, selectedOption }: { gameId: string; selectedOption: number }) => {
      await submitAnswer(gameId, userId, selectedOption);
    });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/game/gameEngine.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/src/game/gameEngine.ts backend/src/socket/socketServer.ts backend/tests/game/gameEngine.test.ts
git commit -m "feat: add game engine with question flow, scoring, and bot answers"
```

---

## Task 17: matchmaker.ts — juftlashtirish va bot-raqib

**Files:**
- Create: `backend/src/matchmaking/matchmaker.ts`
- Modify: `backend/src/socket/socketServer.ts` (add `join_queue`/`leave_queue` handlers, track `socket.data.gameId`)
- Test: `backend/tests/matchmaking/matchmaker.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/tests/matchmaking/matchmaker.test.ts
import { pool } from '../../src/config/db';
import { redis } from '../../src/config/redis';
import { setIOForTesting } from '../../src/socket/socketServer';
import { handleJoinQueue } from '../../src/matchmaking/matchmaker';
import { upsertUser } from '../../src/users/userRepository';

function createFakeIO() {
  const events: { room: string; event: string; payload: unknown }[] = [];
  const sockets = new Map<string, { id: string; data: Record<string, unknown>; joinedRooms: string[] }>();
  const fakeIO = {
    sockets: {
      sockets: {
        get(id: string) {
          if (!sockets.has(id)) {
            sockets.set(id, {
              id,
              data: {},
              joinedRooms: [],
              join(room: string) {
                sockets.get(id)!.joinedRooms.push(room);
              },
            } as any);
          }
          return sockets.get(id);
        },
      },
    },
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          events.push({ room, event, payload });
        },
      };
    },
  };
  return { fakeIO, events, sockets };
}

describe('matchmaker', () => {
  let player1Id: number;
  let player2Id: number;

  beforeAll(async () => {
    const p1 = await upsertUser(7201, 'm1', 'Match1', null);
    const p2 = await upsertUser(7202, 'm2', 'Match2', null);
    player1Id = p1.id;
    player2Id = p2.id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM matches WHERE player1_id = $1 OR player2_id = $1`, [player1Id]);
    await pool.query(`DELETE FROM users WHERE telegram_id IN (7201, 7202)`);
    await redis.del('queue:umumiy_bilim');
    await pool.end();
    await redis.quit();
  });

  it('matches two queued players immediately and emits match_found', async () => {
    const { fakeIO, events } = createFakeIO();
    setIOForTesting(fakeIO as any);

    await handleJoinQueue(fakeIO as any, 'sockA', player1Id, 'umumiy_bilim');
    await handleJoinQueue(fakeIO as any, 'sockB', player2Id, 'umumiy_bilim');

    const matchFoundEvents = events.filter((e) => e.event === 'match_found');
    expect(matchFoundEvents.length).toBe(1);

    const questionEvents = events.filter((e) => e.event === 'question');
    expect(questionEvents.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/matchmaking/matchmaker.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `matchmaker.ts`**

```typescript
// backend/src/matchmaking/matchmaker.ts
import { Server } from 'socket.io';
import { randomUUID } from 'crypto';
import { joinQueue, leaveQueue, popTwoIfAvailable } from './queue';
import { startGame } from '../game/gameEngine';
import { isValidCategory } from '../questions/questionRepository';
import { getOrCreateBotUser } from '../users/userRepository';

const BOT_MATCH_TIMEOUT_MS = 15_000;
const waitingTimers = new Map<number, NodeJS.Timeout>();

export interface QueueParticipant {
  userId: number;
  socketId: string;
}

export async function handleJoinQueue(io: Server, socketId: string, userId: number, category: string): Promise<void> {
  if (!isValidCategory(category)) return;

  await joinQueue(category, { userId, socketId });
  const pair = await popTwoIfAvailable(category);

  if (pair) {
    const [player1, player2] = pair;
    clearWaitingTimer(player1.userId);
    clearWaitingTimer(player2.userId);
    await createMatch(io, category, player1, player2);
    return;
  }

  const timer = setTimeout(async () => {
    waitingTimers.delete(userId);
    await leaveQueue(category, userId);
    const bot = await getOrCreateBotUser();
    await createMatch(io, category, { userId, socketId }, { userId: bot.id, socketId: 'bot' }, true);
  }, BOT_MATCH_TIMEOUT_MS);
  waitingTimers.set(userId, timer);
}

export function cancelWaiting(userId: number, category: string): void {
  clearWaitingTimer(userId);
  void leaveQueue(category, userId);
}

function clearWaitingTimer(userId: number): void {
  const timer = waitingTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    waitingTimers.delete(userId);
  }
}

export async function createMatch(
  io: Server,
  category: string,
  player1: QueueParticipant,
  player2: QueueParticipant,
  player2IsBot = false
): Promise<void> {
  const gameId = randomUUID();

  const socket1 = io.sockets.sockets.get(player1.socketId);
  socket1?.join(gameId);
  if (socket1) socket1.data.gameId = gameId;

  if (player2.socketId !== 'bot') {
    const socket2 = io.sockets.sockets.get(player2.socketId);
    socket2?.join(gameId);
    if (socket2) socket2.data.gameId = gameId;
  }

  io.to(gameId).emit('match_found', { gameId, category });
  await startGame(gameId, category, player1, { ...player2, isBot: player2IsBot });
}
```

- [ ] **Step 4: Wire `join_queue`/`leave_queue` into `socketServer.ts`**

In `backend/src/socket/socketServer.ts`, add this import:

```typescript
import { handleJoinQueue, cancelWaiting } from '../matchmaking/matchmaker';
```

And inside the connection handler, add these two handlers (alongside `submit_answer`):

```typescript
    socket.on('join_queue', async ({ category }: { category: string }) => {
      await handleJoinQueue(io as Server, socket.id, userId, category);
    });

    socket.on('leave_queue', ({ category }: { category: string }) => {
      cancelWaiting(userId, category);
    });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/matchmaking/matchmaker.test.ts`
Expected: PASS (1 test)

- [ ] **Step 6: Commit**

```bash
git add backend/src/matchmaking/matchmaker.ts backend/src/socket/socketServer.ts backend/tests/matchmaking/matchmaker.test.ts
git commit -m "feat: add matchmaker with pairing and bot fallback"
```

---

## Task 18: Ulanish uzilishi va qayta ulanish (disconnect/reconnect/forfeit)

**Files:**
- Modify: `backend/src/game/gameEngine.ts` (add `handleDisconnect`, `handleReconnect`)
- Modify: `backend/src/socket/socketServer.ts` (call them from `disconnect` and add `reconnect_game`)
- Test: `backend/tests/game/gameEngineDisconnect.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/tests/game/gameEngineDisconnect.test.ts
import { pool } from '../../src/config/db';
import { redis } from '../../src/config/redis';
import { setIOForTesting } from '../../src/socket/socketServer';
import { startGame, handleDisconnect, handleReconnect } from '../../src/game/gameEngine';
import { upsertUser } from '../../src/users/userRepository';
import { randomUUID } from 'crypto';

function createFakeIO() {
  const events: { room: string; event: string; payload: unknown }[] = [];
  const fakeIO = {
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          events.push({ room, event, payload });
        },
      };
    },
  };
  return { fakeIO, events };
}

describe('gameEngine disconnect/reconnect handling', () => {
  let player1Id: number;
  let player2Id: number;

  beforeAll(async () => {
    const p1 = await upsertUser(7101, 'p1d', 'Player1D', null);
    const p2 = await upsertUser(7102, 'p2d', 'Player2D', null);
    player1Id = p1.id;
    player2Id = p2.id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM matches WHERE player1_id = $1 OR player2_id = $1`, [player1Id]);
    await pool.query(`DELETE FROM users WHERE telegram_id IN (7101, 7102)`);
    await pool.end();
    await redis.quit();
  });

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('forfeits a player who does not reconnect within the grace period', async () => {
    const { fakeIO, events } = createFakeIO();
    setIOForTesting(fakeIO as any);

    const gameId = randomUUID();
    await startGame(gameId, 'umumiy_bilim', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' });

    await handleDisconnect(gameId, player1Id);
    jest.advanceTimersByTime(10_000);
    await Promise.resolve();
    await Promise.resolve();

    const gameOverEvent = events.find((e) => e.event === 'game_over');
    expect(gameOverEvent).toBeDefined();
    const payload = gameOverEvent!.payload as { winnerId: number; forfeited: boolean };
    expect(payload.winnerId).toBe(player2Id);
    expect(payload.forfeited).toBe(true);
  });

  it('cancels the forfeit if the player reconnects in time', async () => {
    const { fakeIO, events } = createFakeIO();
    setIOForTesting(fakeIO as any);

    const gameId = randomUUID();
    await startGame(gameId, 'umumiy_bilim', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' });

    await handleDisconnect(gameId, player1Id);
    const reconnected = await handleReconnect(gameId, player1Id, 'sock1-new');
    expect(reconnected).toBe(true);

    jest.advanceTimersByTime(10_000);
    await Promise.resolve();

    const gameOverEvent = events.find((e) => e.event === 'game_over');
    expect(gameOverEvent).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/game/gameEngineDisconnect.test.ts`
Expected: FAIL — `handleDisconnect is not a function`

- [ ] **Step 3: Add disconnect/reconnect handling to `gameEngine.ts`**

Add this to `backend/src/game/gameEngine.ts` (below the existing `finishGame` function):

```typescript
const RECONNECT_GRACE_MS = 10_000;
const disconnectTimers = new Map<string, NodeJS.Timeout>();

export async function handleDisconnect(gameId: string, userId: number): Promise<void> {
  const game = await getGame(gameId);
  if (!game || game.status !== 'active') return;
  const player = game.players.find((p) => p.userId === userId);
  if (!player) return;
  player.disconnectedAt = Date.now();
  await saveGame(game);

  const timerKey = `${gameId}:${userId}`;
  const timer = setTimeout(() => forfeitIfStillDisconnected(gameId, userId), RECONNECT_GRACE_MS);
  disconnectTimers.set(timerKey, timer);
}

export async function handleReconnect(gameId: string, userId: number, newSocketId: string): Promise<boolean> {
  const game = await getGame(gameId);
  if (!game || game.status !== 'active') return false;
  const player = game.players.find((p) => p.userId === userId);
  if (!player) return false;

  player.socketId = newSocketId;
  player.disconnectedAt = undefined;
  await saveGame(game);

  const timerKey = `${gameId}:${userId}`;
  const timer = disconnectTimers.get(timerKey);
  if (timer) {
    clearTimeout(timer);
    disconnectTimers.delete(timerKey);
  }
  return true;
}

async function forfeitIfStillDisconnected(gameId: string, userId: number): Promise<void> {
  const timerKey = `${gameId}:${userId}`;
  disconnectTimers.delete(timerKey);
  const game = await getGame(gameId);
  if (!game || game.status !== 'active') return;
  const player = game.players.find((p) => p.userId === userId);
  if (!player?.disconnectedAt) return;

  const opponent = game.players.find((p) => p.userId !== userId)!;
  const timer = activeTimers.get(gameId);
  if (timer) clearTimeout(timer);

  game.status = 'finished';
  await saveGame(game);

  getIO().to(gameId).emit('game_over', {
    scores: game.players.map((p) => ({ userId: p.userId, score: p.score })),
    winnerId: opponent.userId,
    forfeited: true,
  });

  await recordMatchResult({
    category: game.category,
    player1Id: game.players[0].userId,
    player2Id: game.players[1].userId,
    player1Score: game.players[0].score,
    player2Score: game.players[1].score,
    winnerId: opponent.userId,
  });

  await deleteGame(gameId);
}
```

- [ ] **Step 4: Wire disconnect/reconnect into `socketServer.ts`**

In `backend/src/socket/socketServer.ts`, add this import:

```typescript
import { handleDisconnect, handleReconnect } from '../game/gameEngine';
import { getGame } from '../game/gameState';
```

Replace the existing `socket.on('disconnect', ...)` handler with:

```typescript
    socket.on('disconnect', () => {
      if (activeSocketsByUser.get(userId) === socket.id) {
        activeSocketsByUser.delete(userId);
      }
      const gameId = socket.data.gameId as string | undefined;
      if (gameId) {
        void handleDisconnect(gameId, userId);
      }
    });
```

And add a new handler for reconnection:

```typescript
    socket.on('reconnect_game', async ({ gameId }: { gameId: string }, ack: (state: unknown) => void) => {
      const reconnected = await handleReconnect(gameId, userId, socket.id);
      if (!reconnected) {
        ack({ found: false });
        return;
      }
      socket.join(gameId);
      socket.data.gameId = gameId;
      const game = await getGame(gameId);
      ack({
        found: true,
        currentQuestionIndex: game!.currentQuestionIndex,
        scores: game!.players.map((p) => ({ userId: p.userId, score: p.score })),
      });
    });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/game/gameEngineDisconnect.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/src/game/gameEngine.ts backend/src/socket/socketServer.ts backend/tests/game/gameEngineDisconnect.test.ts
git commit -m "feat: forfeit disconnected players after a reconnect grace period"
```

---

## Task 19: Reyting jadvali (leaderboardRepository + routes)

**Files:**
- Create: `backend/src/leaderboard/leaderboardRepository.ts`
- Create: `backend/src/leaderboard/leaderboardRoutes.ts`
- Test: `backend/tests/leaderboard/leaderboardRepository.test.ts`
- Test: `backend/tests/leaderboard/leaderboardRoutes.test.ts`

- [ ] **Step 1: Write the failing repository test**

```typescript
// backend/tests/leaderboard/leaderboardRepository.test.ts
import { pool } from '../../src/config/db';
import { upsertUser } from '../../src/users/userRepository';
import { getGlobalLeaderboard, getFriendsLeaderboard } from '../../src/leaderboard/leaderboardRepository';

describe('leaderboardRepository', () => {
  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id IN (8001, 8002, 8003, 8004)`);
    await pool.end();
  });

  it('orders the global leaderboard by rating descending', async () => {
    await upsertUser(8001, 'low', 'Low', null);
    await pool.query(`UPDATE users SET rating = 900 WHERE telegram_id = 8001`);
    await upsertUser(8002, 'high', 'High', null);
    await pool.query(`UPDATE users SET rating = 1500 WHERE telegram_id = 8002`);

    const board = await getGlobalLeaderboard(10);
    const positions = board.map((e) => e.telegramId);
    expect(positions.indexOf(8002)).toBeLessThan(positions.indexOf(8001));
  });

  it('includes only the inviter and invitees in the friends leaderboard', async () => {
    await upsertUser(8003, 'inviter', 'Inviter', null);
    await upsertUser(8004, 'invitee', 'Invitee', 8003);

    const board = await getFriendsLeaderboard(8003);
    const ids = board.map((e) => e.telegramId).sort();
    expect(ids).toEqual([8003, 8004]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/leaderboard/leaderboardRepository.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `leaderboardRepository.ts`**

```typescript
// backend/src/leaderboard/leaderboardRepository.ts
import { pool } from '../config/db';

export interface LeaderboardEntry {
  telegramId: number;
  firstName: string;
  username: string | null;
  rating: number;
  gamesWon: number;
}

function mapRow(row: any): LeaderboardEntry {
  return {
    telegramId: Number(row.telegram_id),
    firstName: row.first_name,
    username: row.username,
    rating: row.rating,
    gamesWon: row.games_won,
  };
}

export async function getGlobalLeaderboard(limit = 100): Promise<LeaderboardEntry[]> {
  const result = await pool.query(
    `SELECT telegram_id, first_name, username, rating, games_won
     FROM users
     WHERE telegram_id != 0
     ORDER BY rating DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows.map(mapRow);
}

// "Friends" leaderboard = the referral circle: people the user invited, plus
// whoever invited the user. Telegram Mini Apps cannot read a user's real
// contacts list, so referral relationships are the closest available proxy.
export async function getFriendsLeaderboard(telegramId: number): Promise<LeaderboardEntry[]> {
  const result = await pool.query(
    `SELECT telegram_id, first_name, username, rating, games_won
     FROM users
     WHERE telegram_id != 0
       AND (
         telegram_id = $1
         OR invited_by_telegram_id = $1
         OR telegram_id = (SELECT invited_by_telegram_id FROM users WHERE telegram_id = $1)
       )
     ORDER BY rating DESC`,
    [telegramId]
  );
  return result.rows.map(mapRow);
}
```

- [ ] **Step 4: Run repository test to verify it passes**

Run: `npx jest tests/leaderboard/leaderboardRepository.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing routes test**

```typescript
// backend/tests/leaderboard/leaderboardRoutes.test.ts
import express from 'express';
import request from 'supertest';
import { pool } from '../../src/config/db';
import { upsertUser } from '../../src/users/userRepository';
import { signSession } from '../../src/auth/jwt';
import { leaderboardRouter } from '../../src/leaderboard/leaderboardRoutes';

describe('GET /api/leaderboard', () => {
  const app = express();
  app.use('/api', leaderboardRouter);

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id IN (8101, 8102)`);
    await pool.end();
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/leaderboard/global');
    expect(res.status).toBe(401);
  });

  it('returns the global leaderboard for an authenticated user', async () => {
    const user = await upsertUser(8101, 'gplayer', 'GPlayer', null);
    const token = signSession({ userId: user.id, telegramId: user.telegramId });

    const res = await request(app).get('/api/leaderboard/global').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.leaderboard)).toBe(true);
  });

  it('returns the friends leaderboard for an authenticated user', async () => {
    const inviter = await upsertUser(8102, 'inv', 'Inv', null);
    const token = signSession({ userId: inviter.id, telegramId: inviter.telegramId });

    const res = await request(app).get('/api/leaderboard/friends').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.leaderboard.some((e: { telegramId: number }) => e.telegramId === 8102)).toBe(true);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx jest tests/leaderboard/leaderboardRoutes.test.ts`
Expected: FAIL — module not found

- [ ] **Step 7: Implement `leaderboardRoutes.ts`**

```typescript
// backend/src/leaderboard/leaderboardRoutes.ts
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
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx jest tests/leaderboard/leaderboardRoutes.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 9: Commit**

```bash
git add backend/src/leaderboard backend/tests/leaderboard
git commit -m "feat: add global and friends-circle leaderboard endpoints"
```

---

## Task 20: Statistika endpoint (statsRoutes)

**Files:**
- Create: `backend/src/stats/statsRoutes.ts`
- Test: `backend/tests/stats/statsRoutes.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/tests/stats/statsRoutes.test.ts
import express from 'express';
import request from 'supertest';
import { pool } from '../../src/config/db';
import { upsertUser, recordMatchResult } from '../../src/users/userRepository';
import { signSession } from '../../src/auth/jwt';
import { statsRouter } from '../../src/stats/statsRoutes';

describe('GET /api/stats/me', () => {
  const app = express();
  app.use('/api', statsRouter);

  afterAll(async () => {
    await pool.query(`DELETE FROM matches WHERE player1_id IN (SELECT id FROM users WHERE telegram_id IN (8201, 8202))`);
    await pool.query(`DELETE FROM users WHERE telegram_id IN (8201, 8202)`);
    await pool.end();
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/stats/me');
    expect(res.status).toBe(401);
  });

  it('returns computed stats including win rate', async () => {
    const winner = await upsertUser(8201, 'w', 'W', null);
    const loser = await upsertUser(8202, 'l', 'L', null);
    await recordMatchResult({
      category: 'umumiy_bilim',
      player1Id: winner.id,
      player2Id: loser.id,
      player1Score: 500,
      player2Score: 100,
      winnerId: winner.id,
    });

    const token = signSession({ userId: winner.id, telegramId: winner.telegramId });
    const res = await request(app).get('/api/stats/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.gamesPlayed).toBe(1);
    expect(res.body.gamesWon).toBe(1);
    expect(res.body.winRate).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/stats/statsRoutes.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `statsRoutes.ts`**

```typescript
// backend/src/stats/statsRoutes.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/stats/statsRoutes.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/stats/statsRoutes.ts backend/tests/stats/statsRoutes.test.ts
git commit -m "feat: add user stats endpoint"
```

---

## Task 21: Do'stni taklif qilish (invite flow)

**Files:**
- Create: `backend/src/invite/inviteRoom.ts`
- Modify: `backend/src/socket/socketServer.ts` (add `create_invite`/`join_invite` handlers)
- Test: `backend/tests/invite/inviteRoom.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/tests/invite/inviteRoom.test.ts
import { redis } from '../../src/config/redis';
import { createInvite, consumeInvite } from '../../src/invite/inviteRoom';

describe('inviteRoom', () => {
  afterAll(async () => {
    await redis.quit();
  });

  it('returns null when no invite exists for the inviter', async () => {
    const result = await consumeInvite(999999);
    expect(result).toBeNull();
  });

  it('creates and consumes an invite exactly once', async () => {
    await createInvite(12345, { category: 'umumiy_bilim', socketId: 'sockA', userId: 1 });

    const first = await consumeInvite(12345);
    expect(first).toEqual({ category: 'umumiy_bilim', socketId: 'sockA', userId: 1 });

    const second = await consumeInvite(12345);
    expect(second).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/invite/inviteRoom.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `inviteRoom.ts`**

```typescript
// backend/src/invite/inviteRoom.ts
import { redis } from '../config/redis';

export interface PendingInvite {
  category: string;
  socketId: string;
  userId: number;
}

const INVITE_TTL_SECONDS = 5 * 60;

function inviteKey(inviterTelegramId: number): string {
  return `invite:${inviterTelegramId}`;
}

export async function createInvite(inviterTelegramId: number, invite: PendingInvite): Promise<void> {
  await redis.set(inviteKey(inviterTelegramId), JSON.stringify(invite), 'EX', INVITE_TTL_SECONDS);
}

export async function consumeInvite(inviterTelegramId: number): Promise<PendingInvite | null> {
  const key = inviteKey(inviterTelegramId);
  const raw = await redis.get(key);
  if (!raw) return null;
  await redis.del(key);
  return JSON.parse(raw);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/invite/inviteRoom.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire invite handlers into `socketServer.ts`**

In `backend/src/socket/socketServer.ts`, add these imports:

```typescript
import { createInvite, consumeInvite } from '../invite/inviteRoom';
import { createMatch } from '../matchmaking/matchmaker';
import { isValidCategory } from '../questions/questionRepository';
```

And add these two handlers inside the connection block:

```typescript
    socket.on('create_invite', async ({ category }: { category: string }) => {
      if (!isValidCategory(category)) return;
      const telegramId = socket.data.telegramId as number;
      await createInvite(telegramId, { category, socketId: socket.id, userId });
      socket.emit('invite_created');
    });

    socket.on('join_invite', async ({ inviterTelegramId, category }: { inviterTelegramId: number; category: string }) => {
      if (!isValidCategory(category)) return;
      const invite = await consumeInvite(inviterTelegramId);
      if (!invite) {
        socket.emit('invite_expired');
        return;
      }
      await createMatch(
        io as Server,
        invite.category,
        { userId: invite.userId, socketId: invite.socketId },
        { userId, socketId: socket.id }
      );
    });
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/invite backend/src/socket/socketServer.ts backend/tests/invite
git commit -m "feat: add direct friend-invite matching"
```

---

## Task 22: Telegram Bot (/start handler)

**Files:**
- Create: `backend/src/bot/telegramBot.ts`

- [ ] **Step 1: Implement the bot**

```typescript
// backend/src/bot/telegramBot.ts
import TelegramBot from 'node-telegram-bot-api';
import { env } from '../config/env';

const WEBAPP_URL = process.env.WEBAPP_URL ?? 'https://example.com';

export function startTelegramBot(): TelegramBot {
  const bot = new TelegramBot(env.telegramBotToken, { polling: true });

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "BilimBattle'ga xush kelibsiz! O'yinni boshlash uchun tugmani bosing.", {
      reply_markup: {
        inline_keyboard: [[{ text: "O'yinni ochish", web_app: { url: WEBAPP_URL } }]],
      },
    });
  });

  return bot;
}
```

- [ ] **Step 2: Manually verify against a real Telegram bot**

This is a thin wrapper around `node-telegram-bot-api` (already well-tested by its own maintainers), so it is verified manually rather than with an automated test:
1. Set a real bot token (from @BotFather) in `.env` as `TELEGRAM_BOT_TOKEN`.
2. Run `npx ts-node -e "require('./src/bot/telegramBot').startTelegramBot()"`.
3. Open the bot in Telegram and send `/start`.
4. Expected: the bot replies with a message containing an "O'yinni ochish" button.

- [ ] **Step 3: Commit**

```bash
git add backend/src/bot/telegramBot.ts
git commit -m "feat: add Telegram bot /start handler"
```

---

## Task 23: Ilovani yig'ish (app.ts, server.ts)

**Files:**
- Create: `backend/src/app.ts`
- Create: `backend/src/server.ts`

- [ ] **Step 1: Implement `app.ts`**

```typescript
// backend/src/app.ts
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
```

- [ ] **Step 2: Implement `server.ts`**

```typescript
// backend/src/server.ts
import { createServer } from 'http';
import { createApp } from './app';
import { initSocketServer } from './socket/socketServer';
import { startTelegramBot } from './bot/telegramBot';
import { env } from './config/env';

const app = createApp();
const httpServer = createServer(app);
initSocketServer(httpServer);
startTelegramBot();

httpServer.listen(env.port, () => {
  console.log(`BilimBattle backend ${env.port}-portda ishga tushdi`);
});
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all test suites pass.

- [ ] **Step 4: Manually smoke-test the running server**

Run: `npm run dev`
Expected: console prints `BilimBattle backend 3000-portda ishga tushdi`. Then in another terminal:
```bash
curl http://localhost:3000/api/categories
```
Expected: JSON with the two categories.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app.ts backend/src/server.ts
git commit -m "feat: assemble Express app and bootstrap server"
```

---

## Task 24: Yuklama testi skripti (load test)

**Files:**
- Create: `backend/scripts/loadTest.ts`

- [ ] **Step 1: Implement the load-test script**

```typescript
// backend/scripts/loadTest.ts
import { io as ioClient } from 'socket.io-client';
import { signSession } from '../src/auth/jwt';

const SERVER_URL = process.env.LOAD_TEST_SERVER_URL ?? 'http://localhost:3000';
const CLIENT_COUNT = Number(process.env.LOAD_TEST_CLIENTS ?? 200);

async function runLoadTest(): Promise<void> {
  let matchedCount = 0;
  let errorCount = 0;
  const startedAt = Date.now();

  const clients = Array.from({ length: CLIENT_COUNT }, (_, i) => {
    const token = signSession({ userId: 1_000_000 + i, telegramId: 1_000_000 + i });
    const socket = ioClient(SERVER_URL, { auth: { token } });

    socket.on('connect', () => {
      socket.emit('join_queue', { category: 'umumiy_bilim' });
    });

    socket.on('match_found', () => {
      matchedCount += 1;
      socket.close();
    });

    socket.on('connect_error', () => {
      errorCount += 1;
    });

    return socket;
  });

  await new Promise((resolve) => setTimeout(resolve, 20_000));

  const durationMs = Date.now() - startedAt;
  console.log(`Ulanishlar: ${CLIENT_COUNT}`);
  console.log(`Bellashuvga tushganlar: ${matchedCount}`);
  console.log(`Xatoliklar: ${errorCount}`);
  console.log(`Davomiylik: ${durationMs}ms`);

  clients.forEach((c) => c.close());
  process.exit(0);
}

runLoadTest();
```

- [ ] **Step 2: Run the load test against a locally running server**

In one terminal: `npm run dev`
In another terminal: `LOAD_TEST_CLIENTS=200 npm run loadtest`
Expected: a report printing ~200 connections and close to 100 matched pairs (each match consumes 2 clients). Note any failures — this is a manual pre-launch check, not part of `npm test`, since 500-1000 concurrent connections need to be run deliberately against a server sized for that load rather than on every commit.

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/loadTest.ts
git commit -m "feat: add manual Socket.io load-test script"
```

---

## Self-Review Notes

- **Spec coverage:** architecture (Tasks 1-3), auth (7-11), matchmaking + real-time battle (12-18), leaderboard (19), stats (20), friend invite (21), bot (22), assembly (23), load testing (24). All spec sections 3-8 map to at least one task.
- **Resolved ambiguity:** the "friends leaderboard" is implemented as a referral circle (see the note under Task 19 and the plan header) since Telegram Mini Apps have no access to a user's real contacts.
- **Type consistency checked:** `PlayerState`/`GameState` (Task 12) are reused unchanged by `gameEngine.ts` (Tasks 16, 18), `matchmaker.ts` (Task 17), and `socketServer.ts` — field names (`isBot`, `disconnectedAt`, `answers`) match everywhere they're referenced.
- **No placeholders:** every step above contains complete, runnable code — no TBDs or "add appropriate handling" steps.
