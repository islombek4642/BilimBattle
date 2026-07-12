# "Ingliz tili" Vocabulary Category Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "Ingliz tili" battle category sourced from the `MongoDB/english-words-definitions` Hugging Face dataset (466,670 words + definitions, Apache 2.0), reusing the existing 1v1 HP/knockout battle mechanic unchanged.

**Architecture:** A one-time offline Node script downloads the dataset's parquet file, builds a 4-option multiple-choice question row per word (1 real definition + 3 random other words' definitions), and bulk-inserts into the existing `questions` table under a new `ingliz_tili` category — zero runtime AI calls, zero new game-logic branches. A new nullable `extra_definitions` column carries a word's remaining definitions through to the frontend for an optional "show more" expand on the reveal screen.

**Tech Stack:** Backend: Node/TS/Express/Socket.io/Postgres/Redis, Jest (real local Postgres/Redis per `backend/.env`), `hyparquet` (new dependency, ESM-only parquet reader). Frontend: Vite/React/TS/Vitest/RTL, Tailwind.

**Design spec:** `docs/superpowers/specs/2026-07-12-english-vocabulary-category-design.md`

---

### Task 1: Backend — schema + `questionRepository` extension

**Files:**
- Modify: `backend/src/db/schema.sql`
- Modify: `backend/src/questions/questionRepository.ts`
- Modify: `backend/tests/questions/questionRepository.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/questions/questionRepository.test.ts`, inside the existing `describe('questionRepository', ...)` block (after the `insertQuestions` describe block, before the final closing `});`):

```ts
  describe('extra_definitions column', () => {
    afterEach(async () => {
      await pool.query(`DELETE FROM questions WHERE question_text LIKE 'TEST_REPO_%'`);
    });

    it('returns extraDefinitions when the row has them, and omits the field when null', async () => {
      await pool.query(
        `INSERT INTO questions (category, question_text, options, correct_index, extra_definitions)
         VALUES ('umumiy_bilim', 'TEST_REPO_WithExtra', '["a","b","c","d"]', 0, '["second meaning","third meaning"]')`
      );
      await pool.query(
        `INSERT INTO questions (category, question_text, options, correct_index)
         VALUES ('umumiy_bilim', 'TEST_REPO_NoExtra', '["a","b","c","d"]', 0)`
      );

      const questions = await getRandomQuestions('umumiy_bilim', 50);
      const withExtra = questions.find((q) => q.text === 'TEST_REPO_WithExtra');
      const noExtra = questions.find((q) => q.text === 'TEST_REPO_NoExtra');

      expect(withExtra?.extraDefinitions).toEqual(['second meaning', 'third meaning']);
      expect(noExtra?.extraDefinitions).toBeUndefined();
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest tests/questions/questionRepository.test.ts -t "extra_definitions"`
Expected: FAIL — `extra_definitions` column does not exist yet (Postgres error), or `withExtra` is undefined because `getRandomQuestions` doesn't select the new column.

- [ ] **Step 3: Add the column to the schema**

In `backend/src/db/schema.sql`, change the `questions` table definition:

```sql
CREATE TABLE IF NOT EXISTS questions (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  question_text TEXT NOT NULL,
  options JSONB NOT NULL,
  correct_index SMALLINT NOT NULL,
  extra_definitions JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

And add the new category row to the existing seed INSERT:

```sql
INSERT INTO categories (key, label) VALUES
  ('umumiy_bilim', 'Umumiy bilim'),
  ('sport_kino_musiqa', 'Sport/Kino/Musiqa'),
  ('ingliz_tili', 'Ingliz tili')
ON CONFLICT (key) DO NOTHING;
```

Since `schema.sql` is applied via `CREATE TABLE IF NOT EXISTS` (the table already exists in every environment that's run this before), Postgres will NOT retroactively add the new column to an existing table just because the `CREATE TABLE` statement changed — `IF NOT EXISTS` skips the whole statement if the table is already there. Add an idempotent `ALTER TABLE` right after the `CREATE TABLE questions` block so it works on both fresh databases and ones that already have the table:

```sql
ALTER TABLE questions ADD COLUMN IF NOT EXISTS extra_definitions JSONB;
```

- [ ] **Step 4: Apply the schema to your local dev database**

Run: `cd backend && npm run migrate`
Expected: `Migration applied successfully.`

- [ ] **Step 5: Extend `QuestionRecord` and `getRandomQuestions`**

In `backend/src/questions/questionRepository.ts`, change the `QuestionRecord` interface:

```ts
export interface QuestionRecord {
  id: number;
  text: string;
  options: string[];
  correctIndex: number;
  extraDefinitions?: string[];
}
```

Change `getRandomQuestions`:

```ts
export async function getRandomQuestions(category: string, count: number): Promise<QuestionRecord[]> {
  const result = await pool.query<{
    id: number;
    question_text: string;
    options: string[];
    correct_index: number;
    extra_definitions: string[] | null;
  }>(
    `SELECT id, question_text, options, correct_index, extra_definitions FROM questions WHERE category = $1 ORDER BY RANDOM() LIMIT $2`,
    [category, count]
  );
  return result.rows.map((row) => ({
    id: row.id,
    text: row.question_text,
    options: row.options,
    correctIndex: row.correct_index,
    ...(row.extra_definitions ? { extraDefinitions: row.extra_definitions } : {}),
  }));
}
```

The spread-with-conditional (rather than always setting `extraDefinitions: row.extra_definitions ?? undefined`) matters here: it makes the key genuinely **absent** from the object when there's no data, not present-with-value-`undefined` — `toBeUndefined()` in the test above passes either way, but an absent key is what later JSON-serializes cleanly over the Redis/Socket.io round-trip in Task 2 (an explicit `undefined` value is also dropped by `JSON.stringify`, so both approaches work, but an absent key is the more direct expression of "this category has no extra definitions" and matches how `options.length` / other optional-shape data is already handled in this codebase).

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend && npx jest tests/questions/questionRepository.test.ts`
Expected: PASS (all tests in the file, including the new one)

- [ ] **Step 7: Run the full backend suite and typecheck**

Run: `cd backend && npx jest`
Expected: PASS, same count as before + 1

Run: `cd backend && npx tsc --noEmit`
Expected: clean, zero errors

- [ ] **Step 8: Commit**

```bash
cd backend
git add src/db/schema.sql src/questions/questionRepository.ts tests/questions/questionRepository.test.ts
git commit -m "Add extra_definitions column and ingliz_tili category"
```

---

### Task 2: Backend — thread `extraDefinitions` into the `question_result` payload

**Files:**
- Modify: `backend/src/game/gameEngine.ts`
- Modify: `backend/tests/game/gameEngine.test.ts`

- [ ] **Step 1: Write the failing test**

This file already has everything needed: `createFakeIO()` (returns `{ fakeIO, events, sockets }`, `events: {room, event, payload}[]`), a `describe('gameEngine full match flow', ...)` block with `player1Id`/`player2Id` set up in `beforeAll`, and `questionRepository` already imported as a namespace (`import * as questionRepository from '../../src/questions/questionRepository';`). Add this test inside that same `describe` block:

```ts
  it('includes extraDefinitions in question_result only when the resolved question has them', async () => {
    const gameId = randomUUID();
    const { fakeIO, events } = createFakeIO();
    setIOForTesting(fakeIO as any);

    // Force getRandomQuestions to return a single fixture question with
    // extraDefinitions so resolveQuestion() definitely resolves it - real
    // seeded umumiy_bilim questions would make which question comes up (and
    // therefore whether extraDefinitions is present) non-deterministic.
    jest.spyOn(questionRepository, 'getRandomQuestions').mockResolvedValueOnce([
      { id: 999999, text: 'TEST_ENGINE_WithExtra', options: ['a', 'b', 'c', 'd'], correctIndex: 0, extraDefinitions: ['second meaning'] },
    ]);

    await startGame(gameId, 'umumiy_bilim', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' });
    await submitAnswer(gameId, player1Id, 0, 0);
    await submitAnswer(gameId, player2Id, 0, 0);

    const resultEvent = events.find((e) => e.event === 'question_result');
    expect((resultEvent?.payload as { extraDefinitions?: string[] })?.extraDefinitions).toEqual(['second meaning']);
  });

  it('omits extraDefinitions from question_result for a question that has none', async () => {
    const gameId = randomUUID();
    const { fakeIO, events } = createFakeIO();
    setIOForTesting(fakeIO as any);

    jest.spyOn(questionRepository, 'getRandomQuestions').mockResolvedValueOnce([
      { id: 999998, text: 'TEST_ENGINE_NoExtra', options: ['a', 'b', 'c', 'd'], correctIndex: 0 },
    ]);

    await startGame(gameId, 'umumiy_bilim', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' });
    await submitAnswer(gameId, player1Id, 0, 0);
    await submitAnswer(gameId, player2Id, 0, 0);

    const resultEvent = events.find((e) => e.event === 'question_result');
    expect((resultEvent?.payload as { extraDefinitions?: string[] })?.extraDefinitions).toBeUndefined();
  });
```

Both tests mock `getRandomQuestions` directly (no real DB rows involved), so there's no `questions` table cleanup needed — `999999`/`999998` are fixture-only IDs that never touch Postgres.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest tests/game/gameEngine.test.ts -t "extraDefinitions"`
Expected: FAIL on the first test — `resultEvent?.payload.extraDefinitions` is `undefined` when it should be `['second meaning']` (the field isn't emitted yet). The second test passes trivially either way (it's already `undefined`), but is included as a permanent regression guard.

- [ ] **Step 3: Add the field to the emit**

In `backend/src/game/gameEngine.ts`, in `resolveQuestion()` (around line 150):

```ts
  getIO().to(gameId).emit('question_result', {
    index: game.currentQuestionIndex,
    correctIndex: question.correctIndex,
    scores: game.players.map((p) => ({ userId: p.userId, score: p.score })),
    ...(question.extraDefinitions ? { extraDefinitions: question.extraDefinitions } : {}),
  });
```

Same absent-vs-undefined reasoning as Task 1 Step 5 — for every category except `ingliz_tili`, `question.extraDefinitions` is `undefined` (never set by `getRandomQuestions`), so the spread contributes nothing and the payload shape for existing categories is byte-for-byte unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/game/gameEngine.test.ts`
Expected: PASS (all tests, including the 2 new ones)

- [ ] **Step 5: Run the full backend suite and typecheck**

Run: `cd backend && npx jest`
Expected: PASS, same count as Task 1's end + 2

Run: `cd backend && npx tsc --noEmit`
Expected: clean, zero errors

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/game/gameEngine.ts tests/game/gameEngine.test.ts
git commit -m "Thread extraDefinitions through to the question_result payload"
```

---

### Task 3: Backend — vocabulary import script, pure logic (distractor selection + row building)

**Files:**
- Create: `backend/scripts/importEnglishVocabulary.ts`
- Create: `backend/tests/scripts/importEnglishVocabulary.test.ts`

This task builds only the **pure, network-free** logic (picking random distractors, building one question row from one dictionary entry) with full unit test coverage. Task 4 adds the CLI wiring (download the real dataset, parse it, bulk-insert) around these functions.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/scripts/importEnglishVocabulary.test.ts`:

```ts
import { pickRandomDistractors, buildQuestionRow, VocabEntry } from '../../scripts/importEnglishVocabulary';

// A constant rng (e.g. `() => 0.4`) can never satisfy pickRandomDistractors'
// while loop once it needs more than one distinct index - it would keep
// re-rolling the exact same idx forever and hang the test. This cycles
// through every index of a 4-entry pool in a fixed order, repeating - for
// ANY single excluded selfIndex in range, one full cycle always yields
// exactly 3 fresh, distinct, non-self indexes (1 skip + 3 picks), so it
// terminates regardless of which entry is "self". Extra calls beyond a full
// cycle (used by buildQuestionRow's shuffle step) just keep cycling, which
// is fine there since that's a fixed-length for loop, not a while loop
// waiting on distinct values.
function sequenceRng(sequence: number[]): () => number {
  let call = 0;
  return () => sequence[call++ % sequence.length];
}

describe('pickRandomDistractors', () => {
  const pool: VocabEntry[] = [
    { term: 'alpha', definitions: ['Alpha def'] },
    { term: 'beta', definitions: ['Beta def'] },
    { term: 'gamma', definitions: ['Gamma def'] },
    { term: 'delta', definitions: ['Delta def'] },
  ];

  it('returns the requested count of entries, never including the excluded index', () => {
    // idx sequence (pool.length = 4): 0 (= selfIndex, skipped), then 1, 2, 3.
    const rng = sequenceRng([0, 0.25, 0.5, 0.75]);
    const picked = pickRandomDistractors(pool, 0, 3, rng);
    expect(picked.length).toBe(3);
    expect(picked.some((p) => p.term === 'alpha')).toBe(false);
  });

  it('never returns the same entry twice, even when the rng repeats an already-picked index', () => {
    // idx sequence (pool.length = 4): 1, 1 (dup of the first - must be
    // skipped and re-rolled), 2, 3. Index 0 (self) never comes up here, so
    // this exercises the pickedIndexes.has(idx) branch specifically, not
    // the idx === selfIndex branch already covered by the test above.
    const rng = sequenceRng([0.25, 0.25, 0.5, 0.75]);
    const picked = pickRandomDistractors(pool, 0, 3, rng);
    const terms = picked.map((p) => p.term);
    expect(new Set(terms).size).toBe(3);
  });

  it('throws rather than looping forever when the pool is too small for the requested count', () => {
    const tinyPool: VocabEntry[] = [
      { term: 'only', definitions: ['Only def'] },
      { term: 'other', definitions: ['Other def'] },
    ];
    expect(() => pickRandomDistractors(tinyPool, 0, 3)).toThrow();
  });
});

describe('buildQuestionRow', () => {
  const pool: VocabEntry[] = [
    { term: 'alpha', definitions: ['Alpha primary meaning', 'Alpha secondary meaning'] },
    { term: 'beta', definitions: ['Beta primary meaning'] },
    { term: 'gamma', definitions: ['Gamma primary meaning'] },
    { term: 'delta', definitions: ['Delta primary meaning'] },
  ];

  it('uses the term as question text, the first definition as the correct option, and marks correctIndex accurately', () => {
    const row = buildQuestionRow(pool[0], 0, pool, sequenceRng([0, 0.25, 0.5, 0.75]));
    expect(row.text).toBe('alpha');
    expect(row.options.length).toBe(4);
    // Shuffling can move the correct option to any slot - correctIndex is
    // computed AFTER shuffling, so this holds regardless of where it lands.
    expect(row.options[row.correctIndex]).toBe('Alpha primary meaning');
  });

  it('carries the remaining definitions (beyond the first) as extraDefinitions', () => {
    const row = buildQuestionRow(pool[0], 0, pool, sequenceRng([0, 0.25, 0.5, 0.75]));
    expect(row.extraDefinitions).toEqual(['Alpha secondary meaning']);
  });

  it('leaves extraDefinitions empty for a word with only one definition', () => {
    const row = buildQuestionRow(pool[1], 1, pool, sequenceRng([0, 0.25, 0.5, 0.75]));
    expect(row.extraDefinitions).toEqual([]);
  });

  it('never includes the target word itself among the distractor options', () => {
    const row = buildQuestionRow(pool[0], 0, pool, sequenceRng([0, 0.25, 0.5, 0.75]));
    expect(row.options).not.toContain('Alpha secondary meaning'); // not reused as a "distractor" of itself
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest tests/scripts/importEnglishVocabulary.test.ts`
Expected: FAIL — `backend/scripts/importEnglishVocabulary.ts` doesn't exist yet.

- [ ] **Step 3: Implement the pure logic**

Create `backend/scripts/importEnglishVocabulary.ts`:

```ts
// backend/scripts/importEnglishVocabulary.ts
export interface VocabEntry {
  term: string;
  definitions: string[];
}

export interface BuiltQuestionRow {
  text: string;
  options: string[];
  correctIndex: number;
  extraDefinitions: string[];
}

// Picks `count` distinct entries from `pool`, never including `selfIndex`.
// Index-based (not term-based) exclusion so this stays O(count) per call
// regardless of pool size - the real dataset has 466k entries, and this
// function runs once per entry, so an O(pool.length) filter/scan per call
// would make the whole import script quadratic (466k^2) and impractically
// slow. Picking random indexes directly and re-rolling on a rare collision
// keeps each call cheap no matter how large the pool is.
export function pickRandomDistractors(
  pool: VocabEntry[],
  selfIndex: number,
  count: number,
  rng: () => number = Math.random
): VocabEntry[] {
  if (pool.length <= count) {
    throw new Error(`pool of ${pool.length} entries is too small to pick ${count} distractors from`);
  }
  const pickedIndexes = new Set<number>();
  const picked: VocabEntry[] = [];
  while (picked.length < count) {
    const idx = Math.floor(rng() * pool.length);
    if (idx === selfIndex || pickedIndexes.has(idx)) continue;
    pickedIndexes.add(idx);
    picked.push(pool[idx]);
  }
  return picked;
}

// Builds one 4-option question row for `entry`. `entryIndex` is entry's own
// position in `pool` (see pickRandomDistractors above for why this is
// index-based). Uses a Fisher-Yates shuffle tagged with which option is
// correct, rather than shuffling plain strings and then searching for the
// correct one afterwards with indexOf - two different words could
// coincidentally share identical definition text, which would make indexOf
// find the wrong (or merely "a", ambiguous) occurrence.
export function buildQuestionRow(
  entry: VocabEntry,
  entryIndex: number,
  pool: VocabEntry[],
  rng: () => number = Math.random
): BuiltQuestionRow {
  const distractors = pickRandomDistractors(pool, entryIndex, 3, rng);
  const options = [
    { text: entry.definitions[0], isCorrect: true },
    ...distractors.map((d) => ({ text: d.definitions[0], isCorrect: false })),
  ];
  for (let i = options.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return {
    text: entry.term,
    options: options.map((o) => o.text),
    correctIndex: options.findIndex((o) => o.isCorrect),
    extraDefinitions: entry.definitions.slice(1),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/scripts/importEnglishVocabulary.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Run the full backend suite and typecheck**

Run: `cd backend && npx jest`
Expected: PASS, same count as Task 2's end + this file's test count

Run: `cd backend && npx tsc --noEmit`
Expected: clean, zero errors

- [ ] **Step 6: Commit**

```bash
cd backend
git add scripts/importEnglishVocabulary.ts tests/scripts/importEnglishVocabulary.test.ts
git commit -m "Add pure distractor-selection and question-building logic for vocab import"
```

---

### Task 4: Backend — vocabulary import script, CLI wiring (download, parse, bulk insert)

**Files:**
- Modify: `backend/scripts/importEnglishVocabulary.ts`
- Modify: `backend/package.json`

This task adds the operational part of the script around Task 3's pure functions: download the real parquet file, parse it, and bulk-insert into Postgres. This part is **not** covered by an automated test (it does real network I/O against an external host) — instead, Step 5 below is a manual verification run.

- [ ] **Step 1: Add the `hyparquet` dependency**

Run: `cd backend && npm install hyparquet`

`hyparquet` is published as an ES module; this backend compiles to CommonJS (`tsconfig.json`'s `"module": "CommonJS"`), so it must be loaded via a dynamic `await import('hyparquet')` inside an async function, never a static `import` (a static import would be transpiled to `require('hyparquet')`, which throws `ERR_REQUIRE_ESM` for an ESM-only package at runtime).

- [ ] **Step 2: Append the CLI wiring to the script**

Append to `backend/scripts/importEnglishVocabulary.ts` (after the `buildQuestionRow` function from Task 3):

```ts
import { pool } from '../src/config/db';

const DATASET_URL =
  'https://huggingface.co/api/datasets/MongoDB/english-words-definitions/parquet/default/train/0.parquet';
const CATEGORY_KEY = 'ingliz_tili';
const INSERT_CHUNK_SIZE = 500;

async function downloadParquet(destPath: string): Promise<void> {
  const response = await fetch(DATASET_URL);
  if (!response.ok) {
    throw new Error(`Failed to download dataset: HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const fs = await import('fs/promises');
  await fs.writeFile(destPath, buffer);
}

async function loadVocabEntries(parquetPath: string): Promise<VocabEntry[]> {
  // hyparquet is ESM-only; this file compiles to CommonJS, so this MUST stay
  // a dynamic import (see Step 1's note above) - a static import here would
  // be rewritten to require('hyparquet') by tsc and crash at runtime.
  const { asyncBufferFromFile, parquetReadObjects } = await import('hyparquet');
  const file = await asyncBufferFromFile(parquetPath);
  const rows = (await parquetReadObjects({ file })) as { term: string; definitions: string[] }[];
  // Defensive: the dataset is well-formed in practice, but an empty term or
  // an empty definitions array would produce a question with no correct
  // answer text or nothing to build a distractor from - skip rather than
  // crash the whole 466k-row import over a handful of bad rows.
  return rows.filter((r) => r.term && r.definitions?.length > 0);
}

async function insertQuestionRows(rows: BuiltQuestionRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE);
    const values: unknown[] = [];
    const placeholders = chunk
      .map((row, idx) => {
        const base = idx * 5;
        values.push(CATEGORY_KEY, row.text, JSON.stringify(row.options), row.correctIndex, JSON.stringify(row.extraDefinitions));
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
      })
      .join(', ');
    await pool.query(
      `INSERT INTO questions (category, question_text, options, correct_index, extra_definitions) VALUES ${placeholders}`,
      values
    );
    console.log(`Inserted ${Math.min(i + INSERT_CHUNK_SIZE, rows.length)}/${rows.length} rows`);
  }
}

async function main(): Promise<void> {
  const os = await import('os');
  const path = await import('path');
  const parquetPath = path.join(os.tmpdir(), 'english-words-definitions.parquet');

  console.log('Downloading dataset...');
  await downloadParquet(parquetPath);

  console.log('Parsing dataset...');
  const entries = await loadVocabEntries(parquetPath);
  console.log(`Loaded ${entries.length} vocabulary entries`);

  console.log('Building question rows...');
  const rows = entries.map((entry, index) => buildQuestionRow(entry, index, entries));

  console.log('Inserting into the database...');
  await insertQuestionRows(rows);

  console.log('Done.');
  await pool.end();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Vocabulary import failed:', err);
    process.exit(1);
  });
}
```

The `if (require.main === module)` guard is required: this same file is `import`-ed by `tests/scripts/importEnglishVocabulary.test.ts` (Task 3) to reach `pickRandomDistractors`/`buildQuestionRow` — without the guard, merely importing the file for its pure functions would also kick off a real download and a real database write as a side effect of running the test suite.

- [ ] **Step 3: Add an npm script entry**

In `backend/package.json`, add to `"scripts"` (alongside `"loadtest"`):

```json
    "import:english-vocab": "ts-node scripts/importEnglishVocabulary.ts"
```

- [ ] **Step 4: Run the full backend suite and typecheck to confirm nothing broke**

Run: `cd backend && npx jest`
Expected: PASS, same count as Task 3's end (this task adds no new automated tests, only CLI wiring around already-tested pure functions)

Run: `cd backend && npx tsc --noEmit`
Expected: clean, zero errors

- [ ] **Step 5: Manually verify the script end-to-end against your local dev database**

Run: `cd backend && npm run import:english-vocab`

Expected: logs progress ("Downloading dataset...", "Parsing dataset...", "Loaded 466670 vocabulary entries", periodic "Inserted N/466670 rows", "Done."). This takes a few minutes (network download + ~934 batched inserts). Afterward, confirm in `psql`/your DB client:

```sql
SELECT COUNT(*) FROM questions WHERE category = 'ingliz_tili';
-- expect ~466670
SELECT question_text, options, correct_index, extra_definitions FROM questions WHERE category = 'ingliz_tili' LIMIT 5;
-- expect real English words, 4-element options arrays, a valid correct_index, and extra_definitions either NULL or a JSON array
```

If you don't want to commit to a multi-minute local run at this point in the review flow, it's fine to defer this manual verification to right before the final holistic review / deploy step — but it must be run and confirmed at least once before this feature is considered done, since it's the only check that the dynamic `hyparquet` import and the real dataset's actual shape work together outside of the mocked unit tests.

- [ ] **Step 6: Commit**

```bash
cd backend
git add scripts/importEnglishVocabulary.ts package.json package-lock.json
git commit -m "Add CLI wiring to download, parse, and bulk-insert the vocabulary dataset"
```

---

### Task 5: Frontend — category label, payload type, and "show more definitions" reveal UI

**Files:**
- Modify: `frontend/src/utils/category.ts`
- Modify: `frontend/src/socket/useGameSocket.ts`
- Modify: `frontend/src/screens/BattleScreen.tsx`
- Modify: `frontend/src/screens/BattleScreen.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/screens/BattleScreen.test.tsx`, inside the existing `describe('BattleScreen', ...)` block:

```ts
  it('shows a "see more definitions" toggle when the resolved question has extraDefinitions', () => {
    mockSocket({
      question: { index: 0, total: 7, text: 'Negative', options: ['a', 'b', 'c', 'd'], timeLimitMs: 10000 },
      questionResult: { index: 0, correctIndex: 0, scores: [], extraDefinitions: ['A pessimistic attitude.', 'An underexposed photo image.'] },
    });
    render(<BattleScreen gameId="g1" category="ingliz_tili" />);

    expect(screen.queryByText('A pessimistic attitude.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Yana ko'rsatish"));
    expect(screen.getByText('A pessimistic attitude.')).toBeInTheDocument();
    expect(screen.getByText('An underexposed photo image.')).toBeInTheDocument();
  });

  it('does not show the "see more definitions" toggle for a category with no extraDefinitions', () => {
    mockSocket({
      question: { index: 0, total: 7, text: 'Poytaxt qaysi?', options: ['Toshkent', 'Samarqand'], timeLimitMs: 10000 },
      questionResult: { index: 0, correctIndex: 0, scores: [] },
    });
    render(<BattleScreen gameId="g1" category="umumiy_bilim" />);

    expect(screen.queryByText("Yana ko'rsatish")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/screens/BattleScreen.test.tsx -t "see more definitions"`
Expected: FAIL — `QuestionResultPayload` doesn't have `extraDefinitions` yet (TS error) and/or the "Yana ko'rsatish" toggle doesn't exist.

- [ ] **Step 3: Extend `QuestionResultPayload`**

In `frontend/src/socket/useGameSocket.ts`:

```ts
export interface QuestionResultPayload {
  index: number;
  correctIndex: number;
  scores: ScoreEntry[];
  extraDefinitions?: string[];
}
```

- [ ] **Step 4: Add the category label**

In `frontend/src/utils/category.ts`:

```ts
const CATEGORY_LABELS: Record<string, string> = {
  umumiy_bilim: 'Umumiy bilim',
  sport_kino_musiqa: 'Sport/Kino/Musiqa',
  ingliz_tili: 'Ingliz tili',
};
```

- [ ] **Step 5: Add the expandable reveal section to `BattleScreen.tsx`**

Add a new piece of local state near the top of the component (alongside `selectedOption`/`answeredIndex`):

```ts
  const [showExtraDefinitions, setShowExtraDefinitions] = useState(false);
```

Reset it whenever a new question arrives, in the existing effect that resets `selectedOption`:

```ts
  useEffect(() => {
    if (question && question.index !== answeredIndex) {
      setSelectedOption(null);
      setShowExtraDefinitions(false);
    }
  }, [question, answeredIndex]);
```

Add the expandable section right after the options `<div>` (after its closing `</div>` at what is currently the second-to-last line before the component's final closing `</div>`):

```tsx
      {questionResult?.index === question.index && questionResult.extraDefinitions && questionResult.extraDefinitions.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowExtraDefinitions((prev) => !prev)}
            className="self-start text-sm font-medium text-ios-blue"
          >
            {showExtraDefinitions ? 'Yashirish' : "Yana ko'rsatish"}
          </button>
          {showExtraDefinitions && (
            <ul className="flex flex-col gap-1 text-sm text-ios-secondary-label">
              {questionResult.extraDefinitions.map((definition, index) => (
                <li key={index}>{definition}</li>
              ))}
            </ul>
          )}
        </div>
      )}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/screens/BattleScreen.test.tsx`
Expected: PASS (all tests, including the 2 new ones)

- [ ] **Step 7: Run the full frontend suite and typecheck**

Run: `cd frontend && npx vitest run`
Expected: PASS, same count as before + 2

Run: `cd frontend && npx tsc --noEmit`
Expected: clean, zero errors

- [ ] **Step 8: Commit**

```bash
cd frontend
git add src/utils/category.ts src/socket/useGameSocket.ts src/screens/BattleScreen.tsx src/screens/BattleScreen.test.tsx
git commit -m "Add Ingliz tili category label and a show-more-definitions reveal toggle"
```

---

## After all 5 tasks

Run the full verification sweep from both projects one more time (`backend`: `npx jest`, `npx tsc --noEmit`; `frontend`: `npx vitest run`, `npx tsc --noEmit && npm run build`), then dispatch a final holistic reviewer across all 5 tasks together — in particular re-checking:
- The `extra_definitions` null-vs-present handling stays consistent end-to-end (DB → `questionRepository` → `gameEngine` → socket payload → frontend type → UI) with no accidental leakage of the field for the two pre-existing categories.
- Task 4's manual import run (Step 5) actually happened and the row count / spot-checked rows look sane — this is the one part of the whole feature no automated test touches.
- `getRandomQuestions`'s `ORDER BY RANDOM() LIMIT $2` performance against the real ~466k-row `ingliz_tili` category (per the design spec's "Xavf" section) — worth one `EXPLAIN ANALYZE` sanity check once real data is loaded.

Then use `superpowers:finishing-a-development-branch` as usual for this project (working directly on `master`, so this reduces to: verify, then offer to push).
