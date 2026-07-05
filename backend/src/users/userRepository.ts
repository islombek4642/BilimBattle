import { pool } from '../config/db';

export interface User {
  id: number;
  telegramId: number;
  username: string | null;
  firstName: string;
  invitedByTelegramId: number | null;
  rating: number;
  gamesPlayed: number;
  gamesWon: number;
  currentStreak: number;
  bestStreak: number;
}

function mapRow(row: any): User {
  return {
    id: row.id,
    telegramId: Number(row.telegram_id),
    username: row.username,
    firstName: row.first_name,
    invitedByTelegramId: row.invited_by_telegram_id ? Number(row.invited_by_telegram_id) : null,
    rating: row.rating,
    gamesPlayed: row.games_played,
    gamesWon: row.games_won,
    currentStreak: row.current_streak,
    bestStreak: row.best_streak,
  };
}

export async function upsertUser(
  telegramId: number,
  username: string | undefined,
  firstName: string,
  invitedByTelegramId: number | null
): Promise<User> {
  const result = await pool.query(
    `INSERT INTO users (telegram_id, username, first_name, invited_by_telegram_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (telegram_id) DO UPDATE SET username = EXCLUDED.username, first_name = EXCLUDED.first_name
     RETURNING *`,
    [telegramId, username ?? null, firstName, invitedByTelegramId]
  );
  return mapRow(result.rows[0]);
}

export async function getUserByTelegramId(telegramId: number): Promise<User | null> {
  const result = await pool.query(`SELECT * FROM users WHERE telegram_id = $1`, [telegramId]);
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function getUserById(id: number): Promise<User | null> {
  const result = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

const BOT_TELEGRAM_ID = 0;

export async function getOrCreateBotUser(): Promise<User> {
  const existing = await getUserByTelegramId(BOT_TELEGRAM_ID);
  if (existing) return existing;
  return upsertUser(BOT_TELEGRAM_ID, 'bilimbattle_bot', 'Bot', null);
}

export async function recordMatchResult(params: {
  category: string;
  player1Id: number;
  player2Id: number;
  player1Score: number;
  player2Score: number;
  winnerId: number | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO matches (category, player1_id, player2_id, player1_score, player2_score, winner_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [params.category, params.player1Id, params.player2Id, params.player1Score, params.player2Score, params.winnerId]
  );

  await updatePlayerStats(params.player1Id, params.winnerId === params.player1Id, params.winnerId !== null);
  await updatePlayerStats(params.player2Id, params.winnerId === params.player2Id, params.winnerId !== null);
}

async function updatePlayerStats(userId: number, won: boolean, hasWinner: boolean): Promise<void> {
  if (won) {
    await pool.query(
      `UPDATE users SET
         games_played = games_played + 1,
         games_won = games_won + 1,
         current_streak = current_streak + 1,
         best_streak = GREATEST(best_streak, current_streak + 1),
         rating = rating + 20
       WHERE id = $1`,
      [userId]
    );
  } else if (hasWinner) {
    await pool.query(
      `UPDATE users SET
         games_played = games_played + 1,
         current_streak = 0,
         rating = GREATEST(rating - 10, 0)
       WHERE id = $1`,
      [userId]
    );
  } else {
    await pool.query(`UPDATE users SET games_played = games_played + 1 WHERE id = $1`, [userId]);
  }
}
