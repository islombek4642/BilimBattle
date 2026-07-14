import { pool } from '../../src/config/db';
import { upsertUser } from '../../src/users/userRepository';
import {
  ACHIEVEMENTS,
  awardAchievements,
  getEarnedAchievements,
  checkAndAwardMatchAchievements,
  checkAndAwardLevelAchievements,
} from '../../src/achievements/achievements';

describe('achievements', () => {
  let userId: number;

  beforeAll(async () => {
    const user = await upsertUser(881101, 'achievementsTestUser', 'AchievementsTest', null);
    userId = user.id;
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM user_achievements WHERE user_id = $1`, [userId]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE telegram_id = 881101`);
  });

  describe('ACHIEVEMENTS catalog', () => {
    it('has no duplicate keys', () => {
      const keys = ACHIEVEMENTS.map((a) => a.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('includes exactly one level_perfect entry with threshold 3 (the special-cased star check)', () => {
      const perfect = ACHIEVEMENTS.filter((a) => a.key === 'level_perfect');
      expect(perfect.length).toBe(1);
      expect(perfect[0].threshold).toBe(3);
    });
  });

  describe('awardAchievements / getEarnedAchievements', () => {
    it('awards the given keys and returns them as newly-awarded', async () => {
      const newlyAwarded = await awardAchievements(userId, ['games_1', 'streak_3']);
      expect(newlyAwarded.sort()).toEqual(['games_1', 'streak_3']);

      const earned = await getEarnedAchievements(userId);
      expect(earned.map((e) => e.key).sort()).toEqual(['games_1', 'streak_3']);
    });

    it('does not re-award (or re-report as new) an already-earned key', async () => {
      await awardAchievements(userId, ['games_1']);
      const secondCall = await awardAchievements(userId, ['games_1']);
      expect(secondCall).toEqual([]);

      const earned = await getEarnedAchievements(userId);
      expect(earned.length).toBe(1);
    });

    it('returns an empty array without querying when given no candidate keys', async () => {
      expect(await awardAchievements(userId, [])).toEqual([]);
    });
  });

  describe('checkAndAwardMatchAchievements', () => {
    it('awards every games/streak/rating achievement whose threshold the given stats meet or exceed', async () => {
      const newlyAwarded = await checkAndAwardMatchAchievements(userId, {
        gamesPlayed: 12,
        currentStreak: 4,
        rating: 1300,
      });
      // games_1, games_10 (gamesPlayed=12 >= both); streak_3 (currentStreak=4
      // >= 3, not >= 5); rating_1200 (rating=1300 >= 1200, not >= 1500).
      expect(newlyAwarded.sort()).toEqual(['games_1', 'games_10', 'rating_1200', 'streak_3']);
    });

    it('never awards a level-category achievement from match stats', async () => {
      const newlyAwarded = await checkAndAwardMatchAchievements(userId, {
        gamesPlayed: 200,
        currentStreak: 20,
        rating: 3000,
      });
      expect(newlyAwarded.every((key) => !key.startsWith('level_'))).toBe(true);
    });
  });

  describe('checkAndAwardLevelAchievements', () => {
    it('awards the level-count achievement whose threshold levelNumber meets, but not level_perfect unless stars is exactly 3', async () => {
      const newlyAwarded = await checkAndAwardLevelAchievements(userId, 10, 2);
      expect(newlyAwarded).toEqual(['level_10']);
    });

    it('awards level_perfect when stars is exactly 3, independent of levelNumber', async () => {
      const newlyAwarded = await checkAndAwardLevelAchievements(userId, 1, 3);
      expect(newlyAwarded).toEqual(['level_perfect']);
    });

    it('does not award level_perfect for a levelNumber that happens to equal 3 with fewer than 3 stars (regression guard against threshold confusion)', async () => {
      // level_perfect's threshold (3) is coincidentally the same NUMBER as
      // level 3 - this guards against a bug where the level-count check and
      // the perfect-stars check get merged into one generic ">=" comparison
      // and level 3 accidentally satisfies level_perfect's threshold.
      const newlyAwarded = await checkAndAwardLevelAchievements(userId, 3, 1);
      expect(newlyAwarded).toEqual([]);
    });
  });
});
