// backend/src/progression/xpRepository.ts
import { pool } from '../config/db';

export interface SubjectProgress {
  xp: number;
  masteryPoints: number;
}

export async function getSubjectProgress(userId: number, category: string): Promise<SubjectProgress> {
  const result = await pool.query<{ xp: number; mastery_points: number }>(
    `SELECT xp, mastery_points FROM subject_xp WHERE user_id = $1 AND category = $2`,
    [userId, category]
  );
  const row = result.rows[0];
  return { xp: row?.xp ?? 0, masteryPoints: row?.mastery_points ?? 0 };
}

// Both deltas only ever accumulate - a match's XP is added regardless of
// win/loss, and mastery points only grow from correct answers (see
// progressionService.ts) - so this never needs to subtract.
export async function addSubjectProgress(
  userId: number,
  category: string,
  xpDelta: number,
  masteryPointsDelta: number
): Promise<void> {
  await pool.query(
    `INSERT INTO subject_xp (user_id, category, xp, mastery_points)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, category) DO UPDATE SET
       xp = subject_xp.xp + EXCLUDED.xp,
       mastery_points = subject_xp.mastery_points + EXCLUDED.mastery_points`,
    [userId, category, xpDelta, masteryPointsDelta]
  );
}
