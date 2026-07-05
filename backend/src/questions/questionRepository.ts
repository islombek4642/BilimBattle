import { pool } from '../config/db';

// Full server-side record, includes the correct answer — must not be sent to
// players as-is; any client-facing payload must strip `correctIndex` first.
export interface QuestionRecord {
  id: number;
  text: string;
  options: string[];
  correctIndex: number;
}

export const CATEGORIES = [
  { key: 'umumiy_bilim', label: 'Umumiy bilim' },
  { key: 'sport_kino_musiqa', label: 'Sport/Kino/Musiqa' },
];

export function isValidCategory(key: string): boolean {
  return CATEGORIES.some((c) => c.key === key);
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
