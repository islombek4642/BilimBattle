import { pool } from '../config/db';

export interface LeaderboardEntry {
  telegramId: number;
  firstName: string;
  username: string | null;
  rating: number;
  gamesWon: number;
}

interface LeaderboardRow {
  telegram_id: string;
  first_name: string;
  username: string | null;
  rating: number;
  games_won: number;
}

function mapRow(row: LeaderboardRow): LeaderboardEntry {
  return {
    telegramId: Number(row.telegram_id),
    firstName: row.first_name,
    username: row.username,
    rating: row.rating,
    gamesWon: row.games_won,
  };
}

export async function getGlobalLeaderboard(limit = 100): Promise<LeaderboardEntry[]> {
  const result = await pool.query<LeaderboardRow>(
    `SELECT telegram_id, first_name, username, rating, games_won
     FROM users
     WHERE telegram_id != 0
     ORDER BY rating DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows.map(mapRow);
}

// "Friends" leaderboard = the referral circle: people the user invited, plus
// whoever invited the user. Telegram Mini Apps cannot read a user's real
// contacts list, so referral relationships are the closest available proxy.
export async function getFriendsLeaderboard(telegramId: number): Promise<LeaderboardEntry[]> {
  const result = await pool.query<LeaderboardRow>(
    `SELECT telegram_id, first_name, username, rating, games_won
     FROM users
     WHERE telegram_id != 0
       AND (
         telegram_id = $1
         OR invited_by_telegram_id = $1
         OR telegram_id = (SELECT invited_by_telegram_id FROM users WHERE telegram_id = $1)
       )
     ORDER BY rating DESC`,
    [telegramId]
  );
  return result.rows.map(mapRow);
}
