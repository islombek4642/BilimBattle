import { pool } from '../config/db';

// Full server-side record, includes the correct answer — must not be sent to
// players as-is; any client-facing payload must strip `correctIndex` first.
export interface QuestionRecord {
  id: number;
  text: string;
  options: string[];
  correctIndex: number;
  extraDefinitions?: string[];
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
  const slug = label
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  // A label with no ASCII letters/digits at all (e.g. a purely Cyrillic name,
  // or pure punctuation) would otherwise slugify to '' - fall back to a
  // non-empty placeholder so createCategory never inserts an empty key.
  return slug || 'category';
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

interface QuestionRow {
  id: number;
  question_text: string;
  options: string[];
  correct_index: number;
  extra_definitions: string[] | null;
}

function toQuestionRecord(row: QuestionRow): QuestionRecord {
  return {
    id: row.id,
    text: row.question_text,
    options: row.options,
    correctIndex: row.correct_index,
    ...(row.extra_definitions && row.extra_definitions.length > 0 ? { extraDefinitions: row.extra_definitions } : {}),
  };
}

export async function getRandomQuestions(category: string, count: number): Promise<QuestionRecord[]> {
  const boundsResult = await pool.query<{ min_id: number | null; max_id: number | null }>(
    `SELECT MIN(id) AS min_id, MAX(id) AS max_id FROM questions WHERE category = $1`,
    [category]
  );
  const { min_id: minId, max_id: maxId } = boundsResult.rows[0];
  if (minId === null || maxId === null) return [];

  // Picking a uniformly random point within the category's id range and
  // taking the next `count` rows by id order lets Postgres use an index
  // range scan (via idx_questions_category_id) instead of the O(n log n)
  // full-table sort that `ORDER BY RANDOM()` requires - for a 466k-row
  // category this is the difference between ~337ms and a few milliseconds
  // per match start. ids aren't perfectly contiguous within one category
  // (rows from other categories are interleaved by insertion order), so
  // this isn't a mathematically perfect uniform sample the way ORDER BY
  // RANDOM() is, but it's a standard, well-accepted trade-off for this kind
  // of workload and is more than random enough for picking quiz questions.
  const randomStart = minId + Math.floor(Math.random() * (maxId - minId + 1));

  const forwardResult = await pool.query<QuestionRow>(
    `SELECT id, question_text, options, correct_index, extra_definitions
     FROM questions WHERE category = $1 AND id >= $2 ORDER BY id ASC LIMIT $3`,
    [category, randomStart, count]
  );

  let rows = forwardResult.rows;
  if (rows.length < count) {
    // The random start point was close enough to the category's max id that
    // there weren't `count` rows at or after it - wrap around and fill the
    // rest from just BEFORE the start point, walking backwards (closest
    // first), so the final set is still a contiguous-ish window around the
    // random point rather than always falling back to "the very first rows
    // of the category" whenever this happens.
    const remaining = count - rows.length;
    const wrapResult = await pool.query<QuestionRow>(
      `SELECT id, question_text, options, correct_index, extra_definitions
       FROM questions WHERE category = $1 AND id < $2 ORDER BY id DESC LIMIT $3`,
      [category, randomStart, remaining]
    );
    rows = rows.concat(wrapResult.rows);
  }

  return rows.map(toQuestionRecord);
}
