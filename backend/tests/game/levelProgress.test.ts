import { pool } from '../../src/config/db';
import { upsertUser } from '../../src/users/userRepository';
import {
  calculateLevelStars,
  isLevelUnlocked,
  upsertLevelProgress,
  getLevelProgressForUser,
  isLevelUnlockedForUser,
} from '../../src/game/levelProgress';

describe('calculateLevelStars', () => {
  it('returns the correct star count for every threshold boundary (out of 15 questions)', () => {
    expect(calculateLevelStars(0)).toBe(0);
    expect(calculateLevelStars(7)).toBe(0);
    expect(calculateLevelStars(8)).toBe(1);
    expect(calculateLevelStars(10)).toBe(1);
    expect(calculateLevelStars(11)).toBe(2);
    expect(calculateLevelStars(13)).toBe(2);
    expect(calculateLevelStars(14)).toBe(3);
    expect(calculateLevelStars(15)).toBe(3);
  });
});

describe('isLevelUnlocked', () => {
  it('level 1 is always unlocked, regardless of progress', () => {
    expect(isLevelUnlocked(1, new Map())).toBe(true);
  });

  it('a non-stage-boundary level unlocks once the previous level has at least 2 stars', () => {
    expect(isLevelUnlocked(4, new Map([[3, 2]]))).toBe(true);
    expect(isLevelUnlocked(4, new Map([[3, 3]]))).toBe(true);
    expect(isLevelUnlocked(4, new Map([[3, 1]]))).toBe(false);
    expect(isLevelUnlocked(4, new Map([[3, 0]]))).toBe(false);
    expect(isLevelUnlocked(4, new Map())).toBe(false); // level 3 never played
  });

  it('the first level of a new stage (11, 21, ...) requires >=25 total stars across the previous stage\'s 10 levels', () => {
    const barelyEnough = new Map<number, number>();
    for (let i = 1; i <= 9; i += 1) barelyEnough.set(i, 2); // 18
    barelyEnough.set(10, 3); // 18 + 3 = 21, still short of 25
    expect(isLevelUnlocked(11, barelyEnough)).toBe(false);

    const enough = new Map<number, number>();
    for (let i = 1; i <= 8; i += 1) enough.set(i, 3); // 24
    enough.set(9, 1); // 25
    enough.set(10, 0);
    expect(isLevelUnlocked(11, enough)).toBe(true);
  });

  it('a mid-stage level (e.g. 12) still uses the simple previous-level->=2-stars rule, not the stage total', () => {
    expect(isLevelUnlocked(12, new Map([[11, 2]]))).toBe(true);
    expect(isLevelUnlocked(12, new Map([[11, 1]]))).toBe(false);
  });
});

describe('upsertLevelProgress / getLevelProgressForUser', () => {
  let userId: number;

  beforeAll(async () => {
    const user = await upsertUser(881001, 'levelProgressTestUser', 'LevelTest', null);
    userId = user.id;
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM level_progress WHERE user_id = $1`, [userId]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id = 881001`);
  });

  it('creates a new row on first upsert', async () => {
    await upsertLevelProgress(userId, 3, 2);
    const progress = await getLevelProgressForUser(userId);
    expect(progress).toEqual([{ levelNumber: 3, stars: 2 }]);
  });

  it('keeps the best (highest) star count on repeated upserts, never downgrades', async () => {
    await upsertLevelProgress(userId, 5, 2);
    await upsertLevelProgress(userId, 5, 1); // worse replay - should NOT overwrite
    let progress = await getLevelProgressForUser(userId);
    expect(progress).toEqual([{ levelNumber: 5, stars: 2 }]);

    await upsertLevelProgress(userId, 5, 3); // better replay - should overwrite
    progress = await getLevelProgressForUser(userId);
    expect(progress).toEqual([{ levelNumber: 5, stars: 3 }]);
  });

  it('returns all of a user\'s progress rows', async () => {
    await upsertLevelProgress(userId, 1, 3);
    await upsertLevelProgress(userId, 2, 1);
    const progress = await getLevelProgressForUser(userId);
    expect(progress.sort((a, b) => a.levelNumber - b.levelNumber)).toEqual([
      { levelNumber: 1, stars: 3 },
      { levelNumber: 2, stars: 1 },
    ]);
  });
});

describe('isLevelUnlockedForUser', () => {
  let userId: number;

  beforeAll(async () => {
    const user = await upsertUser(881002, 'levelUnlockTestUser', 'LevelUnlockTest', null);
    userId = user.id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM level_progress WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM users WHERE telegram_id = 881002`);
  });

  it('level 1 is unlocked for a brand new user with zero progress', async () => {
    expect(await isLevelUnlockedForUser(userId, 1)).toBe(true);
  });

  it('level 2 is locked until level 1 has >=2 stars', async () => {
    expect(await isLevelUnlockedForUser(userId, 2)).toBe(false);
    await upsertLevelProgress(userId, 1, 2);
    expect(await isLevelUnlockedForUser(userId, 2)).toBe(true);
  });
});
