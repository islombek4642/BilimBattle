import { pool } from '../config/db';

export interface AdminSummary {
  totalUsers: number;
  invitedUsers: number;
  totalHumanMatches: number;
  totalBotMatches: number;
  returningUsers: number;
}

export interface DailyStat {
  date: string;
  newUsers: number;
  activeUsers: number;
  humanMatches: number;
  botMatches: number;
}

// The bot's own user row (telegram_id 0, see userRepository.ts's
// getOrCreateBotUser) must not count toward user/DAU/retention numbers, and
// its matches must be split out separately - a bot-fallback match is a
// matchmaking-supply signal (not enough real opponents within 15s), not a
// real "two people played together" event, which is what these metrics
// exist to track. -1 is returned when no bot user row exists yet (nobody
// has ever hit the bot-fallback path), matching nothing in a `player1_id =
// $1` comparison.
async function getBotUserId(): Promise<number> {
  const result = await pool.query<{ id: number }>(`SELECT id FROM users WHERE telegram_id = 0`);
  return result.rows[0]?.id ?? -1;
}

export async function getAdminSummary(): Promise<AdminSummary> {
  const botId = await getBotUserId();

  const [totalUsers, invitedUsers, humanMatches, botMatches, returningUsers] = await Promise.all([
    pool.query<{ count: string }>(`SELECT COUNT(*) FROM users WHERE telegram_id != 0`),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM users WHERE telegram_id != 0 AND invited_by_telegram_id IS NOT NULL`
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM matches WHERE player1_id != $1 AND player2_id != $1`,
      [botId]
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM matches WHERE player1_id = $1 OR player2_id = $1`,
      [botId]
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM (
         SELECT player_id
         FROM (
           SELECT player1_id AS player_id, created_at FROM matches
           UNION ALL
           SELECT player2_id AS player_id, created_at FROM matches
         ) plays
         WHERE player_id != $1
         GROUP BY player_id
         HAVING COUNT(DISTINCT (created_at AT TIME ZONE 'UTC')::date) > 1
       ) returning_players`,
      [botId]
    ),
  ]);

  return {
    totalUsers: Number(totalUsers.rows[0].count),
    invitedUsers: Number(invitedUsers.rows[0].count),
    totalHumanMatches: Number(humanMatches.rows[0].count),
    totalBotMatches: Number(botMatches.rows[0].count),
    returningUsers: Number(returningUsers.rows[0].count),
  };
}

export async function getDailyStats(days = 14): Promise<DailyStat[]> {
  const botId = await getBotUserId();

  const result = await pool.query<{
    date: string;
    new_users: string;
    active_users: string;
    human_matches: string;
    bot_matches: string;
  }>(
    `WITH utc_today AS (
       SELECT (now() AT TIME ZONE 'UTC')::date AS today
     ),
     day_range AS (
       SELECT generate_series(utc_today.today - ($2::int - 1), utc_today.today, '1 day')::date AS date
       FROM utc_today
     ),
     signups AS (
       SELECT (created_at AT TIME ZONE 'UTC')::date AS date, COUNT(*) AS count
       FROM users WHERE telegram_id != 0
       GROUP BY (created_at AT TIME ZONE 'UTC')::date
     ),
     plays AS (
       SELECT (created_at AT TIME ZONE 'UTC')::date AS date, player1_id AS player_id FROM matches
       UNION ALL
       SELECT (created_at AT TIME ZONE 'UTC')::date AS date, player2_id AS player_id FROM matches
     ),
     active AS (
       SELECT date, COUNT(DISTINCT player_id) AS count
       FROM plays WHERE player_id != $1
       GROUP BY date
     ),
     human_matches AS (
       SELECT (created_at AT TIME ZONE 'UTC')::date AS date, COUNT(*) AS count
       FROM matches WHERE player1_id != $1 AND player2_id != $1
       GROUP BY (created_at AT TIME ZONE 'UTC')::date
     ),
     bot_matches AS (
       SELECT (created_at AT TIME ZONE 'UTC')::date AS date, COUNT(*) AS count
       FROM matches WHERE player1_id = $1 OR player2_id = $1
       GROUP BY (created_at AT TIME ZONE 'UTC')::date
     )
     SELECT
       day_range.date::text AS date,
       COALESCE(signups.count, 0) AS new_users,
       COALESCE(active.count, 0) AS active_users,
       COALESCE(human_matches.count, 0) AS human_matches,
       COALESCE(bot_matches.count, 0) AS bot_matches
     FROM day_range
     LEFT JOIN signups ON signups.date = day_range.date
     LEFT JOIN active ON active.date = day_range.date
     LEFT JOIN human_matches ON human_matches.date = day_range.date
     LEFT JOIN bot_matches ON bot_matches.date = day_range.date
     ORDER BY day_range.date DESC`,
    [botId, days]
  );

  return result.rows.map((row) => ({
    date: row.date,
    newUsers: Number(row.new_users),
    activeUsers: Number(row.active_users),
    humanMatches: Number(row.human_matches),
    botMatches: Number(row.bot_matches),
  }));
}
