// backend/scripts/importEnglishVocabulary.ts
//
// Like backend/src/db/migrate.ts and backend/scripts/loadTest.ts, this is a
// standalone ts-node entry point, not something imported by the running app.
// env.ts (see backend/src/config/env.ts) deliberately does NOT call
// dotenv.config() itself - it expects the process environment to already be
// populated before it's imported. This file's CLI section below imports
// ../src/config/db, which imports env.ts, so this file's very first import
// MUST be 'dotenv/config', or the CLI run will throw "Missing required
// environment variable: DATABASE_URL" the moment it starts. (The pure
// functions below are also imported directly by
// tests/scripts/importEnglishVocabulary.test.ts, where Jest's own
// `setupFiles: ['dotenv/config']` already populates the environment before
// this import runs, so this line is a harmless no-op there.)
import 'dotenv/config';

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
  if (pool[entryIndex] !== entry) {
    throw new Error(`entryIndex ${entryIndex} does not match the given entry in pool - caller bug`);
  }
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

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pool } from '../src/config/db';

const DATASET_URL =
  'https://huggingface.co/api/datasets/MongoDB/english-words-definitions/parquet/default/train/0.parquet';
const CATEGORY_KEY = 'ingliz_tili';
const INSERT_CHUNK_SIZE = 500;

async function assertNotAlreadyImported(): Promise<void> {
  const existing = await pool.query('SELECT COUNT(*) FROM questions WHERE category = $1', [CATEGORY_KEY]);
  const count = Number(existing.rows[0].count);
  if (count > 0) {
    throw new Error(
      `${CATEGORY_KEY} already has ${count} questions - refusing to import again and duplicate them. ` +
        `Delete existing rows first if you really want to re-import (DELETE FROM questions WHERE category = '${CATEGORY_KEY}').`
    );
  }
}

async function downloadParquet(destPath: string): Promise<void> {
  const response = await fetch(DATASET_URL);
  if (!response.ok) {
    throw new Error(`Failed to download dataset: HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destPath, buffer);
}

// hyparquet's package.json exposes Node-only exports (incl. asyncBufferFromFile)
// via a conditional "exports" map that only resolves under moduleResolution
// "bundler"/"node16"/"nodenext" - this repo's tsconfig uses the classic "node"
// resolution, which instead reads the package's top-level "types" field
// (types/index.d.ts, the browser-oriented surface without asyncBufferFromFile).
// At runtime Node's own resolver does honor "exports" and the function is
// really there (verified: `Object.keys(await import('hyparquet'))` includes
// asyncBufferFromFile) - this type is just describing what's actually there.
type HyparquetNodeModule = {
  asyncBufferFromFile: (filename: string) => Promise<unknown>;
  parquetReadObjects: (options: { file: unknown }) => Promise<unknown[]>;
};

// tsc, when targeting this project's `"module": "CommonJS"`, rewrites even a
// literal `await import(...)` into `Promise.resolve().then(() =>
// require(...))` (verified directly: `ts.transpileModule` on
// `await import('x')` under module: CommonJS emits a `require('x')` call).
// hyparquet is ESM-only and its package.json "exports" map has no "require"
// condition, so that require() crashes at runtime with
// "ERR_PACKAGE_PATH_NOT_EXPORTED" (reproduced) - the exact class of failure
// Step 1 warned a *static* import would cause, except it turns out tsc
// downgrades dynamic imports the same way under this tsconfig, so a literal
// `import()` isn't actually safe here either. Wrapping the import in
// `new Function(...)` hides the import expression from tsc's transpiler (it
// only rewrites `import()` calls it can see as syntax, not opaque strings
// inside a function body it parses at runtime), so this really executes
// Node's native ESM dynamic import instead of require() - verified working
// against the real hyparquet package.
const importEsm = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<HyparquetNodeModule>;

async function loadVocabEntries(parquetPath: string): Promise<VocabEntry[]> {
  const { asyncBufferFromFile, parquetReadObjects } = await importEsm('hyparquet');
  const file = await asyncBufferFromFile(parquetPath);
  const rows = (await parquetReadObjects({ file })) as { term: string; definitions: string[] }[];
  // Defensive: the dataset is well-formed in practice, but an empty term or
  // an empty definitions array would produce a question with no correct
  // answer text or nothing to build a distractor from - skip rather than
  // crash the whole 466k-row import over a handful of bad rows.
  const entries = rows.filter((r) => r.term && r.definitions?.length > 0);
  if (entries.length < rows.length) {
    console.log(`Skipped ${rows.length - entries.length} malformed rows (empty term or no definitions)`);
  }
  return entries;
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
  const parquetPath = path.join(os.tmpdir(), 'english-words-definitions.parquet');

  try {
    await assertNotAlreadyImported();

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
  } finally {
    await fs.unlink(parquetPath).catch(() => {});
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Vocabulary import failed:', err);
    process.exit(1);
  });
}
