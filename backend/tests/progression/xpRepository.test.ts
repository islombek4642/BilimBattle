import { pool } from '../../src/config/db';
import { upsertUser } from '../../src/users/userRepository';
import { getSubjectProgress, addSubjectProgress } from '../../src/progression/xpRepository';

describe('xpRepository', () => {
  let userId: number;

  beforeAll(async () => {
    const user = await upsertUser(881201, 'xpRepoTestUser', 'XpRepoTest', null);
    userId = user.id;
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM subject_xp WHERE user_id = $1`, [userId]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id = 881201`);
    await pool.end();
  });

  it('returns zero xp and mastery points for a category with no rows yet', async () => {
    const progress = await getSubjectProgress(userId, 'ingliz_tili');
    expect(progress).toEqual({ xp: 0, masteryPoints: 0 });
  });

  it('creates a row on first add and accumulates on subsequent adds', async () => {
    await addSubjectProgress(userId, 'ingliz_tili', 120, 4);
    await addSubjectProgress(userId, 'ingliz_tili', 80, 2);
    const progress = await getSubjectProgress(userId, 'ingliz_tili');
    expect(progress).toEqual({ xp: 200, masteryPoints: 6 });
  });

  it('keeps separate categories independent', async () => {
    await addSubjectProgress(userId, 'ingliz_tili', 100, 3);
    await addSubjectProgress(userId, 'umumiy_bilim', 999, 999);
    const ingliz = await getSubjectProgress(userId, 'ingliz_tili');
    expect(ingliz).toEqual({ xp: 100, masteryPoints: 3 });
  });
});
