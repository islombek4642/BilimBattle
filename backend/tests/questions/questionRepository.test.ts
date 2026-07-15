import { pool } from '../../src/config/db';
import {
  getRandomQuestions,
  isValidCategory,
  getCategories,
  getCategoryByKey,
  createCategory,
  insertQuestions,
  getQuestionsForLevel,
  maxAvailableLevel,
  getLevelTierBoundaries,
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

  describe('getQuestionsForLevel / maxAvailableLevel', () => {
    it('returns 15 sequential questions for level 1 starting at the category\'s lowest id', async () => {
      const level1 = await getQuestionsForLevel(1);
      expect(level1.length).toBe(15);
    });

    it('returns a DIFFERENT 15-question set for level 2 than for level 1 (no overlap)', async () => {
      const level1 = await getQuestionsForLevel(1);
      const level2 = await getQuestionsForLevel(2);
      const level1Ids = new Set(level1.map((q) => q.id));
      const overlap = level2.filter((q) => level1Ids.has(q.id));
      expect(overlap.length).toBe(0);
    });

    it('returns the exact same 15 questions when called again for the same level (deterministic, unlike getRandomQuestions)', async () => {
      const first = await getQuestionsForLevel(5);
      const second = await getQuestionsForLevel(5);
      expect(first.map((q) => q.id)).toEqual(second.map((q) => q.id));
    });

    it('maxAvailableLevel reflects the real ingliz_tili question count (floor(count / 15))', async () => {
      const countResult = await pool.query(`SELECT COUNT(*) FROM questions WHERE category = 'ingliz_tili'`);
      const expected = Math.floor(Number(countResult.rows[0].count) / 15);
      expect(await maxAvailableLevel()).toBe(expected);
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

  describe('cefrLevel on QuestionRecord', () => {
    const FIXTURE_CATEGORY = 'test_repo_cefr_field_xyz';

    afterEach(async () => {
      await pool.query(`DELETE FROM questions WHERE category = $1`, [FIXTURE_CATEGORY]);
    });

    it('exposes cefr_level as cefrLevel on the returned QuestionRecord', async () => {
      await pool.query(
        `INSERT INTO questions (category, question_text, options, correct_index, cefr_level)
         VALUES ($1, $2, $3, $4, $5)`,
        [FIXTURE_CATEGORY, 'CEFR_FIELD_TEST_Q', JSON.stringify(['a', 'b']), 0, 'B1']
      );

      const questions = await getRandomQuestions(FIXTURE_CATEGORY, 1);
      expect(questions[0].cefrLevel).toBe('B1');
    });

    it('omits cefrLevel entirely for a row with no cefr_level set', async () => {
      await pool.query(
        `INSERT INTO questions (category, question_text, options, correct_index)
         VALUES ($1, $2, $3, $4)`,
        [FIXTURE_CATEGORY, 'CEFR_FIELD_TEST_Q_NULL', JSON.stringify(['a', 'b']), 0]
      );

      const questions = await getRandomQuestions(FIXTURE_CATEGORY, 1);
      expect(questions[0].cefrLevel).toBeUndefined();
    });
  });
});
