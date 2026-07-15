// backend/src/progression/dailyProgressRepository.ts
import { pool } from '../config/db';

export interface DailyProgress {
  matchesPlayed: number;
  correctAnswers: number;
  bestStarsToday: number;
}

// UTC calendar date, matching streakLogic.ts's date handling - a documented
// simplification, not the user's local time zone.
export function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getTodayProgress(userId: number): Promise<DailyProgress> {
  const result = await pool.query<{ matches_played: number; correct_answers: number; best_stars_today: number }>(
    `SELECT matches_played, correct_answers, best_stars_today
     FROM daily_quest_progress WHERE user_id = $1 AND quest_date = $2`,
    [userId, todayDateString()]
  );
  const row = result.rows[0];
  return {
    matchesPlayed: row?.matches_played ?? 0,
    correctAnswers: row?.correct_answers ?? 0,
    bestStarsToday: row?.best_stars_today ?? 0,
  };
}

// Called once per finished match (see progressionService.ts). `starsToday`
// is null for non-level (quick-match) games, since stars only exist in
// level mode - GREATEST() below then simply leaves today's existing best
// unchanged. Keyed by (user_id, quest_date), so a brand new calendar day
// naturally starts every counter at zero via INSERT rather than needing an
// explicit reset step - this is the "lazy reset" the design spec describes.
export async function recordDailyMatch(userId: number, correctAnswers: number, starsToday: number | null): Promise<void> {
  await pool.query(
    `INSERT INTO daily_quest_progress (user_id, quest_date, matches_played, correct_answers, best_stars_today)
     VALUES ($1, $2, 1, $3, $4)
     ON CONFLICT (user_id, quest_date) DO UPDATE SET
       matches_played = daily_quest_progress.matches_played + 1,
       correct_answers = daily_quest_progress.correct_answers + EXCLUDED.correct_answers,
       best_stars_today = GREATEST(daily_quest_progress.best_stars_today, EXCLUDED.best_stars_today)`,
    [userId, todayDateString(), correctAnswers, starsToday ?? 0]
  );
}
