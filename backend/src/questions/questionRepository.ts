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
