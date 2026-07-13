// backend/src/game/levelProgress.ts
import { pool } from '../config/db';

export const QUESTIONS_PER_LEVEL = 15;
export const LEVELS_PER_STAGE = 10;
export const STAGE_UNLOCK_STARS_REQUIRED = 25;
export const LEVEL_UNLOCK_STARS_REQUIRED = 2;

export function calculateLevelStars(correctCount: number): number {
  if (correctCount >= 14) return 3;
  if (correctCount >= 11) return 2;
  if (correctCount >= 8) return 1;
  return 0;
}

// `progressByLevel` maps levelNumber -> stars for levels the user has
// actually played; a level with no entry is treated as never-played (0
// stars, for stage-total purposes) / not-yet-unlocked (for the
// previous-level check).
export function isLevelUnlocked(level: number, progressByLevel: Map<number, number>): boolean {
  if (level === 1) return true;

  const isFirstOfStage = (level - 1) % LEVELS_PER_STAGE === 0; // 11, 21, 31...
  if (isFirstOfStage) {
    const stageStart = level - LEVELS_PER_STAGE;
    let totalStars = 0;
    for (let i = stageStart; i < level; i += 1) {
      totalStars += progressByLevel.get(i) ?? 0;
    }
    return totalStars >= STAGE_UNLOCK_STARS_REQUIRED;
  }

  return (progressByLevel.get(level - 1) ?? 0) >= LEVEL_UNLOCK_STARS_REQUIRED;
}

export interface LevelProgressEntry {
  levelNumber: number;
  stars: number;
}

export async function upsertLevelProgress(userId: number, levelNumber: number, stars: number): Promise<void> {
  await pool.query(
    `INSERT INTO level_progress (user_id, level_number, stars)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, level_number)
     DO UPDATE SET stars = GREATEST(level_progress.stars, EXCLUDED.stars), updated_at = now()`,
    [userId, levelNumber, stars]
  );
}

export async function getLevelProgressForUser(userId: number): Promise<LevelProgressEntry[]> {
  const result = await pool.query<{ level_number: number; stars: number }>(
    `SELECT level_number, stars FROM level_progress WHERE user_id = $1`,
    [userId]
  );
  return result.rows.map((row) => ({ levelNumber: row.level_number, stars: row.stars }));
}

export async function isLevelUnlockedForUser(userId: number, level: number): Promise<boolean> {
  const progress = await getLevelProgressForUser(userId);
  const progressByLevel = new Map(progress.map((p) => [p.levelNumber, p.stars]));
  return isLevelUnlocked(level, progressByLevel);
}
