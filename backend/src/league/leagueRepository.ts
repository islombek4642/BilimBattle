// backend/src/league/leagueRepository.ts
import { pool } from '../config/db';
import { mostRecentMonday } from '../progression/streakLogic';
import { LeagueTier } from './leagueTiers';

function weekStartDateString(date: Date): string {
  return mostRecentMonday(date).toISOString().slice(0, 10);
}

// Used by the weekly-processing endpoint, which always operates on the week
// that JUST ended (the endpoint runs at the start of a new week, per the
// design spec's host-crontab trigger), not the current in-progress week.
export function previousWeekStartDateString(referenceDate: Date): string {
  const thisMonday = mostRecentMonday(referenceDate);
  const previousMonday = new Date(thisMonday);
  previousMonday.setUTCDate(previousMonday.getUTCDate() - 7);
  return previousMonday.toISOString().slice(0, 10);
}

// Called once per finished ingliz_tili match (see
// progression/progressionService.ts), mirroring daily_quest_progress's lazy
// per-period-row pattern - a new week simply has no row until the first
// accumulation. Also lazily creates a Bronza user_league row on a user's
// very first weekly XP (ON CONFLICT DO NOTHING - never overwrites an
// already-promoted/relegated tier on subsequent calls).
export async function accumulateWeeklyXp(userId: number, xpDelta: number): Promise<void> {
  const weekStart = weekStartDateString(new Date());
  await pool.query(
    `INSERT INTO league_weekly_xp (user_id, week_start_date, xp)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, week_start_date) DO UPDATE SET
       xp = league_weekly_xp.xp + EXCLUDED.xp`,
    [userId, weekStart, xpDelta]
  );
  await pool.query(`INSERT INTO user_league (user_id, tier) VALUES ($1, 'Bronza') ON CONFLICT (user_id) DO NOTHING`, [
    userId,
  ]);
}

export async function getUserLeague(userId: number): Promise<LeagueTier> {
  const result = await pool.query<{ tier: LeagueTier }>(`SELECT tier FROM user_league WHERE user_id = $1`, [userId]);
  return result.rows[0]?.tier ?? 'Bronza';
}

export async function getWeeklyXp(userId: number): Promise<number> {
  const weekStart = weekStartDateString(new Date());
  const result = await pool.query<{ xp: number }>(
    `SELECT xp FROM league_weekly_xp WHERE user_id = $1 AND week_start_date = $2`,
    [userId, weekStart]
  );
  return result.rows[0]?.xp ?? 0;
}

export interface BracketEntry {
  telegramId: number;
  firstName: string;
  weeklyXp: number;
}

// Top-N preview for GET /api/league (the current, in-progress week).
export async function getWeeklyBracket(tier: LeagueTier, limit = 10): Promise<BracketEntry[]> {
  const weekStart = weekStartDateString(new Date());
  const result = await pool.query<{ telegram_id: string; first_name: string; xp: number }>(
    `SELECT u.telegram_id, u.first_name, lwx.xp
     FROM league_weekly_xp lwx
     JOIN user_league ul ON ul.user_id = lwx.user_id
     JOIN users u ON u.id = lwx.user_id
     WHERE ul.tier = $1 AND lwx.week_start_date = $2 AND u.telegram_id != 0
     ORDER BY lwx.xp DESC
     LIMIT $3`,
    [tier, weekStart, limit]
  );
  return result.rows.map((r) => ({ telegramId: Number(r.telegram_id), firstName: r.first_name, weeklyXp: r.xp }));
}

// Used by the weekly-processing endpoint - returns EVERY member of a tier
// for a given (already-ended) week, unlimited, since promotion/relegation
// must rank the whole bracket, not just a top-N preview.
export async function getFullBracket(
  tier: LeagueTier,
  weekStartDate: string
): Promise<{ userId: number; weeklyXp: number }[]> {
  const result = await pool.query<{ user_id: number; xp: number }>(
    `SELECT lwx.user_id, lwx.xp
     FROM league_weekly_xp lwx
     JOIN user_league ul ON ul.user_id = lwx.user_id
     WHERE ul.tier = $1 AND lwx.week_start_date = $2`,
    [tier, weekStartDate]
  );
  return result.rows.map((r) => ({ userId: r.user_id, weeklyXp: r.xp }));
}

export async function applyTierChange(userId: number, newTier: LeagueTier): Promise<void> {
  await pool.query(`UPDATE user_league SET tier = $1, updated_at = now() WHERE user_id = $2`, [newTier, userId]);
}

export async function isWeekProcessed(weekStartDate: string): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM league_processing_log WHERE week_start_date = $1`, [weekStartDate]);
  return (result.rowCount ?? 0) > 0;
}

export async function markWeekProcessed(weekStartDate: string): Promise<void> {
  await pool.query(
    `INSERT INTO league_processing_log (week_start_date) VALUES ($1) ON CONFLICT (week_start_date) DO NOTHING`,
    [weekStartDate]
  );
}
