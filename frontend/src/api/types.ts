// frontend/src/api/types.ts
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

export interface Category {
  key: string;
  label: string;
}

export interface LeaderboardEntry {
  telegramId: number;
  firstName: string;
  username: string | null;
  rating: number;
  gamesWon: number;
}

export interface Stats {
  gamesPlayed: number;
  gamesWon: number;
  winRate: number;
  currentStreak: number;
  bestStreak: number;
  rating: number;
}

export interface ScoreEntry {
  userId: number;
  score: number;
}
