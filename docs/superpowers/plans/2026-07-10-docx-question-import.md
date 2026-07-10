# Word (.docx) Quiz Question Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin import quiz questions from a `.docx` file (using a `?`/`+`/`=` line-marker format) directly through the Admin panel, and let categories be created dynamically instead of living in a hardcoded array.

**Architecture:** Categories move from a hardcoded TS array to a `categories` DB table. A pure-function parser turns plain text (already extracted from the `.docx` via `mammoth`) into validated question blocks, with per-block errors that don't take down the rest of the file. A new admin-gated `POST /api/admin/questions/import` route wires multer (file upload) + mammoth (docx → text) + the parser + the DB together. The frontend adds a small upload form to the existing `AdminScreen`.

**Tech Stack:** Node/Express/Postgres (backend, Jest + real Postgres), React/TS (frontend, Vitest + RTL), `mammoth` (docx → text), `multer` (multipart file upload).

**Reference spec:** `docs/superpowers/specs/2026-07-10-docx-question-import-design.md`

---

## Before You Start

This plan touches a real Postgres database in tests (matching this project's existing convention — see `backend/tests/questions/questionRepository.test.ts`). Make sure `backend/.env` has a working `DATABASE_URL`, and that migrations are up to date:

```bash
cd backend
npm run migrate
```

Every task below that adds test rows to `categories` or `questions` cleans them up in `afterEach`/`afterAll` — don't skip those cleanup steps, since other test files in this suite run against the same real database and assert on its exact contents (e.g. `backend/tests/questions/questionsRoutes.test.ts`).

---

### Task 1: Categories move from a hardcoded array to a DB table

**Files:**
- Modify: `backend/src/db/schema.sql`
- Modify: `backend/src/questions/questionRepository.ts`
- Modify: `backend/src/questions/questionsRoutes.ts`
- Modify: `backend/tests/questions/questionRepository.test.ts`
- Modify: `backend/tests/questions/questionsRoutes.test.ts`

- [ ] **Step 1: Add the `categories` table to the schema**

Add this to `backend/src/db/schema.sql`, right after the `questions` table definition:

```sql
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL
);

INSERT INTO categories (key, label) VALUES
  ('umumiy_bilim', 'Umumiy bilim'),
  ('sport_kino_musiqa', 'Sport/Kino/Musiqa')
ON CONFLICT (key) DO NOTHING;
```

The `id SERIAL` column exists purely so `getCategories()` (Step 3) can return categories in a stable, predictable order (insertion order) — `questions.category` and `matches.category` stay plain `TEXT` columns, unrelated to this table's primary key.

- [ ] **Step 2: Apply the migration**

Run: `cd backend && npm run migrate`
Expected: `Migration applied successfully.` (creates `categories` if it doesn't exist yet, and the two `INSERT ... ON CONFLICT DO NOTHING` rows are seeded exactly once — safe to re-run).

- [ ] **Step 3: Write the failing tests for the new repository functions**

Replace the full contents of `backend/tests/questions/questionRepository.test.ts` with:

```ts
import { pool } from '../../src/config/db';
import {
  getRandomQuestions,
  isValidCategory,
  getCategories,
  getCategoryByKey,
  createCategory,
  insertQuestions,
} from '../../src/questions/questionRepository';

describe('questionRepository', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('recognizes valid and invalid categories', async () => {
    expect(await isValidCategory('umumiy_bilim')).toBe(true);
    expect(await isValidCategory('notogri_kategoriya')).toBe(false);
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

  describe('getCategories / getCategoryByKey', () => {
    it('lists the seeded categories', async () => {
      const categories = await getCategories();
      expect(categories).toEqual(
        expect.arrayContaining([
          { key: 'umumiy_bilim', label: 'Umumiy bilim' },
          { key: 'sport_kino_musiqa', label: 'Sport/Kino/Musiqa' },
        ])
      );
    });

    it('returns null for a key that does not exist', async () => {
      expect(await getCategoryByKey('test_repo_notreal')).toBeNull();
    });
  });

  describe('createCategory', () => {
    afterEach(async () => {
      await pool.query(`DELETE FROM categories WHERE key LIKE 'test_repo_%'`);
    });

    it('creates a new category with a slugified key', async () => {
      const category = await createCategory('Test Repo Tarix');
      expect(category).toEqual({ key: 'test_repo_tarix', label: 'Test Repo Tarix' });
      expect(await isValidCategory('test_repo_tarix')).toBe(true);
    });

    it('reuses an existing category when the label matches case-insensitively', async () => {
      const first = await createCategory('Test Repo Geografiya');
      const second = await createCategory('test repo geografiya');
      expect(second).toEqual(first);

      const all = await getCategories();
      expect(all.filter((c) => c.key === first.key).length).toBe(1);
    });
  });

  describe('insertQuestions', () => {
    afterEach(async () => {
      await pool.query(`DELETE FROM questions WHERE question_text LIKE 'TEST_REPO_%'`);
    });

    it('inserts each question into the given category', async () => {
      await insertQuestions('umumiy_bilim', [
        { text: 'TEST_REPO_Savol?', options: ['A', 'B'], correctIndex: 1 },
      ]);

      const stored = await pool.query(
        `SELECT category, question_text, options, correct_index FROM questions WHERE question_text = 'TEST_REPO_Savol?'`
      );
      expect(stored.rows.length).toBe(1);
      expect(stored.rows[0].category).toBe('umumiy_bilim');
      expect(stored.rows[0].options).toEqual(['A', 'B']);
      expect(stored.rows[0].correct_index).toBe(1);
    });
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd backend && npx jest tests/questions/questionRepository.test.ts`
Expected: FAIL — `getCategories`, `getCategoryByKey`, `createCategory`, `insertQuestions` are not exported yet, and `isValidCategory('umumiy_bilim')` currently returns a plain `boolean` (not awaited, but the assertion itself would still technically pass — the failures come from the missing exports, which is a TypeScript compile error under `ts-jest`).

- [ ] **Step 5: Rewrite `questionRepository.ts`**

Replace the full contents of `backend/src/questions/questionRepository.ts` with:

```ts
import { pool } from '../config/db';

// Full server-side record, includes the correct answer — must not be sent to
// players as-is; any client-facing payload must strip `correctIndex` first.
export interface QuestionRecord {
  id: number;
  text: string;
  options: string[];
  correctIndex: number;
}

export interface Category {
  key: string;
  label: string;
}

export interface NewQuestion {
  text: string;
  options: string[];
  correctIndex: number;
}

export async function getCategories(): Promise<Category[]> {
  const result = await pool.query<{ key: string; label: string }>(
    `SELECT key, label FROM categories ORDER BY id ASC`
  );
  return result.rows;
}

export async function getCategoryByKey(key: string): Promise<Category | null> {
  const result = await pool.query<{ key: string; label: string }>(
    `SELECT key, label FROM categories WHERE key = $1`,
    [key]
  );
  return result.rows[0] ?? null;
}

export async function isValidCategory(key: string): Promise<boolean> {
  return (await getCategoryByKey(key)) !== null;
}

function slugifyCategoryLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Reuses an existing category if one already has this exact label
// (case-insensitive) rather than creating a visually-duplicate turkum -
// re-uploading a file for "Tarix" shouldn't end up with two different
// "Tarix" entries just because of a typo-free re-type.
export async function createCategory(label: string): Promise<Category> {
  const existing = await pool.query<{ key: string; label: string }>(
    `SELECT key, label FROM categories WHERE LOWER(label) = LOWER($1)`,
    [label]
  );
  if (existing.rows[0]) return existing.rows[0];

  const baseKey = slugifyCategoryLabel(label);
  let key = baseKey;
  let suffix = 2;
  // Only reachable if a DIFFERENT label happens to slugify to the same key
  // as an existing category (the same-label case is already handled above).
  while (await isValidCategory(key)) {
    key = `${baseKey}_${suffix}`;
    suffix += 1;
  }

  await pool.query(`INSERT INTO categories (key, label) VALUES ($1, $2)`, [key, label]);
  return { key, label };
}

export async function insertQuestions(category: string, questions: NewQuestion[]): Promise<void> {
  for (const q of questions) {
    await pool.query(
      `INSERT INTO questions (category, question_text, options, correct_index) VALUES ($1, $2, $3, $4)`,
      [category, q.text, JSON.stringify(q.options), q.correctIndex]
    );
  }
}

export async function getRandomQuestions(category: string, count: number): Promise<QuestionRecord[]> {
  const result = await pool.query<{
    id: number;
    question_text: string;
    options: string[];
    correct_index: number;
  }>(
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

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/questions/questionRepository.test.ts`
Expected: PASS (all tests green)

- [ ] **Step 7: Update the failing route test**

Replace the full contents of `backend/tests/questions/questionsRoutes.test.ts` with:

```ts
import express from 'express';
import request from 'supertest';
import { questionsRouter } from '../../src/questions/questionsRoutes';

describe('GET /api/categories', () => {
  const app = express();
  app.use('/api', questionsRouter);

  it('returns the list of categories, including the two seeded defaults', async () => {
    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(200);
    expect(res.body.categories).toEqual(
      expect.arrayContaining([
        { key: 'umumiy_bilim', label: 'Umumiy bilim' },
        { key: 'sport_kino_musiqa', label: 'Sport/Kino/Musiqa' },
      ])
    );
  });
});
```

(This changes the assertion from an exact-array `toEqual` to `arrayContaining`, since the categories table is no longer a fixed, unchanging list once Task 4's import endpoint can add rows to it — a test running concurrently in another file could otherwise make this test flaky.)

- [ ] **Step 8: Update `questionsRoutes.ts` to read from the DB**

Replace the full contents of `backend/src/questions/questionsRoutes.ts` with:

```ts
import { Router } from 'express';
import { getCategories } from './questionRepository';

export const questionsRouter = Router();

questionsRouter.get('/categories', async (_req, res) => {
  const categories = await getCategories();
  res.json({ categories });
});
```

- [ ] **Step 9: Run both test files to verify they pass**

Run: `cd backend && npx jest tests/questions/`
Expected: PASS (all tests green)

- [ ] **Step 10: Commit**

```bash
cd backend
git add src/db/schema.sql src/questions/questionRepository.ts src/questions/questionsRoutes.ts tests/questions/questionRepository.test.ts tests/questions/questionsRoutes.test.ts
git commit -m "Move quiz categories from a hardcoded array to a DB table"
```

---

### Task 2: Update category-check call sites for the now-async `isValidCategory`

**Files:**
- Modify: `backend/src/matchmaking/matchmaker.ts:69`
- Modify: `backend/src/socket/socketServer.ts:104-170`

`isValidCategory` now returns `Promise<boolean>` instead of `boolean` (Task 1). This task updates its three call sites accordingly. No new tests are added here — the existing test suites for these files (`backend/tests/matchmaking/*.test.ts`, `backend/tests/integration/socketServer.test.ts`, `backend/tests/game/*.test.ts`) already exercise this code end-to-end against the real categories table seeded in Task 1, so they double as the regression check for this task.

- [ ] **Step 1: Update `matchmaker.ts`**

In `backend/src/matchmaking/matchmaker.ts`, `handleJoinQueue` currently starts with:

```ts
export async function handleJoinQueue(io: AppServer, socketId: string, userId: number, category: string): Promise<void> {
  if (!isValidCategory(category)) return;
```

Change the guard line to:

```ts
export async function handleJoinQueue(io: AppServer, socketId: string, userId: number, category: string): Promise<void> {
  if (!(await isValidCategory(category))) return;
```

- [ ] **Step 2: Update `socketServer.ts`'s `create_invite` handler**

In `backend/src/socket/socketServer.ts`, replace the entire `create_invite` handler (currently around lines 98-117):

```ts
    // Fire-and-forget from Node's perspective: Socket.io invokes this async
    // handler but never awaits or catches its returned promise (that only
    // happens for emits that use an ack callback, which this event doesn't).
    // An unhandled rejection here (e.g. Redis blip inside createInvite) would
    // otherwise crash the process, same hazard already noted on the
    // 'disconnect' handler below - so this is wrapped in .catch() too.
    socket.on('create_invite', ({ category }: { category: string }) => {
      if (!isValidCategory(category)) return;
      // Refuse to create an invite while this socket is already in an active
      // game - otherwise a stray create_invite mid-match would let a friend
      // later join_invite and double-book this user into a second match on
      // top of the one they're already playing.
      if (socket.data.gameId) return;
      const telegramId = socket.data.telegramId;
      createInvite(telegramId, { category, socketId: socket.id, userId: socket.data.userId })
        .then(() => socket.emit('invite_created'))
        .catch((err) => {
          console.error(`socketServer: failed to create invite for telegramId ${telegramId}`, err);
        });
    });
```

with:

```ts
    // Fire-and-forget from Node's perspective: Socket.io invokes this async
    // handler but never awaits or catches its returned promise (that only
    // happens for emits that use an ack callback, which this event doesn't).
    // An unhandled rejection here (e.g. Redis blip inside createInvite, or
    // the isValidCategory query below) would otherwise crash the process,
    // same hazard already noted on the 'disconnect' handler below - so the
    // whole body is wrapped in try/catch.
    socket.on('create_invite', async ({ category }: { category: string }) => {
      try {
        if (!(await isValidCategory(category))) return;
        // Refuse to create an invite while this socket is already in an
        // active game - otherwise a stray create_invite mid-match would let
        // a friend later join_invite and double-book this user into a
        // second match on top of the one they're already playing.
        if (socket.data.gameId) return;
        const telegramId = socket.data.telegramId;
        await createInvite(telegramId, { category, socketId: socket.id, userId: socket.data.userId });
        socket.emit('invite_created');
      } catch (err) {
        console.error(`socketServer: failed to create invite for telegramId ${socket.data.telegramId}`, err);
      }
    });
```

- [ ] **Step 3: Update `socketServer.ts`'s `join_invite` handler**

Replace the entire `join_invite` handler (currently around lines 119-170):

```ts
    // Same fire-and-forget hazard as create_invite above - wrapped in .catch().
    // Note: the invitee's own `category` here is intentionally NOT forwarded
    // to createMatch. The match is played in the category the INVITER
    // originally queued for (invite.category, stored server-side when the
    // invite was created) - the invitee joining via a deep link doesn't get
    // to silently redirect the match to a different category. We still
    // validate the invitee's category so a malformed/garbage payload is
    // rejected up front, but it otherwise carries no weight in this handler.
    socket.on('join_invite', ({ inviterTelegramId, category }: { inviterTelegramId: number; category: string }) => {
      // inviterTelegramId comes straight from client input, unlike category
      // which is checked by isValidCategory below - without this guard a
      // malformed payload (string, NaN, object) would silently build a
      // harmless-but-wrong Redis key via inviteKey() instead of being
      // rejected cleanly up front.
      if (typeof inviterTelegramId !== 'number' || !Number.isFinite(inviterTelegramId)) return;
      if (!isValidCategory(category)) return;
      // Refuse to consume the invite if THIS socket (the invitee) is already
      // mid-match - see the matching comment on create_invite above for why.
      if (socket.data.gameId) return;

      consumeInvite(inviterTelegramId)
        .then(async (invite) => {
          if (!invite) {
            socket.emit('invite_expired');
            return;
          }

          // Look up the inviter's CURRENT live socket via activeSocketsByUser
          // rather than trusting invite.socketId, which is a snapshot taken
          // when create_invite ran and can go stale (inviter reconnected,
          // got a new socket id, or - the case this guard exists for -
          // started or finished an unrelated match since then). Using the
          // stale id for the "already in a match" check would miss exactly
          // the double-booking scenario it's meant to catch.
          const inviterCurrentSocketId = activeSocketsByUser.get(invite.userId);
          const inviterSocket = inviterCurrentSocketId ? io!.sockets.sockets.get(inviterCurrentSocketId) : undefined;
          if (inviterSocket?.data.gameId) {
            socket.emit('invite_expired');
            return;
          }

          await createMatch(
            io!,
            invite.category,
            { userId: invite.userId, socketId: inviterSocket?.id ?? invite.socketId },
            { userId: socket.data.userId, socketId: socket.id }
          );
        })
        .catch((err) => {
          console.error(`socketServer: failed to join invite from inviterTelegramId ${inviterTelegramId}`, err);
        });
    });
```

with:

```ts
    // Same fire-and-forget hazard as create_invite above - wrapped in
    // try/catch since isValidCategory now also awaits a DB query.
    // Note: the invitee's own `category` here is intentionally NOT forwarded
    // to createMatch. The match is played in the category the INVITER
    // originally queued for (invite.category, stored server-side when the
    // invite was created) - the invitee joining via a deep link doesn't get
    // to silently redirect the match to a different category. We still
    // validate the invitee's category so a malformed/garbage payload is
    // rejected up front, but it otherwise carries no weight in this handler.
    socket.on('join_invite', async ({ inviterTelegramId, category }: { inviterTelegramId: number; category: string }) => {
      try {
        // inviterTelegramId comes straight from client input, unlike
        // category which is checked by isValidCategory below - without this
        // guard a malformed payload (string, NaN, object) would silently
        // build a harmless-but-wrong Redis key via inviteKey() instead of
        // being rejected cleanly up front.
        if (typeof inviterTelegramId !== 'number' || !Number.isFinite(inviterTelegramId)) return;
        if (!(await isValidCategory(category))) return;
        // Refuse to consume the invite if THIS socket (the invitee) is
        // already mid-match - see the matching comment on create_invite
        // above for why.
        if (socket.data.gameId) return;

        const invite = await consumeInvite(inviterTelegramId);
        if (!invite) {
          socket.emit('invite_expired');
          return;
        }

        // Look up the inviter's CURRENT live socket via activeSocketsByUser
        // rather than trusting invite.socketId, which is a snapshot taken
        // when create_invite ran and can go stale (inviter reconnected, got
        // a new socket id, or - the case this guard exists for - started or
        // finished an unrelated match since then). Using the stale id for
        // the "already in a match" check would miss exactly the
        // double-booking scenario it's meant to catch.
        const inviterCurrentSocketId = activeSocketsByUser.get(invite.userId);
        const inviterSocket = inviterCurrentSocketId ? io!.sockets.sockets.get(inviterCurrentSocketId) : undefined;
        if (inviterSocket?.data.gameId) {
          socket.emit('invite_expired');
          return;
        }

        await createMatch(
          io!,
          invite.category,
          { userId: invite.userId, socketId: inviterSocket?.id ?? invite.socketId },
          { userId: socket.data.userId, socketId: socket.id }
        );
      } catch (err) {
        console.error(`socketServer: failed to join invite from inviterTelegramId ${inviterTelegramId}`, err);
      }
    });
```

- [ ] **Step 4: Run the affected test suites to verify no regression**

Run: `cd backend && npx jest tests/matchmaking/ tests/integration/socketServer.test.ts tests/game/`
Expected: PASS (all tests green, same count as before this task)

- [ ] **Step 5: Commit**

```bash
cd backend
git add src/matchmaking/matchmaker.ts src/socket/socketServer.ts
git commit -m "Await the now-async isValidCategory at its three call sites"
```

---

### Task 3: `.docx` text parser (pure function)

**Files:**
- Create: `backend/src/questions/docxQuestionParser.ts`
- Test: `backend/tests/questions/docxQuestionParser.test.ts`

This is a pure function — it takes a plain string (already extracted from a `.docx` file) and returns parsed questions plus per-block errors. It has no dependency on `mammoth`, the database, or Express; that wiring happens in Task 4.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/questions/docxQuestionParser.test.ts`:

```ts
import { parseQuestionsText } from '../../src/questions/docxQuestionParser';

describe('parseQuestionsText', () => {
  it('parses a single valid question block', () => {
    const result = parseQuestionsText(
      ['? Dunyodagi eng katta okean qaysi?', '= Atlantika', '+ Tinch okeani', '= Hind okeani', '= Shimoliy Muz okeani'].join(
        '\n'
      )
    );
    expect(result.errors).toEqual([]);
    expect(result.questions).toEqual([
      {
        text: 'Dunyodagi eng katta okean qaysi?',
        options: ['Atlantika', 'Tinch okeani', 'Hind okeani', 'Shimoliy Muz okeani'],
        correctIndex: 1,
      },
    ]);
  });

  it('parses multiple question blocks separated by a blank line', () => {
    const result = parseQuestionsText(
      ["? Savol 1?", "+ To'g'ri 1", '= Xato 1', '', '? Savol 2?', "+ To'g'ri 2", '= Xato 2'].join('\n')
    );
    expect(result.errors).toEqual([]);
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].text).toBe('Savol 1?');
    expect(result.questions[1].text).toBe('Savol 2?');
  });

  it('reports an error for a question with no correct answer marked, without dropping other blocks', () => {
    const result = parseQuestionsText(
      ['? Savol 1?', '= Xato A', '= Xato B', '? Savol 2?', "+ To'g'ri", '= Xato'].join('\n')
    );
    expect(result.questions).toEqual([{ text: 'Savol 2?', options: ["To'g'ri", 'Xato'], correctIndex: 0 }]);
    expect(result.errors).toEqual([{ line: 1, message: "to'g'ri javob belgilanmagan" }]);
  });

  it('reports an error when a question has more than one correct answer marked', () => {
    const result = parseQuestionsText(['? Savol?', '+ Birinchi', '+ Ikkinchi', '= Xato'].join('\n'));
    expect(result.questions).toEqual([]);
    expect(result.errors).toEqual([{ line: 1, message: "bir nechta to'g'ri javob belgilangan" }]);
  });

  it('reports an error when a question has no wrong answers at all', () => {
    const result = parseQuestionsText(['? Savol?', "+ Yagona javob"].join('\n'));
    expect(result.questions).toEqual([]);
    expect(result.errors).toEqual([{ line: 1, message: "noto'g'ri javob yo'q" }]);
  });

  it('reports an error when the question text itself is empty', () => {
    const result = parseQuestionsText(['?', "+ To'g'ri", '= Xato'].join('\n'));
    expect(result.questions).toEqual([]);
    expect(result.errors).toEqual([{ line: 1, message: "savol matni bo'sh" }]);
  });

  it('trims leading/trailing whitespace on every line', () => {
    const result = parseQuestionsText(['  ? Savol?  ', "   + To'g'ri javob   ", '  = Xato javob  '].join('\n'));
    expect(result.questions).toEqual([{ text: 'Savol?', options: ["To'g'ri javob", 'Xato javob'], correctIndex: 0 }]);
  });

  it('ignores any text that appears before the first "?" line', () => {
    const result = parseQuestionsText(
      ['Bu preambula matni, savol emas.', '? Savol?', "+ To'g'ri", '= Xato'].join('\n')
    );
    expect(result.errors).toEqual([]);
    expect(result.questions).toHaveLength(1);
  });

  it('finalizes the last question block even with no trailing blank line at end of file', () => {
    const result = parseQuestionsText(['? Savol?', "+ To'g'ri", '= Xato'].join('\n'));
    expect(result.questions).toEqual([{ text: 'Savol?', options: ["To'g'ri", 'Xato'], correctIndex: 0 }]);
  });

  it('preserves the original document order of options, with correctIndex pointing at the "+"-marked one', () => {
    const result = parseQuestionsText(
      ['? Savol?', '= Birinchi (xato)', '= Ikkinchi (xato)', "+ Uchinchi (to'g'ri)", '= Tortinchi (xato)'].join('\n')
    );
    expect(result.questions[0].options).toEqual([
      'Birinchi (xato)',
      'Ikkinchi (xato)',
      "Uchinchi (to'g'ri)",
      'Tortinchi (xato)',
    ]);
    expect(result.questions[0].correctIndex).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest tests/questions/docxQuestionParser.test.ts`
Expected: FAIL with "Cannot find module '../../src/questions/docxQuestionParser'"

- [ ] **Step 3: Implement the parser**

Create `backend/src/questions/docxQuestionParser.ts`:

```ts
export interface ParsedQuestion {
  text: string;
  options: string[];
  correctIndex: number;
}

export interface ParseError {
  line: number;
  message: string;
}

export interface ParseResult {
  questions: ParsedQuestion[];
  errors: ParseError[];
}

interface RawEntry {
  isCorrect: boolean;
  text: string;
}

interface RawBlock {
  startLine: number;
  questionText: string | null;
  entries: RawEntry[];
}

// Parses the plain-text export of a .docx file authored with a simple line
// convention: "?" starts a new question, "+" marks its correct answer, "="
// marks a wrong answer. A bad block (missing/duplicate correct answer, no
// wrong answers, empty question text) is reported as an error keyed to its
// starting line - it does NOT take down the rest of the file.
export function parseQuestionsText(rawText: string): ParseResult {
  const lines = rawText.split(/\r\n|\r|\n/);
  const questions: ParsedQuestion[] = [];
  const errors: ParseError[] = [];
  let current: RawBlock | null = null;

  function finalizeCurrent(): void {
    if (!current) return;
    const block = current;
    current = null;

    if (!block.questionText) {
      errors.push({ line: block.startLine, message: "savol matni bo'sh" });
      return;
    }

    const correctEntries = block.entries.filter((e) => e.isCorrect);
    const wrongEntries = block.entries.filter((e) => !e.isCorrect);

    if (correctEntries.length === 0) {
      errors.push({ line: block.startLine, message: "to'g'ri javob belgilanmagan" });
      return;
    }
    if (correctEntries.length > 1) {
      errors.push({ line: block.startLine, message: "bir nechta to'g'ri javob belgilangan" });
      return;
    }
    if (wrongEntries.length === 0) {
      errors.push({ line: block.startLine, message: "noto'g'ri javob yo'q" });
      return;
    }

    questions.push({
      text: block.questionText,
      options: block.entries.map((e) => e.text),
      correctIndex: block.entries.findIndex((e) => e.isCorrect),
    });
  }

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (line === '') return;

    if (line.startsWith('?')) {
      finalizeCurrent();
      current = { startLine: lineNumber, questionText: line.slice(1).trim() || null, entries: [] };
      return;
    }

    if (!current) return; // Text before the first '?' line - ignored.

    if (line.startsWith('+')) {
      current.entries.push({ isCorrect: true, text: line.slice(1).trim() });
      return;
    }

    if (line.startsWith('=')) {
      current.entries.push({ isCorrect: false, text: line.slice(1).trim() });
      return;
    }

    // Any other line inside a block is ignored - it's not one of the three
    // recognized markers (?/+/=), so treating it as a parse error would be
    // too strict for a plain-text export out of Word (stray formatting
    // artifacts, empty bullet markers, etc).
  });

  finalizeCurrent();

  return { questions, errors };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/questions/docxQuestionParser.test.ts`
Expected: PASS (all tests green)

- [ ] **Step 5: Commit**

```bash
cd backend
git add src/questions/docxQuestionParser.ts tests/questions/docxQuestionParser.test.ts
git commit -m "Add a pure parser for the ?/+/= quiz question text format"
```

---

### Task 4: `POST /api/admin/questions/import` route

**Files:**
- Modify: `backend/package.json` (adds `mammoth`, `multer`, `@types/multer`)
- Modify: `backend/src/admin/adminApiRoutes.ts`
- Test: `backend/tests/admin/questionsImport.test.ts`

- [ ] **Step 1: Install the new dependencies**

Run:
```bash
cd backend
npm install mammoth@^1.12.0 multer@^2.2.0
npm install --save-dev @types/multer@^2.2.0
```
Expected: `package.json`/`package-lock.json` updated with the three new entries.

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/admin/questionsImport.test.ts`:

```ts
process.env.ADMIN_TELEGRAM_ID = '9999';

import express from 'express';
import request from 'supertest';
import { pool } from '../../src/config/db';
import { upsertUser } from '../../src/users/userRepository';
import { signSession } from '../../src/auth/jwt';
import { adminApiRouter } from '../../src/admin/adminApiRoutes';

jest.mock('mammoth', () => ({
  extractRawText: jest.fn(),
}));
import mammoth from 'mammoth';

function mockDocxText(text: string): void {
  (mammoth.extractRawText as jest.Mock).mockResolvedValue({ value: text, messages: [] });
}

describe('POST /api/admin/questions/import', () => {
  const app = express();
  app.use('/api', adminApiRouter);

  let adminToken: string;

  beforeAll(async () => {
    const admin = await upsertUser(9999, 'admin', 'Admin', null);
    adminToken = signSession({ userId: admin.id, telegramId: admin.telegramId });
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM questions WHERE question_text LIKE 'TEST_IMPORT_%'`);
    await pool.query(`DELETE FROM categories WHERE key LIKE 'test_import_%'`);
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id = 9999`);
    await pool.end();
  });

  it('rejects a request with no auth token', async () => {
    const res = await request(app)
      .post('/api/admin/questions/import')
      .attach('file', Buffer.from('dummy'), 'questions.docx')
      .field('category', 'umumiy_bilim');
    expect(res.status).toBe(401);
  });

  it('rejects a non-admin session', async () => {
    const nonAdmin = await upsertUser(9998, 'notadmin', 'NotAdmin', null);
    const token = signSession({ userId: nonAdmin.id, telegramId: nonAdmin.telegramId });

    const res = await request(app)
      .post('/api/admin/questions/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('dummy'), 'questions.docx')
      .field('category', 'umumiy_bilim');

    expect(res.status).toBe(403);
    await pool.query(`DELETE FROM users WHERE telegram_id = 9998`);
  });

  it('rejects a file that is not .docx', async () => {
    const res = await request(app)
      .post('/api/admin/questions/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('dummy'), 'questions.txt')
      .field('category', 'umumiy_bilim');

    expect(res.status).toBe(400);
  });

  it('rejects a request with neither category nor newCategoryLabel', async () => {
    const res = await request(app)
      .post('/api/admin/questions/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('dummy'), 'questions.docx');

    expect(res.status).toBe(400);
  });

  it('rejects a request with both category and newCategoryLabel', async () => {
    const res = await request(app)
      .post('/api/admin/questions/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('dummy'), 'questions.docx')
      .field('category', 'umumiy_bilim')
      .field('newCategoryLabel', 'Test Import Yangi');

    expect(res.status).toBe(400);
  });

  it('rejects a category key that does not exist', async () => {
    mockDocxText("? Savol?\n+ Togri\n= Xato");

    const res = await request(app)
      .post('/api/admin/questions/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('dummy'), 'questions.docx')
      .field('category', 'test_import_notreal');

    expect(res.status).toBe(400);
  });

  it('imports valid questions into an existing category', async () => {
    mockDocxText(['? TEST_IMPORT_Savol 1?', '+ Togri 1', '= Xato 1'].join('\n'));

    const res = await request(app)
      .post('/api/admin/questions/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('dummy'), 'questions.docx')
      .field('category', 'umumiy_bilim');

    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(1);
    expect(res.body.errors).toEqual([]);
    expect(res.body.category).toEqual({ key: 'umumiy_bilim', label: 'Umumiy bilim' });

    const stored = await pool.query(`SELECT * FROM questions WHERE question_text = 'TEST_IMPORT_Savol 1?'`);
    expect(stored.rows.length).toBe(1);
  });

  it('creates a new category and imports questions into it', async () => {
    mockDocxText(['? TEST_IMPORT_Yangi savol?', '+ Togri', '= Xato'].join('\n'));

    const res = await request(app)
      .post('/api/admin/questions/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('dummy'), 'questions.docx')
      .field('newCategoryLabel', 'Test Import Yangi Turkum');

    expect(res.status).toBe(200);
    expect(res.body.category.label).toBe('Test Import Yangi Turkum');
    expect(res.body.inserted).toBe(1);

    const categoryRows = await pool.query(`SELECT * FROM categories WHERE label = 'Test Import Yangi Turkum'`);
    expect(categoryRows.rows.length).toBe(1);
  });

  it('imports the valid blocks and reports errors for invalid ones in the same file', async () => {
    mockDocxText(
      [
        '? TEST_IMPORT_Yaroqli savol?',
        '+ Togri',
        '= Xato',
        '? TEST_IMPORT_Yaroqsiz savol?',
        '= Faqat xato javoblar',
      ].join('\n')
    );

    const res = await request(app)
      .post('/api/admin/questions/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('dummy'), 'questions.docx')
      .field('category', 'umumiy_bilim');

    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(1);
    expect(res.body.errors).toEqual([{ line: 4, message: "to'g'ri javob belgilanmagan" }]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd backend && npx jest tests/admin/questionsImport.test.ts`
Expected: FAIL — `POST /api/admin/questions/import` doesn't exist yet (404s on every request).

- [ ] **Step 4: Implement the route**

Replace the full contents of `backend/src/admin/adminApiRoutes.ts` with:

```ts
import { Router, Response, Request, NextFunction } from 'express';
import multer from 'multer';
import mammoth from 'mammoth';
import { requireAuth, AuthenticatedRequest } from '../auth/authMiddleware';
import { env } from '../config/env';
import { getAdminSummary, getDailyStats, getUserList } from './statsQueries';
import { getCategoryByKey, createCategory, insertQuestions } from '../questions/questionRepository';
import { parseQuestionsText } from '../questions/docxQuestionParser';

export const adminApiRouter = Router();

// Same gate as scripts/healthcheck-alert.sh's Telegram DMs and the
// standalone /admin/stats HTML page - just checked against the
// already-authenticated session's telegramId instead of a separate
// password, so the dashboard can live inside the Mini App itself. Shared by
// every /admin/* route below (not just /admin/stats).
function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!env.adminTelegramId || req.telegramId !== env.adminTelegramId) {
    res.status(403).json({ error: "Ruxsat yo'q" });
    return;
  }
  next();
}

adminApiRouter.get(
  '/admin/stats',
  requireAuth,
  requireAdmin,
  async (_req: AuthenticatedRequest, res: Response) => {
    const [summary, daily, users] = await Promise.all([getAdminSummary(), getDailyStats(14), getUserList()]);
    res.json({ summary, daily, users });
  }
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Wraps multer's own error (e.g. file too large) into the same
// { error: string } JSON shape every other route on this router uses,
// instead of falling through to Express's default HTML error page.
function handleUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      res.status(400).json({ error: 'Fayl hajmi juda katta (maksimal 5MB)' });
      return;
    }
    if (err) {
      next(err);
      return;
    }
    next();
  });
}

adminApiRouter.post(
  '/admin/questions/import',
  requireAuth,
  requireAdmin,
  handleUpload,
  async (req: AuthenticatedRequest, res: Response) => {
    const file = req.file;
    if (!file || !file.originalname.toLowerCase().endsWith('.docx')) {
      res.status(400).json({ error: "Fayl .docx formatida bo'lishi kerak" });
      return;
    }

    const category = typeof req.body.category === 'string' ? req.body.category.trim() : '';
    const newCategoryLabel =
      typeof req.body.newCategoryLabel === 'string' ? req.body.newCategoryLabel.trim() : '';

    if ((!category && !newCategoryLabel) || (category && newCategoryLabel)) {
      res.status(400).json({ error: "category yoki newCategoryLabel'dan aynan bittasi berilishi kerak" });
      return;
    }

    const resolvedCategory = newCategoryLabel ? await createCategory(newCategoryLabel) : await getCategoryByKey(category);

    if (!resolvedCategory) {
      res.status(400).json({ error: 'Bunday turkum topilmadi' });
      return;
    }

    const { value: rawText } = await mammoth.extractRawText({ buffer: file.buffer });
    const { questions, errors } = parseQuestionsText(rawText);

    if (questions.length > 0) {
      await insertQuestions(resolvedCategory.key, questions);
    }

    res.json({ category: resolvedCategory, inserted: questions.length, errors });
  }
);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/admin/`
Expected: PASS (all tests green, including the pre-existing `/admin/stats` tests - unaffected by the `requireAdmin` extraction since its behavior is identical)

- [ ] **Step 6: Commit**

```bash
cd backend
git add package.json package-lock.json src/admin/adminApiRoutes.ts tests/admin/questionsImport.test.ts
git commit -m "Add POST /api/admin/questions/import (docx upload endpoint)"
```

---

### Task 5: Frontend — `apiPostForm` for multipart uploads

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/api/client.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test to `frontend/src/api/client.test.ts`, inside the existing `describe('api/client', ...)` block (after the `apiPost` test):

```ts
  it('apiPostForm sends a FormData body without forcing a JSON Content-Type', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve({ inserted: 1 }) });

    const formData = new FormData();
    formData.append('category', 'umumiy_bilim');
    await apiPostForm('/admin/questions/import', formData, 'my-token');

    const [, options] = (fetch as any).mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.body).toBe(formData);
    expect(options.headers['Content-Type']).toBeUndefined();
    expect(options.headers.Authorization).toBe('Bearer my-token');
  });
```

Update the import line at the top of the file to include `apiPostForm`:

```ts
import { apiGet, apiPost, apiPostForm, ApiError, getAvatarUrl } from './client';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/api/client.test.ts`
Expected: FAIL with "apiPostForm is not a function" (or a TypeScript error that it's not exported)

- [ ] **Step 3: Implement `apiPostForm`**

In `frontend/src/api/client.ts`, change the `request` function's Content-Type logic from:

```ts
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }
```

to:

```ts
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
  // Skip forcing JSON's Content-Type for a FormData body - the browser must
  // set its own multipart/form-data header (with the correct boundary
  // string), which it only does when Content-Type is left unset.
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
```

Then add this new exported function at the end of the file, after `apiPost`:

```ts
export function apiPostForm<T>(path: string, formData: FormData, token?: string): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: formData,
    headers: authHeaders(token),
  });
}
```

- [ ] **Step 4: Run the full client test file to verify it passes**

Run: `cd frontend && npx vitest run src/api/client.test.ts`
Expected: PASS (all tests green, including the pre-existing `apiPost`/`apiGet` tests - unaffected since they never pass a `FormData` body)

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/api/client.ts src/api/client.test.ts
git commit -m "Add apiPostForm for multipart file uploads"
```

---

### Task 6: Frontend — `importQuestions` API call + types

**Files:**
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/api/admin.ts`
- Modify: `frontend/src/api/admin.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test to `frontend/src/api/admin.test.ts`, inside the existing `describe('api/admin', ...)` block:

```ts
  it('calls apiPostForm with /admin/questions/import, the form data, and the token', async () => {
    const apiPostFormSpy = vi.spyOn(client, 'apiPostForm').mockResolvedValue({
      category: { key: 'umumiy_bilim', label: 'Umumiy bilim' },
      inserted: 3,
      errors: [],
    });
    const formData = new FormData();

    const result = await importQuestions(formData, 'tok');

    expect(apiPostFormSpy).toHaveBeenCalledWith('/admin/questions/import', formData, 'tok');
    expect(result.inserted).toBe(3);
  });
```

Update the import line at the top of the file:

```ts
import { getAdminStats, importQuestions } from './admin';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/api/admin.test.ts`
Expected: FAIL with "importQuestions is not a function" (or a TypeScript error that it's not exported)

- [ ] **Step 3: Add the types**

Add these interfaces to `frontend/src/api/types.ts`, after the existing `AdminStats` interface:

```ts
export interface QuestionImportError {
  line: number;
  message: string;
}

export interface QuestionImportResult {
  category: Category;
  inserted: number;
  errors: QuestionImportError[];
}
```

- [ ] **Step 4: Implement `importQuestions`**

Replace the full contents of `frontend/src/api/admin.ts` with:

```ts
// frontend/src/api/admin.ts
import { apiGet, apiPostForm } from './client';
import { AdminStats, QuestionImportResult } from './types';

export function getAdminStats(token: string): Promise<AdminStats> {
  return apiGet<AdminStats>('/admin/stats', token);
}

export function importQuestions(formData: FormData, token: string): Promise<QuestionImportResult> {
  return apiPostForm<QuestionImportResult>('/admin/questions/import', formData, token);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/api/admin.test.ts`
Expected: PASS (all tests green)

- [ ] **Step 6: Commit**

```bash
cd frontend
git add src/api/types.ts src/api/admin.ts src/api/admin.test.ts
git commit -m "Add importQuestions API call and QuestionImportResult types"
```

---

### Task 7: Frontend — `QuestionImportForm` component

**Files:**
- Create: `frontend/src/components/QuestionImportForm.tsx`
- Test: `frontend/src/components/QuestionImportForm.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/QuestionImportForm.test.tsx`:

```tsx
// frontend/src/components/QuestionImportForm.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QuestionImportForm } from './QuestionImportForm';
import * as authContext from '../context/AuthContext';
import * as questionsApi from '../api/questions';
import * as adminApi from '../api/admin';

describe('QuestionImportForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok',
      user: { id: 1, telegramId: 9999 } as any,
      loading: false,
      error: null,
    });
    vi.spyOn(questionsApi, 'getCategories').mockResolvedValue({
      categories: [
        { key: 'umumiy_bilim', label: 'Umumiy bilim' },
        { key: 'sport_kino_musiqa', label: 'Sport/Kino/Musiqa' },
      ],
    });
  });

  it('loads and shows the existing categories plus a "new category" option', async () => {
    render(<QuestionImportForm />);

    await screen.findByText('Umumiy bilim');
    expect(screen.getByText('Sport/Kino/Musiqa')).toBeInTheDocument();
    expect(screen.getByText('+ Yangi turkum')).toBeInTheDocument();
  });

  it('shows a text field for the new category name only when "+ Yangi turkum" is selected', async () => {
    render(<QuestionImportForm />);
    await screen.findByText('Umumiy bilim');

    expect(screen.queryByLabelText('Yangi turkum nomi')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Turkum'), { target: { value: '__new__' } });

    expect(screen.getByLabelText('Yangi turkum nomi')).toBeInTheDocument();
  });

  it('disables the upload button until a file is chosen', async () => {
    render(<QuestionImportForm />);
    await screen.findByText('Umumiy bilim');

    expect(screen.getByRole('button', { name: 'Yuklash' })).toBeDisabled();
  });

  it('uploads the file with the selected category and shows the result', async () => {
    const importSpy = vi.spyOn(adminApi, 'importQuestions').mockResolvedValue({
      category: { key: 'umumiy_bilim', label: 'Umumiy bilim' },
      inserted: 5,
      errors: [],
    });

    render(<QuestionImportForm />);
    await screen.findByText('Umumiy bilim');

    const file = new File(['dummy'], 'savollar.docx');
    fireEvent.change(screen.getByLabelText('Fayl'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Yuklash' }));

    await waitFor(() => expect(importSpy).toHaveBeenCalledOnce());
    const [formData, token] = importSpy.mock.calls[0];
    expect(token).toBe('tok');
    expect(formData.get('file')).toBe(file);
    expect(formData.get('category')).toBe('umumiy_bilim');
    expect(formData.get('newCategoryLabel')).toBeNull();

    await screen.findByText(/5 ta savol qo'shildi/);
  });

  it('uploads with newCategoryLabel when the "new category" option is used', async () => {
    const importSpy = vi.spyOn(adminApi, 'importQuestions').mockResolvedValue({
      category: { key: 'tarix', label: 'Tarix' },
      inserted: 2,
      errors: [],
    });

    render(<QuestionImportForm />);
    await screen.findByText('Umumiy bilim');

    fireEvent.change(screen.getByLabelText('Turkum'), { target: { value: '__new__' } });
    fireEvent.change(screen.getByLabelText('Yangi turkum nomi'), { target: { value: 'Tarix' } });
    const file = new File(['dummy'], 'savollar.docx');
    fireEvent.change(screen.getByLabelText('Fayl'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Yuklash' }));

    await waitFor(() => expect(importSpy).toHaveBeenCalledOnce());
    const [formData] = importSpy.mock.calls[0];
    expect(formData.get('newCategoryLabel')).toBe('Tarix');
    expect(formData.get('category')).toBeNull();

    await screen.findByText(/2 ta savol qo'shildi/);
  });

  it('shows the list of per-line errors returned alongside a successful import', async () => {
    vi.spyOn(adminApi, 'importQuestions').mockResolvedValue({
      category: { key: 'umumiy_bilim', label: 'Umumiy bilim' },
      inserted: 1,
      errors: [{ line: 5, message: "to'g'ri javob belgilanmagan" }],
    });

    render(<QuestionImportForm />);
    await screen.findByText('Umumiy bilim');

    const file = new File(['dummy'], 'savollar.docx');
    fireEvent.change(screen.getByLabelText('Fayl'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Yuklash' }));

    await screen.findByText(/5-qatorda: to'g'ri javob belgilanmagan/);
  });

  it('shows an error message when the upload fails', async () => {
    vi.spyOn(adminApi, 'importQuestions').mockRejectedValue(new Error('Bunday turkum topilmadi'));

    render(<QuestionImportForm />);
    await screen.findByText('Umumiy bilim');

    const file = new File(['dummy'], 'savollar.docx');
    fireEvent.change(screen.getByLabelText('Fayl'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Yuklash' }));

    await screen.findByText('Bunday turkum topilmadi');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/QuestionImportForm.test.tsx`
Expected: FAIL with "Failed to resolve import './QuestionImportForm'"

- [ ] **Step 3: Implement the component**

Create `frontend/src/components/QuestionImportForm.tsx`:

```tsx
// frontend/src/components/QuestionImportForm.tsx
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getCategories } from '../api/questions';
import { importQuestions } from '../api/admin';
import { Category, QuestionImportResult } from '../api/types';

const NEW_CATEGORY_VALUE = '__new__';

export function QuestionImportForm() {
  const { token } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [newCategoryLabel, setNewCategoryLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<QuestionImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCategories()
      .then((res) => {
        setCategories(res.categories);
        if (res.categories.length > 0) setSelectedCategory(res.categories[0].key);
      })
      .catch(() => {
        // Category dropdown just stays empty - not worth a dedicated error
        // state for this secondary admin widget.
      });
  }, []);

  const isNewCategory = selectedCategory === NEW_CATEGORY_VALUE;
  const canUpload =
    !uploading && file !== null && (isNewCategory ? newCategoryLabel.trim().length > 0 : selectedCategory.length > 0);

  const handleUpload = async () => {
    if (!token || !file) return;
    setUploading(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append('file', file);
    if (isNewCategory) {
      formData.append('newCategoryLabel', newCategoryLabel);
    } else {
      formData.append('category', selectedCategory);
    }

    try {
      const res = await importQuestions(formData, token);
      setResult(res);
      if (isNewCategory) {
        setCategories((prev) => [...prev, res.category]);
        setSelectedCategory(res.category.key);
        setNewCategoryLabel('');
      }
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Noma'lum xatolik yuz berdi");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-ios-card p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
      <h3 className="text-sm font-semibold text-ios-label">Savol qo'shish</h3>

      <select
        aria-label="Turkum"
        value={selectedCategory}
        onChange={(e) => setSelectedCategory(e.target.value)}
        className="rounded-xl border border-ios-divider bg-ios-bg px-3 py-2 text-sm text-ios-label"
      >
        {categories.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
        <option value={NEW_CATEGORY_VALUE}>+ Yangi turkum</option>
      </select>

      {isNewCategory && (
        <input
          type="text"
          aria-label="Yangi turkum nomi"
          value={newCategoryLabel}
          onChange={(e) => setNewCategoryLabel(e.target.value)}
          placeholder="Turkum nomi"
          className="rounded-xl border border-ios-divider bg-ios-bg px-3 py-2 text-sm text-ios-label"
        />
      )}

      <input
        type="file"
        aria-label="Fayl"
        accept=".docx"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />

      <button
        type="button"
        disabled={!canUpload}
        onClick={handleUpload}
        className="rounded-full bg-ios-blue py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        {uploading ? 'Yuklanmoqda...' : 'Yuklash'}
      </button>

      {result && (
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-ios-green">
            ✅ {result.inserted} ta savol qo'shildi ({result.category.label})
          </p>
          {result.errors.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-ios-red">
              {result.errors.map((e, i) => (
                <li key={i}>
                  {e.line}-qatorda: {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="text-sm text-ios-red">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/QuestionImportForm.test.tsx`
Expected: PASS (all tests green)

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/components/QuestionImportForm.tsx src/components/QuestionImportForm.test.tsx
git commit -m "Add QuestionImportForm component for the admin docx upload UI"
```

---

### Task 8: Mount `QuestionImportForm` in `AdminScreen`

**Files:**
- Modify: `frontend/src/screens/AdminScreen.tsx`
- Modify: `frontend/src/screens/AdminScreen.test.tsx`

- [ ] **Step 1: Update the existing test file's mocks**

`AdminScreen` will now render `QuestionImportForm`, which calls `getCategories()` on mount - without mocking it, every existing `AdminScreen` test would trigger a real (failing) `fetch` call in the test environment. In `frontend/src/screens/AdminScreen.test.tsx`, add this import at the top:

```ts
import * as questionsApi from '../api/questions';
```

And add this line inside the existing `beforeEach` block (after the `useAuth` mock):

```ts
    vi.spyOn(questionsApi, 'getCategories').mockResolvedValue({ categories: [] });
```

- [ ] **Step 2: Run the existing test file to verify it still passes**

Run: `cd frontend && npx vitest run src/screens/AdminScreen.test.tsx`
Expected: PASS (all tests green - this step alone doesn't add new assertions, it just keeps the existing suite hermetic once Step 3 wires in the new component)

- [ ] **Step 3: Mount the component**

In `frontend/src/screens/AdminScreen.tsx`, add the import:

```ts
import { QuestionImportForm } from '../components/QuestionImportForm';
```

And add `<QuestionImportForm />` as the last element inside the outermost `<div>`, right after the "Foydalanuvchilar" section's closing `</div>`:

```tsx
      </div>

      <QuestionImportForm />
    </div>
  );
}
```

- [ ] **Step 4: Run the test file again to verify it still passes**

Run: `cd frontend && npx vitest run src/screens/AdminScreen.test.tsx`
Expected: PASS (all tests green)

- [ ] **Step 5: Run the full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: PASS (all tests green, no regressions elsewhere)

- [ ] **Step 6: Commit**

```bash
cd frontend
git add src/screens/AdminScreen.tsx src/screens/AdminScreen.test.tsx
git commit -m "Mount QuestionImportForm in the admin screen"
```

---

## After All Tasks: Final Verification

- [ ] Run the full backend suite: `cd backend && npx jest`
- [ ] Run the full frontend suite: `cd frontend && npx vitest run`
- [ ] Run backend typecheck: `cd backend && npx tsc --noEmit`
- [ ] Run frontend typecheck + build: `cd frontend && npx tsc --noEmit && npm run build`

Then proceed to `superpowers:finishing-a-development-branch` (or, since this project has been working directly on `master` throughout this session, simply push once all of the above is green).
