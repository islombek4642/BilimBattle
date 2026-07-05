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
