import { pool } from '../config/db';

export interface QuestionForClient {
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
