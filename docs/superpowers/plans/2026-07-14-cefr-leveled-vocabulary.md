# CEFR-Leveled Vocabulary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `ingliz_tili` question pool with a CEFR-graded one (A1 → C2) so level number correlates with real difficulty, and surface the CEFR tier in the level-select UI.

**Architecture:** A new pure-function module (`cefrVocabulary.ts`) loads a bundled word→CEFR-score dataset, joins it against the existing bundled definitions dataset by word text, and groups+sorts the result into 6 tiers. The existing import script's `main()` is rewritten to build question rows per-tier (distractors now drawn from the same tier) and insert them in strict tier order, so the existing `getQuestionsForLevel`'s pure `id`-order mapping needs **no changes at all** — level→question logic stays exactly as it is today. A new `cefr_level` column rides along per question for transparency and to power a small tier badge in `LevelSelectScreen`.

**Tech Stack:** Backend: Node/TS/Express/Postgres, Jest (real local Postgres per `backend/.env`). Frontend: Vite/React/TS/Vitest/RTL, Tailwind.

**Design spec:** `docs/superpowers/specs/2026-07-14-cefr-leveled-vocabulary-design.md`

**Data files already bundled** (verified against the design spec's real join numbers — do not re-download or regenerate these): `backend/data/cefr-words.csv` (172,782 rows, `word_id,word,stem_word_id`) and `backend/data/cefr-word-pos.csv` (248,184 rows, `word_pos_id,word_id,pos_tag_id,lemma_word_id,frequency_count,level`), from [Words-CEFR-Dataset](https://github.com/Maximax67/Words-CEFR-Dataset) (MIT license). The Dockerfile already does `COPY data ./data` (builder) and `COPY --from=builder /app/data ./dist/data` (runtime) — no Dockerfile change is needed for these two new files to reach the production image. `.gitattributes` already pins `backend/data/*.csv text eol=lf`, so these stay LF-terminated on every checkout regardless of a local machine's `core.autocrlf` setting (this repo has `core.autocrlf=true` locally, which would otherwise silently rewrite them to CRLF and corrupt `word_pos.csv`'s last column, `level`, on a fresh Windows checkout).

---

### Task 1: Backend — `cefr_level` column

**Files:**
- Modify: `backend/src/db/schema.sql`

- [ ] **Step 1: Add the column**

In `backend/src/db/schema.sql`, add directly after the existing `extra_definitions` column's `ALTER TABLE` line:

```sql
-- Nullable: only ingliz_tili rows (imported by the CEFR-aware
-- importEnglishVocabulary.ts) ever populate this; umumiy_bilim and
-- sport_kino_musiqa rows leave it NULL. Does not affect
-- getQuestionsForLevel's level->question mapping (still pure `id` order) -
-- this column is metadata for transparency/debugging and for
-- getLevelTierBoundaries (see questionRepository.ts), not a query dimension.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS cefr_level TEXT;
```

- [ ] **Step 2: Apply the schema to your local dev database**

Run: `cd backend && npm run migrate`
Expected: `Migration applied successfully.`

- [ ] **Step 3: Verify the column exists**

Run a quick check (e.g. via a throwaway Node script using `pool`, or `psql` if available) that `SELECT cefr_level FROM questions LIMIT 1;` succeeds with no error. Do not leave any throwaway script in the repo.

- [ ] **Step 4: Commit**

```bash
cd backend
git add src/db/schema.sql
git commit -m "Add cefr_level column to questions"
```

---

### Task 2: Backend — `cefrVocabulary.ts` module (CEFR loading, joining, tiering)

**Files:**
- Create: `backend/scripts/cefrVocabulary.ts`
- Create: `backend/tests/scripts/cefrVocabulary.test.ts`

This module holds everything specific to turning the bundled CEFR CSVs into a tiered, definition-joined word list. It has no database dependency and no dependency on `importEnglishVocabulary.ts` other than importing its `VocabEntry` type (a type-only import, not a runtime dependency in the wrong direction).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/scripts/cefrVocabulary.test.ts`:

```ts
import {
  tierForLevel,
  parseSimpleCsv,
  buildCefrWordLevels,
  joinCefrWithDefinitions,
  groupAndSortByTier,
  CefrVocabEntry,
} from '../../scripts/cefrVocabulary';
import { VocabEntry } from '../../scripts/importEnglishVocabulary';

describe('tierForLevel', () => {
  it('maps continuous scores to the nearest rounded tier, clamped to A1..C2', () => {
    expect(tierForLevel(1)).toBe('A1');
    expect(tierForLevel(1.4)).toBe('A1');
    expect(tierForLevel(1.5)).toBe('A2'); // rounds up at the midpoint
    expect(tierForLevel(6)).toBe('C2');
    expect(tierForLevel(0.2)).toBe('A1'); // clamped below 1
    expect(tierForLevel(7.9)).toBe('C2'); // clamped above 6
  });
});

describe('parseSimpleCsv', () => {
  it('parses quoted comma-separated rows into objects keyed by header', () => {
    const csv = '"word_id","word"\n"1","the"\n"2","of"\n';
    expect(parseSimpleCsv(csv)).toEqual([
      { word_id: '1', word: 'the' },
      { word_id: '2', word: 'of' },
    ]);
  });

  it('returns an empty array for a header-only (no data rows) input', () => {
    expect(parseSimpleCsv('"word_id","word"\n')).toEqual([]);
  });

  it('handles CRLF line endings without leaving a stray quote/carriage-return on the last column', () => {
    // Regression guard: backend/data/*.csv is pinned to LF via
    // .gitattributes, but this must not silently corrupt data if that ever
    // lapses (e.g. a future file added without the same gitattributes rule)
    // - word_pos.csv's LAST column is `level`, so a parser that only split
    // on '\n' would leave every row's level value as `6"\r` instead of `6`.
    const csv = '"word_id","level"\r\n"1","6"\r\n';
    expect(parseSimpleCsv(csv)).toEqual([{ word_id: '1', level: '6' }]);
  });
});

describe('buildCefrWordLevels', () => {
  const words = [
    { word_id: '1', word: 'run' },
    { word_id: '2', word: 'Perspicacious' },
  ];

  it('keeps the EASIEST (lowest-scoring) sense across multiple part-of-speech entries for the same word', () => {
    const wordPos = [
      { word_id: '1', level: '3.5', frequency_count: '100' }, // noun sense
      { word_id: '1', level: '1.2', frequency_count: '50' }, // verb sense - easier
    ];
    const result = buildCefrWordLevels(words, wordPos);
    expect(result.get('run')).toEqual({ level: 1.2, frequency: 50 });
  });

  it('keeps the higher frequency entry when two senses tie on level', () => {
    const wordPos = [
      { word_id: '1', level: '2', frequency_count: '10' },
      { word_id: '1', level: '2', frequency_count: '999' },
    ];
    const result = buildCefrWordLevels(words, wordPos);
    expect(result.get('run')).toEqual({ level: 2, frequency: 999 });
  });

  it('is case-insensitive when keying by word text', () => {
    const wordPos = [{ word_id: '2', level: '6', frequency_count: '5' }];
    const result = buildCefrWordLevels(words, wordPos);
    expect(result.has('perspicacious')).toBe(true);
  });

  it('skips word_pos rows referencing a word_id not present in the words list', () => {
    const wordPos = [{ word_id: '999', level: '1', frequency_count: '1' }];
    expect(buildCefrWordLevels(words, wordPos).size).toBe(0);
  });

  it('skips rows with a non-numeric level', () => {
    const wordPos = [{ word_id: '1', level: 'not-a-number', frequency_count: '1' }];
    expect(buildCefrWordLevels(words, wordPos).size).toBe(0);
  });
});

describe('joinCefrWithDefinitions', () => {
  it('keeps only CEFR words that also have a definition, case-insensitively, and drops the rest', () => {
    const cefrLevels = new Map([
      ['run', { level: 1.2, frequency: 50 }],
      ['perspicacious', { level: 6, frequency: 5 }],
      ['nodefinition', { level: 2, frequency: 1 }],
    ]);
    const definitionsPool: VocabEntry[] = [
      { term: 'Run', definitions: ['To move fast on foot'] },
      { term: 'Perspicacious', definitions: ['Having keen judgment'] },
    ];

    const joined = joinCefrWithDefinitions(cefrLevels, definitionsPool);
    expect(joined.length).toBe(2);
    expect(joined.find((e) => e.term === 'Run')).toMatchObject({
      cefrLevel: 1.2,
      cefrTier: 'A1',
      frequency: 50,
      definitions: ['To move fast on foot'],
    });
    expect(joined.find((e) => e.term === 'Perspicacious')?.cefrTier).toBe('C2');
  });
});

describe('groupAndSortByTier', () => {
  it('groups entries by rounded tier and sorts each tier by score ascending, then frequency descending', () => {
    const entries: CefrVocabEntry[] = [
      { term: 'b', definitions: ['B def'], cefrLevel: 1.4, cefrTier: 'A1', frequency: 10 },
      { term: 'a', definitions: ['A def'], cefrLevel: 1.1, cefrTier: 'A1', frequency: 5 },
      { term: 'c', definitions: ['C def'], cefrLevel: 1.1, cefrTier: 'A1', frequency: 500 }, // ties 'a' on score, wins on frequency
      { term: 'z', definitions: ['Z def'], cefrLevel: 6, cefrTier: 'C2', frequency: 1 },
    ];

    const grouped = groupAndSortByTier(entries);
    expect(grouped.get('A1')!.map((e) => e.term)).toEqual(['c', 'a', 'b']);
    expect(grouped.get('C2')!.map((e) => e.term)).toEqual(['z']);
    expect(grouped.get('B1')).toEqual([]); // present but empty - no B1 entries given
  });

  it('returns all 6 tiers as map keys, in A1->C2 order, even when some tiers have no entries', () => {
    const grouped = groupAndSortByTier([]);
    expect([...grouped.keys()]).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest tests/scripts/cefrVocabulary.test.ts`
Expected: FAIL — `backend/scripts/cefrVocabulary.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `backend/scripts/cefrVocabulary.ts`:

```ts
// backend/scripts/cefrVocabulary.ts
import { promises as fs } from 'fs';
import { VocabEntry } from './importEnglishVocabulary';

export interface CefrWordInfo {
  level: number; // continuous CEFR difficulty score: 1.0 (easiest) .. 6.0 (hardest)
  frequency: number;
}

export type CefrTier = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

const TIER_LABELS: CefrTier[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export function tierForLevel(level: number): CefrTier {
  const rounded = Math.min(6, Math.max(1, Math.round(level)));
  return TIER_LABELS[rounded - 1];
}

// Minimal CSV parser matched to this specific dataset's shape (every field
// double-quoted, no embedded commas/quotes within a field, one row per
// line) - not a general-purpose CSV parser, don't reuse it for arbitrary
// CSV input.
export function parseSimpleCsv(content: string): Record<string, string>[] {
  // Splits on CRLF or LF, and trims the parts before checking for
  // surrounding quotes - defensive against Windows checkouts re-writing
  // line endings (backend/data/*.csv is pinned to `eol=lf` in
  // .gitattributes precisely so this never actually happens in practice,
  // but a parser that only handles LF would otherwise silently corrupt the
  // LAST column of every row - word_pos.csv's last column is `level`, the
  // exact field this whole feature's difficulty ordering depends on).
  const lines = content.split(/\r\n|\n/).filter((line) => line.length > 0);
  const stripQuotes = (value: string) => value.trim().replace(/^"|"$/g, '');
  const header = lines[0].split(',').map(stripQuotes);
  return lines.slice(1).map((line) => {
    const values = line.split(',').map(stripQuotes);
    const row: Record<string, string> = {};
    header.forEach((h, i) => {
      row[h] = values[i] ?? '';
    });
    return row;
  });
}

// For every distinct word (case-insensitive) across all its part-of-speech
// senses, keeps the EASIEST sense (lowest continuous CEFR score) - a word
// that's simple in its most common sense shouldn't be excluded from an
// early level just because a rarer sense of the same word scores harder
// elsewhere. Ties on score keep whichever entry has the higher frequency.
export function buildCefrWordLevels(
  words: Record<string, string>[],
  wordPos: Record<string, string>[]
): Map<string, CefrWordInfo> {
  const wordById = new Map(words.map((w) => [w.word_id, w.word]));
  const result = new Map<string, CefrWordInfo>();

  for (const wp of wordPos) {
    const term = wordById.get(wp.word_id);
    if (!term) continue;
    const level = parseFloat(wp.level);
    const frequency = parseInt(wp.frequency_count, 10) || 0;
    if (!Number.isFinite(level)) continue;

    const key = term.toLowerCase();
    const existing = result.get(key);
    if (!existing || level < existing.level) {
      result.set(key, { level, frequency });
    } else if (level === existing.level && frequency > existing.frequency) {
      existing.frequency = frequency;
    }
  }

  return result;
}

export interface CefrVocabEntry extends VocabEntry {
  cefrLevel: number;
  cefrTier: CefrTier;
  frequency: number;
}

// Joins the CEFR word->level map against the existing definitions pool
// (case-insensitive, exact word-text match - no lemmatization) and keeps
// only words present in both. CEFR words with no matching definition, and
// definitions-pool words with no CEFR entry, are both dropped - only the
// intersection ships (per the design spec's "full replace, CEFR-tagged
// only" decision).
export function joinCefrWithDefinitions(
  cefrLevels: Map<string, CefrWordInfo>,
  definitionsPool: VocabEntry[]
): CefrVocabEntry[] {
  const defsByTerm = new Map<string, VocabEntry>();
  for (const entry of definitionsPool) {
    const key = entry.term.toLowerCase();
    if (!defsByTerm.has(key)) defsByTerm.set(key, entry);
  }

  const joined: CefrVocabEntry[] = [];
  for (const [term, info] of cefrLevels.entries()) {
    const defEntry = defsByTerm.get(term);
    if (!defEntry) continue;
    joined.push({
      term: defEntry.term,
      definitions: defEntry.definitions,
      cefrLevel: info.level,
      cefrTier: tierForLevel(info.level),
      frequency: info.frequency,
    });
  }
  return joined;
}

// Groups by rounded tier (A1..C2) and sorts each tier's words by continuous
// CEFR score ascending (finer-grained than the 6 rounded tiers), then by
// frequency descending as a tie-break. Returns all 6 tiers as map keys (even
// empty ones) in A1->C2 order - this order is exactly the order
// importEnglishVocabulary.ts's main() must insert rows in, since
// questionRepository.ts's getQuestionsForLevel maps level->questions purely
// by `id` order and is NOT modified by this feature.
export function groupAndSortByTier(entries: CefrVocabEntry[]): Map<CefrTier, CefrVocabEntry[]> {
  const byTier = new Map<CefrTier, CefrVocabEntry[]>();
  for (const tier of TIER_LABELS) byTier.set(tier, []);
  for (const entry of entries) byTier.get(entry.cefrTier)!.push(entry);

  for (const tier of TIER_LABELS) {
    byTier.get(tier)!.sort((a, b) => a.cefrLevel - b.cefrLevel || b.frequency - a.frequency);
  }
  return byTier;
}

export async function loadCefrCsvFiles(wordsPath: string, wordPosPath: string): Promise<Map<string, CefrWordInfo>> {
  const [wordsContent, wordPosContent] = await Promise.all([
    fs.readFile(wordsPath, 'utf8'),
    fs.readFile(wordPosPath, 'utf8'),
  ]);
  return buildCefrWordLevels(parseSimpleCsv(wordsContent), parseSimpleCsv(wordPosContent));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/scripts/cefrVocabulary.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Run the full backend suite and typecheck**

Run: `cd backend && npx jest`
Expected: PASS (note: this suite has known pre-existing, unrelated flakiness in `tests/matchmaking/matchmaker.test.ts`/`tests/matchmaking/concurrent-join.test.ts`/`tests/admin/statsQueries.test.ts` caused by parallel Jest workers sharing one real Postgres database — if you see a failure ONLY in one of those files, re-run once or twice to confirm it's not a real regression)

Run: `cd backend && npx tsc --noEmit`
Expected: clean, zero errors

- [ ] **Step 6: Commit**

```bash
cd backend
git add scripts/cefrVocabulary.ts tests/scripts/cefrVocabulary.test.ts
git commit -m "Add cefrVocabulary module: CEFR CSV loading, definitions join, tier grouping"
```

Note: `backend/data/cefr-words.csv` and `backend/data/cefr-word-pos.csv` are already bundled in the repo (see this plan's header) - do not add/modify them in this task.

---

### Task 3: Backend — rewrite `importEnglishVocabulary.ts` for the CEFR-based full replace

**Files:**
- Modify: `backend/scripts/importEnglishVocabulary.ts`

This is the task that actually changes what gets imported. `pickRandomDistractors`, `buildQuestionRow`, and `shuffleInPlace` (and their existing tests in `backend/tests/scripts/importEnglishVocabulary.test.ts`) are **NOT modified** - their signatures already accept an arbitrary `pool: VocabEntry[]`, so the only change needed is what pool gets passed in at each call site (a single tier's word list, instead of the whole 466k-entry list).

- [ ] **Step 1: Confirm the existing tests still pass unmodified (baseline check)**

Run: `cd backend && npx jest tests/scripts/importEnglishVocabulary.test.ts`
Expected: PASS (13 tests, all pre-existing - this task must not break any of them, since it doesn't touch the functions they test)

- [ ] **Step 2: Implement**

Read the ACTUAL current `backend/scripts/importEnglishVocabulary.ts` in full first (to confirm the exact current shape of `assertNotAlreadyImported`, `ensureParquetFile`, `loadVocabEntries`, `insertQuestionRows`, and `main`, since this task replaces large parts of them), then apply these changes:

1. Add the import (alongside the existing ones):
```ts
import { loadCefrCsvFiles, joinCefrWithDefinitions, groupAndSortByTier, CefrVocabEntry, CefrTier } from './cefrVocabulary';
```

2. Add these two constants alongside the existing `BUNDLED_PARQUET_PATH`:
```ts
// Unlike BUNDLED_PARQUET_PATH (which exists because the parquet dataset
// originally had to be *downloaded* and only got bundled later as a
// network-independence fix), these two CEFR CSVs were bundled from day
// one - there's no staged-file/download-fallback tier for them, they're
// just always read directly from here.
const CEFR_WORDS_CSV_PATH = path.join(__dirname, '..', 'data', 'cefr-words.csv');
const CEFR_WORD_POS_CSV_PATH = path.join(__dirname, '..', 'data', 'cefr-word-pos.csv');
const TIER_ORDER: CefrTier[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
```

3. Delete the entire `assertNotAlreadyImported` function - it enforced the OLD "never re-import" guard, which is the opposite of what this script does now (it always fully replaces).

4. Add this replacement guard function in its place:
```ts
// Full replace is destructive (drops every existing ingliz_tili row and all
// level_progress), so it requires an explicit CLI flag rather than running
// automatically - this can never be fired by accident the way a bare `node
// dist/scripts/importEnglishVocabulary.js` used to be safe-by-default
// (refusing if data already existed). Run as: node
// dist/scripts/importEnglishVocabulary.js --confirm-replace
function assertConfirmedReplace(): void {
  if (!process.argv.includes('--confirm-replace')) {
    throw new Error(
      `This import FULLY REPLACES the '${CATEGORY_KEY}' question pool and clears level_progress for every user. ` +
        `Re-run with --confirm-replace to proceed, e.g.: node dist/scripts/importEnglishVocabulary.js --confirm-replace`
    );
  }
}
```

5. Leave `BuiltQuestionRow` and `buildQuestionRow`'s body completely untouched (it's generic over any `VocabEntry`-shaped pool and doesn't know about tiers). Add a separate, wider type that `main()` uses for what actually gets inserted, right above `insertQuestionRows`:
```ts
interface QuestionRowWithTier extends BuiltQuestionRow {
  cefrTier: CefrTier;
}
```
(`main()` builds this by spreading `buildQuestionRow`'s return value and adding `cefrTier` itself, per Step 7 below - this does NOT change `buildQuestionRow`'s signature or behavior, and does NOT affect `pickRandomDistractors`, `shuffleInPlace`, or their existing tests, none of which construct a `BuiltQuestionRow`/`QuestionRowWithTier` object literal themselves.)

6. Update `insertQuestionRows` to accept the wider type and include `cefr_level` in the insert:
```ts
async function insertQuestionRows(rows: QuestionRowWithTier[]): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE);
    const values: unknown[] = [];
    const placeholders = chunk
      .map((row, idx) => {
        const base = idx * 6;
        values.push(
          CATEGORY_KEY,
          row.text,
          JSON.stringify(row.options),
          row.correctIndex,
          JSON.stringify(row.extraDefinitions),
          row.cefrTier
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
      })
      .join(', ');
    await pool.query(
      `INSERT INTO questions (category, question_text, options, correct_index, extra_definitions, cefr_level) VALUES ${placeholders}`,
      values
    );
    console.log(`Inserted ${Math.min(i + INSERT_CHUNK_SIZE, rows.length)}/${rows.length} rows`);
  }
}
```

7. Replace `main()`'s body:
```ts
async function main(): Promise<void> {
  assertConfirmedReplace();

  const parquetPath = path.join(os.tmpdir(), 'english-words-definitions.parquet');

  try {
    console.log(`Deleting existing '${CATEGORY_KEY}' questions and all level_progress...`);
    const deleted = await pool.query(`DELETE FROM questions WHERE category = $1`, [CATEGORY_KEY]);
    console.log(`Deleted ${deleted.rowCount} existing '${CATEGORY_KEY}' rows.`);
    await pool.query(`DELETE FROM level_progress`);

    await ensureParquetFile(parquetPath);

    console.log('Parsing definitions dataset...');
    const definitionsPool = await loadVocabEntries(parquetPath);
    console.log(`Loaded ${definitionsPool.length} definitions entries`);

    console.log('Loading CEFR word levels...');
    const cefrLevels = await loadCefrCsvFiles(CEFR_WORDS_CSV_PATH, CEFR_WORD_POS_CSV_PATH);
    console.log(`Loaded CEFR levels for ${cefrLevels.size} distinct words`);

    console.log('Joining CEFR words with definitions...');
    const joined = joinCefrWithDefinitions(cefrLevels, definitionsPool);
    console.log(`Matched ${joined.length} CEFR words with a definition`);

    const byTier = groupAndSortByTier(joined);

    console.log('Building question rows per tier (in A1 -> C2 insertion order)...');
    const rows: QuestionRowWithTier[] = [];
    for (const tier of TIER_ORDER) {
      const tierEntries: CefrVocabEntry[] = byTier.get(tier)!;
      console.log(`  ${tier}: ${tierEntries.length} words -> ${Math.floor(tierEntries.length / 15)} levels`);
      tierEntries.forEach((entry, index) => {
        const row = buildQuestionRow(entry, index, tierEntries);
        rows.push({ ...row, cefrTier: tier });
      });
    }

    console.log(`Inserting ${rows.length} question rows into the database...`);
    await insertQuestionRows(rows);

    console.log('Done.');
  } finally {
    await fs.unlink(parquetPath).catch(() => {});
    await pool.end();
  }
}
```

Note: `shuffleInPlace(entries)` (the old random top-level shuffle, applied to the WHOLE 466k-entry pool before building rows) is gone - it's no longer needed, since the new tier-then-frequency ordering IS the desired final order, and `buildQuestionRow`'s own internal option-shuffle (unrelated, shuffles which of the 4 answer slots is correct) still runs exactly as before, untouched.

- [ ] **Step 3: Run the existing tests again to confirm nothing broke**

Run: `cd backend && npx jest tests/scripts/importEnglishVocabulary.test.ts`
Expected: PASS (same 13 tests as Step 1 - `pickRandomDistractors`/`buildQuestionRow`/`shuffleInPlace` are untouched)

- [ ] **Step 4: Run the full backend suite and typecheck**

Run: `cd backend && npx jest` — expect PASS (accounting for known flakiness noted in Task 2)
Run: `cd backend && npx tsc --noEmit` — expect clean

- [ ] **Step 5: Commit**

```bash
cd backend
git add scripts/importEnglishVocabulary.ts
git commit -m "Rewrite English vocabulary import to build CEFR-tiered levels with a full-replace guard"
```

**Do NOT actually run this script against any real database in this task** (local or production) - that's a deliberate, separate, manual step described in "After all tasks" below, run only once all 6 tasks are implemented, reviewed, and merged.

---

### Task 4: Backend — `getLevelTierBoundaries` in `questionRepository.ts`

**Files:**
- Modify: `backend/src/questions/questionRepository.ts`
- Modify: `backend/tests/questions/questionRepository.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/questions/questionRepository.test.ts`, inside the existing `describe('questionRepository', ...)` block:

```ts
  describe('getLevelTierBoundaries', () => {
    // These tests insert their OWN small, clearly-tagged batch of
    // ingliz_tili rows with a real cefr_level set, then clean them up
    // afterward - the category's real bulk-imported rows (whether the old
    // untiered 466k set or, later, the new CEFR-tiered set) all have
    // question_text values that could never collide with these fixture
    // strings, so this is safe to run against the same shared category the
    // rest of this file's tests use.
    const FIXTURE_MARKER = 'CEFR_BOUNDARY_TEST_FIXTURE';

    afterEach(async () => {
      await pool.query(`DELETE FROM questions WHERE question_text LIKE $1`, [`${FIXTURE_MARKER}%`]);
    });

    async function insertFixtureRows(cefrLevel: string, count: number): Promise<void> {
      for (let i = 0; i < count; i += 1) {
        await pool.query(
          `INSERT INTO questions (category, question_text, options, correct_index, cefr_level)
           VALUES ($1, $2, $3, $4, $5)`,
          ['ingliz_tili', `${FIXTURE_MARKER}_${cefrLevel}_${i}`, JSON.stringify(['a', 'b', 'c', 'd']), 0, cefrLevel]
        );
      }
    }

    it('returns no boundaries when there are no cefr_level-tagged rows yet', async () => {
      // The real category's bulk-imported rows (pre-CEFR-migration) all have
      // cefr_level IS NULL, so with no fixture rows inserted, this must be
      // empty - proving the function genuinely filters on cefr_level rather
      // than returning something derived from the whole (untagged) category.
      expect(await getLevelTierBoundaries()).toEqual([]);
    });

    it('computes contiguous level ranges per tier, in insertion order, from row counts alone', async () => {
      await insertFixtureRows('A1', 15); // exactly 1 full level
      await insertFixtureRows('A2', 30); // exactly 2 full levels

      const boundaries = await getLevelTierBoundaries();
      // Only these two fixture tiers should be present - real bulk category
      // data (if any exists in this environment) is untagged (cefr_level
      // NULL) and is excluded by definition.
      expect(boundaries).toEqual([
        { tier: 'A1', fromLevel: 1, toLevel: 1 },
        { tier: 'A2', fromLevel: 2, toLevel: 3 },
      ]);
    });

    it('rounds a tier with a partial (non-multiple-of-15) row count up to include the shared boundary level', async () => {
      // 20 rows = 1 full level (15) + 5 leftover rows that spill into a
      // second, partially-shared level - this is an accepted, documented
      // simplification (see the design spec's Risks section): a level
      // straddling a tier boundary may contain words from two tiers, and
      // both tiers legitimately claim it via an overlapping toLevel/
      // fromLevel, rather than either tier silently losing those rows from
      // every boundary computation.
      await insertFixtureRows('B1', 20);

      const boundaries = await getLevelTierBoundaries();
      expect(boundaries).toEqual([{ tier: 'B1', fromLevel: 1, toLevel: 2 }]);
    });
  });
```

Add `getLevelTierBoundaries` to the existing import line at the top of the test file (alongside `getQuestionsForLevel`, `maxAvailableLevel`, etc.).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest tests/questions/questionRepository.test.ts -t "getLevelTierBoundaries"`
Expected: FAIL — `getLevelTierBoundaries` doesn't exist yet.

- [ ] **Step 3: Implement**

Add to `backend/src/questions/questionRepository.ts`, after `maxAvailableLevel`:

```ts
export interface LevelTierBoundary {
  tier: string;
  fromLevel: number;
  toLevel: number;
}

// Computes which level numbers fall in which CEFR tier, purely from how
// many ingliz_tili rows exist per tier and the order tiers were inserted in
// (importEnglishVocabulary.ts inserts one tier's rows fully before moving to
// the next - see the CEFR vocabulary design spec). Six rows at most (one
// per tier actually present), cheap to compute per request - no caching
// needed at this scale.
//
// A tier whose row count isn't an exact multiple of 15 leaves a "leftover"
// handful of rows that get absorbed into a level shared with the NEXT
// tier - fromLevel/toLevel are computed cumulatively (not per-tier in
// isolation) so that shared boundary level is honestly reflected as
// belonging to both tiers' ranges, rather than either tier's leftover rows
// silently vanishing from the tally. This never drifts from
// maxAvailableLevel()'s independent floor(totalCount/15) total, since every
// row is still counted exactly once towards SOME tier's cumulative total.
export async function getLevelTierBoundaries(): Promise<LevelTierBoundary[]> {
  const result = await pool.query<{ cefr_level: string; count: string }>(
    `SELECT cefr_level, COUNT(*) AS count
     FROM questions WHERE category = $1 AND cefr_level IS NOT NULL
     GROUP BY cefr_level ORDER BY MIN(id) ASC`,
    [LEVEL_CATEGORY_KEY]
  );

  const boundaries: LevelTierBoundary[] = [];
  let cumulativeRows = 0;
  for (const row of result.rows) {
    const fromLevel = Math.floor(cumulativeRows / LEVEL_QUESTION_COUNT) + 1;
    cumulativeRows += Number(row.count);
    const toLevel = Math.ceil(cumulativeRows / LEVEL_QUESTION_COUNT);
    boundaries.push({ tier: row.cefr_level, fromLevel, toLevel });
  }
  return boundaries;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/questions/questionRepository.test.ts`
Expected: PASS (all tests, including the new ones)

- [ ] **Step 5: Run the full backend suite and typecheck**

Run: `cd backend && npx jest` — expect PASS (accounting for known flakiness)
Run: `cd backend && npx tsc --noEmit` — expect clean

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/questions/questionRepository.ts tests/questions/questionRepository.test.ts
git commit -m "Add getLevelTierBoundaries to questionRepository"
```

---

### Task 5: Backend — `tierBoundaries` in `GET /level-progress`

**Files:**
- Modify: `backend/src/game/levelProgressRoutes.ts`
- Modify: `backend/tests/game/levelProgressRoutes.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/game/levelProgressRoutes.test.ts`, inside the existing `describe('GET /api/level-progress', ...)` block:

```ts
  it('includes tierBoundaries in the response (empty when no cefr_level rows exist yet)', async () => {
    const res = await request(app).get('/api/level-progress').set('Authorization', `Bearer ${token}`);
    expect(Array.isArray(res.body.tierBoundaries)).toBe(true);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest tests/game/levelProgressRoutes.test.ts -t "tierBoundaries"`
Expected: FAIL — `res.body.tierBoundaries` is `undefined`, not an array.

- [ ] **Step 3: Implement**

In `backend/src/game/levelProgressRoutes.ts`:

```ts
import { Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../auth/authMiddleware';
import { getLevelProgressForUser } from './levelProgress';
import { maxAvailableLevel, getLevelTierBoundaries } from '../questions/questionRepository';

export const levelProgressRouter = Router();

levelProgressRouter.get('/level-progress', requireAuth, async (req: AuthenticatedRequest, res) => {
  const [progress, max, tierBoundaries] = await Promise.all([
    getLevelProgressForUser(req.userId!),
    maxAvailableLevel(),
    getLevelTierBoundaries(),
  ]);
  res.json({ progress, maxAvailableLevel: max, tierBoundaries });
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/game/levelProgressRoutes.test.ts`
Expected: PASS (all tests, including the new one)

- [ ] **Step 5: Run the full backend suite and typecheck**

Run: `cd backend && npx jest` — expect PASS (accounting for known flakiness)
Run: `cd backend && npx tsc --noEmit` — expect clean

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/game/levelProgressRoutes.ts tests/game/levelProgressRoutes.test.ts
git commit -m "Include tierBoundaries in GET /level-progress"
```

---

### Task 6: Frontend — tier badge on `LevelSelectScreen`

**Files:**
- Modify: `frontend/src/api/levelProgress.ts`
- Modify: `frontend/src/screens/LevelSelectScreen.tsx`
- Modify: `frontend/src/screens/LevelSelectScreen.test.tsx`

- [ ] **Step 1: Update the API types**

Replace `frontend/src/api/levelProgress.ts` in full:

```ts
// frontend/src/api/levelProgress.ts
import { apiGet } from './client';

export interface LevelProgressEntry {
  levelNumber: number;
  stars: number;
}

export interface LevelTierBoundary {
  tier: string;
  fromLevel: number;
  toLevel: number;
}

export interface LevelProgressResponse {
  progress: LevelProgressEntry[];
  maxAvailableLevel: number;
  tierBoundaries: LevelTierBoundary[];
}

export function getLevelProgress(token: string): Promise<LevelProgressResponse> {
  return apiGet<LevelProgressResponse>('/level-progress', token);
}
```

- [ ] **Step 2: Write the failing tests**

Read `frontend/src/screens/LevelSelectScreen.test.tsx` in full first (each existing test's mocked `getLevelProgress` resolved value needs a `tierBoundaries` field added, or the new badge-rendering test below will be the only one exercising it and the rest can pass `tierBoundaries: []` for a no-badge baseline - update every existing mock's resolved value to include `tierBoundaries: []` so none of them break once the component reads that field). Add this new test:

```tsx
  it('shows the CEFR tier badge on each level card, based on tierBoundaries', async () => {
    vi.spyOn(levelProgressApi, 'getLevelProgress').mockResolvedValue({
      progress: [],
      maxAvailableLevel: 3,
      tierBoundaries: [{ tier: 'A1', fromLevel: 1, toLevel: 2 }, { tier: 'A2', fromLevel: 3, toLevel: 3 }],
    });

    render(<LevelSelectScreen intent="quick" />);
    await screen.findByText('1');

    // Anchored (not just /1/, /3/): the badge text itself (e.g. "A1") can
    // contain a digit that collides with an unanchored level-number match
    // (level 2's card here reads "2 A1" - /1/ would match it too).
    const level1Button = screen.getByRole('button', { name: /^1/ });
    const level3Button = screen.getByRole('button', { name: /^3/ });
    expect(level1Button).toHaveTextContent('A1');
    expect(level3Button).toHaveTextContent('A2');
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/screens/LevelSelectScreen.test.tsx`
Expected: FAIL — the new test fails (no badge rendered yet), and every other existing test in this file still passes at this point (adding `tierBoundaries: []` to their mocks doesn't change any assertion, it just keeps their mock's shape valid once the component starts reading that field in Step 4).

- [ ] **Step 4: Implement**

In `frontend/src/screens/LevelSelectScreen.tsx`:

1. Import the new type:
```ts
import { getLevelProgress, LevelProgressEntry, LevelTierBoundary } from '../api/levelProgress';
```

2. Add state for it, next to the existing `maxAvailableLevel` state:
```ts
  const [tierBoundaries, setTierBoundaries] = useState<LevelTierBoundary[]>([]);
```

3. In the existing `getLevelProgress(token).then(...)` block, also set it:
```ts
      .then((res) => {
        if (cancelled) return;
        setProgress(res.progress);
        setMaxAvailableLevel(res.maxAvailableLevel);
        setTierBoundaries(res.tierBoundaries);
      })
```

4. Add this helper function above the component (or inside it, above the render — match whichever placement convention `isLevelUnlocked` already uses in this file):
```ts
// Linear scan over at most 6 entries per level card - cheap, no memoization
// needed. A level can appear in two tiers' ranges at once (see
// getLevelTierBoundaries' doc comment on shared boundary levels) - find()
// returns the first (earlier, easier) match, which is a harmless,
// intentional simplification for this cosmetic badge.
function tierForLevel(level: number, tierBoundaries: LevelTierBoundary[]): string | null {
  return tierBoundaries.find((b) => level >= b.fromLevel && level <= b.toLevel)?.tier ?? null;
}
```

5. In the level-card render loop, compute and show the badge (add this right after the existing `const played = progressByLevel.has(level);` line, and render it in the JSX below the level number span):
```tsx
              const unlocked = isLevelUnlocked(level, progressByLevel);
              const stars = progressByLevel.get(level) ?? 0;
              const played = progressByLevel.has(level);
              const tier = tierForLevel(level, tierBoundaries);
              return (
                <button
                  key={level}
                  type="button"
                  disabled={!unlocked}
                  onClick={() => handleSelect(level)}
                  className={`flex flex-col items-center gap-1 rounded-2xl py-3 font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)] transition-transform duration-150 active:scale-[0.96] disabled:active:scale-100 ${
                    unlocked ? 'bg-ios-card text-ios-label' : 'bg-ios-card text-ios-secondary-label opacity-50'
                  }`}
                >
                  <span>{level}</span>
                  {tier && <span className="text-[10px] font-medium text-ios-secondary-label">{tier}</span>}
                  {played && (
                    <span className="text-xs text-ios-gold">{'★'.repeat(stars)}{'☆'.repeat(3 - stars)}</span>
                  )}
                </button>
              );
```

Nothing else in this file changes — `isLevelUnlocked`, `handleSelect`, the loading/error branches, and the stage-grouping logic are all untouched.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/screens/LevelSelectScreen.test.tsx`
Expected: PASS (all tests, both new and pre-existing)

- [ ] **Step 6: Run the full frontend suite and typecheck**

Run: `cd frontend && npx vitest run` — expect PASS
Run: `cd frontend && npx tsc --noEmit` — expect clean

- [ ] **Step 7: Commit**

```bash
cd frontend
git add src/api/levelProgress.ts src/screens/LevelSelectScreen.tsx src/screens/LevelSelectScreen.test.tsx
git commit -m "Show CEFR tier badge on level cards in LevelSelectScreen"
```

---

## After all 6 tasks

Run the full verification sweep once more (`backend`: `npx jest`, `npx tsc --noEmit`; `frontend`: `npx vitest run`, `npx tsc --noEmit && npm run build`), then dispatch a final holistic reviewer re-checking:
- `getQuestionsForLevel`/`maxAvailableLevel` are genuinely byte-identical to before this plan (no accidental edits) — the whole design hinges on them NOT needing to change.
- `pickRandomDistractors`/`buildQuestionRow`/`shuffleInPlace` and their existing tests in `importEnglishVocabulary.test.ts` are genuinely untouched.
- `getLevelTierBoundaries`'s boundary math is exercised against fixture data, not just trusted from a docstring.
- The frontend's `tierForLevel` badge lookup degrades gracefully (no crash, no badge shown) when `tierBoundaries` is empty — the state immediately after these 6 tasks land but *before* the real data migration (below) is run.

### Running the real data migration (manual, deliberate, NOT part of the automated task loop)

This plan's code changes are safe to deploy on their own — until the import script is actually re-run, `cefr_level` stays NULL on every row and `tierBoundaries` stays empty, so nothing about existing gameplay changes yet. The destructive step is separate and must be run deliberately, once, by a human:

1. Deploy this plan's code changes normally (`bash scripts/deploy.sh`, which runs `node dist/src/db/migrate.js` and picks up the new `cefr_level` column automatically, same as every other migration).
2. Locally first: run `cd backend && npm run build && node dist/scripts/importEnglishVocabulary.js --confirm-replace` against your **local** dev database and sanity-check the row counts logged per tier match this plan's header numbers (A1 ~6,394, A2 ~8,410, B1 ~13,046, B2 ~13,211, C1 ~5,759, C2 ~125,947) before ever touching production.
3. On the server: the deploy script already takes a DB backup before every deploy (see `scripts/deploy.sh`'s Step 2), so a recent backup will exist. Run: `sudo docker compose exec api node dist/scripts/importEnglishVocabulary.js --confirm-replace`.
4. Confirm via the app that `LevelSelectScreen` now shows tier badges and level 1 is a genuinely common word (e.g. "the", "of", "run" - not "turriculated").

No `--confirm-replace` run should ever happen as an unattended part of a routine redeploy — it belongs in this manual checklist only.
