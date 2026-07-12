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
      await pool.query(`DELETE FROM categories WHERE key LIKE 'category%'`);
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

    it('falls back to a non-empty key when the label has no Latin letters or digits', async () => {
      const category = await createCategory('Тарих');
      expect(category.key).toBe('category');
      expect(category.key).not.toBe('');
      expect(category.key.startsWith('_')).toBe(false);
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

  describe('getRandomQuestions wraparound behavior', () => {
    const category = 'test_repo_wraparound';

    beforeAll(async () => {
      // Defensive: if a previous run of this file was killed before its own
      // afterAll ran (CI timeout, manual interrupt), orphaned rows could
      // still be here, which would silently break the "returns fewer than
      // requested" assertion below (it expects exactly 5, not 5+leftover).
      await pool.query(`DELETE FROM questions WHERE category = $1`, [category]);
      await pool.query(`INSERT INTO categories (key, label) VALUES ($1, 'Test Wraparound') ON CONFLICT (key) DO NOTHING`, [category]);
      // 5 rows is deliberately small enough that SOME random draws will land
      // near the top of the id range and need the wraparound fallback to
      // still return the full requested count.
      for (let i = 0; i < 5; i += 1) {
        await pool.query(
          `INSERT INTO questions (category, question_text, options, correct_index) VALUES ($1, $2, '["a","b","c","d"]', 0)`,
          [category, `TEST_WRAP_${i}`]
        );
      }
    });

    afterAll(async () => {
      await pool.query(`DELETE FROM questions WHERE category = $1`, [category]);
      await pool.query(`DELETE FROM categories WHERE key = $1`, [category]);
    });

    it('always returns the requested count even when the random start point is near the end of the id range', async () => {
      // Run many draws - across enough attempts, some WILL land near the
      // max id and require the wraparound path; this asserts the count
      // invariant holds regardless of where the random point lands.
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const questions = await getRandomQuestions(category, 5);
        expect(questions.length).toBe(5);
        const ids = questions.map((q) => q.id);
        expect(new Set(ids).size).toBe(5); // no duplicates even after wraparound
      }
    });

    it('returns fewer than requested (not an error) when the category itself has fewer rows than requested', async () => {
      const questions = await getRandomQuestions(category, 10);
      expect(questions.length).toBe(5);
    });

    it('returns an empty array for a category with zero questions', async () => {
      const questions = await getRandomQuestions('test_repo_empty_category_xyz', 5);
      expect(questions).toEqual([]);
    });
  });

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

    it('treats an empty extra_definitions array the same as null (field absent)', async () => {
      await pool.query(
        `INSERT INTO questions (category, question_text, options, correct_index, extra_definitions)
         VALUES ('umumiy_bilim', 'TEST_REPO_EmptyExtra', '["a","b","c","d"]', 0, '[]')`
      );

      const questions = await getRandomQuestions('umumiy_bilim', 50);
      const emptyExtra = questions.find((q) => q.text === 'TEST_REPO_EmptyExtra');

      expect(emptyExtra?.extraDefinitions).toBeUndefined();
    });
  });
});
