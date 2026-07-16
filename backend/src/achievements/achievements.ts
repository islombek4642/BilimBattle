// backend/src/achievements/achievements.ts
import { pool } from '../config/db';
import { accumulateWeeklyXp } from '../league/leagueRepository';

export type AchievementCategory = 'games' | 'streak' | 'rating' | 'level';

export interface Achievement {
  key: string;
  category: AchievementCategory;
  label: string;
  description: string;
  threshold: number;
  // Credited once, to league_weekly_xp, the first time this key is
  // genuinely newly-awarded (see awardAchievements below) - never on a
  // re-award of an already-earned key. Scales with tier/difficulty (see the
  // design spec's reward table): 50/100/200/300.
  xpReward: number;
}

// Static catalog - fixed, versioned with the code, not editable at runtime
// or stored in the database. Only *which user has earned which* needs
// persistence (see user_achievements). Every entry except 'level_perfect'
// is a simple "already-tracked value >= threshold" check; 'level_perfect'
// is special-cased in checkAndAwardLevelAchievements below (it checks an
// exact star count on THIS level, not a cumulative level number), so its
// `threshold` field here is documentation/display only, not used in a
// generic ">=" comparison anywhere.
export const ACHIEVEMENTS: Achievement[] = [
  { key: 'games_1', category: 'games', label: 'Birinchi qadam', description: "1 ta o'yin o'ynang", threshold: 1, xpReward: 50 },
  { key: 'games_10', category: 'games', label: "Faol o'yinchi", description: "10 ta o'yin o'ynang", threshold: 10, xpReward: 100 },
  { key: 'games_50', category: 'games', label: 'Tajribali', description: "50 ta o'yin o'ynang", threshold: 50, xpReward: 200 },
  { key: 'games_100', category: 'games', label: "Faxriy a'zo", description: "100 ta o'yin o'ynang", threshold: 100, xpReward: 300 },
  { key: 'streak_3', category: 'streak', label: 'Olov', description: "3 ta ketma-ket g'alaba qozoning", threshold: 3, xpReward: 50 },
  { key: 'streak_5', category: 'streak', label: 'Alanga', description: "5 ta ketma-ket g'alaba qozoning", threshold: 5, xpReward: 100 },
  { key: 'streak_10', category: 'streak', label: "Yong'in", description: "10 ta ketma-ket g'alaba qozoning", threshold: 10, xpReward: 200 },
  { key: 'rating_1200', category: 'rating', label: 'Yuksalish', description: '1200 reytingga yeting', threshold: 1200, xpReward: 100 },
  { key: 'rating_1500', category: 'rating', label: 'Chempion', description: '1500 reytingga yeting', threshold: 1500, xpReward: 200 },
  { key: 'rating_2000', category: 'rating', label: 'Afsona', description: '2000 reytingga yeting', threshold: 2000, xpReward: 300 },
  { key: 'level_10', category: 'level', label: 'Bosqichlar ustasi I', description: "10-bosqichni tugating", threshold: 10, xpReward: 100 },
  { key: 'level_50', category: 'level', label: 'Bosqichlar ustasi II', description: "50-bosqichni tugating", threshold: 50, xpReward: 200 },
  { key: 'level_100', category: 'level', label: 'Bosqichlar ustasi III', description: "100-bosqichni tugating", threshold: 100, xpReward: 300 },
  { key: 'level_perfect', category: 'level', label: 'Mukammal', description: "Biror bosqichda 3 yulduz oling", threshold: 3, xpReward: 300 },
];

export interface EarnedAchievement {
  key: string;
  earnedAt: string;
}

// Awards every key in `candidateKeys` the user doesn't already have, in one
// batched insert - safe to call redundantly (e.g. the same match could in
// principle qualify a player for the same key twice across two different
// call sites) since ON CONFLICT DO NOTHING makes re-awarding a no-op.
// Returns only the keys that were GENUINELY new this call (via RETURNING),
// not the full earned set.
export async function awardAchievements(userId: number, candidateKeys: string[]): Promise<string[]> {
  if (candidateKeys.length === 0) return [];
  const result = await pool.query<{ achievement_key: string }>(
    `INSERT INTO user_achievements (user_id, achievement_key)
     SELECT $1, key FROM unnest($2::text[]) AS key
     ON CONFLICT (user_id, achievement_key) DO NOTHING
     RETURNING achievement_key`,
    [userId, candidateKeys]
  );
  const newlyAwarded = result.rows.map((r) => r.achievement_key);

  // Credit each genuinely-new key's XP reward to the user's current-week
  // league XP - never for a key that was already earned (those never
  // appear in newlyAwarded, since RETURNING only reports rows the INSERT
  // actually inserted, not ones ON CONFLICT skipped). The `?.` guard is
  // defensive: candidateKeys is caller-supplied, not restricted at the type
  // level to real catalog keys.
  for (const key of newlyAwarded) {
    const achievement = ACHIEVEMENTS.find((a) => a.key === key);
    if (achievement) {
      await accumulateWeeklyXp(userId, achievement.xpReward);
    }
  }

  return newlyAwarded;
}

export async function getEarnedAchievements(userId: number): Promise<EarnedAchievement[]> {
  const result = await pool.query<{ achievement_key: string; earned_at: Date }>(
    `SELECT achievement_key, earned_at FROM user_achievements WHERE user_id = $1`,
    [userId]
  );
  return result.rows.map((r) => ({ key: r.achievement_key, earnedAt: r.earned_at.toISOString() }));
}

// Checks already-updated match stats (games_played, current_streak, rating -
// the caller is responsible for fetching these AFTER the match's
// persistMatchResult has run) against the games/streak/rating categories
// and awards any newly-crossed threshold. Deliberately never touches the
// 'level' category - level achievements are awarded by
// checkAndAwardLevelAchievements below, keyed off different data
// (level_progress, not users).
export async function checkAndAwardMatchAchievements(
  userId: number,
  stats: { gamesPlayed: number; currentStreak: number; rating: number }
): Promise<string[]> {
  const qualifying = ACHIEVEMENTS.filter(
    (a) =>
      (a.category === 'games' && stats.gamesPlayed >= a.threshold) ||
      (a.category === 'streak' && stats.currentStreak >= a.threshold) ||
      (a.category === 'rating' && stats.rating >= a.threshold)
  ).map((a) => a.key);
  return awardAchievements(userId, qualifying);
}

// levelNumber and stars come from a single just-finished level-mode match
// (see gameEngine.ts's finishGame). level_10/50/100 check levelNumber
// directly (any star count - "finished a level-mode match for level N at
// all" is the bar, not a minimum stars requirement). level_perfect is
// checked separately against `stars === 3` on THIS SPECIFIC call, not
// "has ANY level ever reached 3 stars" via a historical query - the
// literal stars value from the match that just happened is sufficient and
// cheaper. This intentional separation is what the regression-guard test
// in achievements.test.ts locks in.
export async function checkAndAwardLevelAchievements(
  userId: number,
  levelNumber: number,
  stars: number
): Promise<string[]> {
  const qualifying: string[] = [];
  if (levelNumber >= 10) qualifying.push('level_10');
  if (levelNumber >= 50) qualifying.push('level_50');
  if (levelNumber >= 100) qualifying.push('level_100');
  if (stars === 3) qualifying.push('level_perfect');
  return awardAchievements(userId, qualifying);
}
