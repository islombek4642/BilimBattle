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

export interface AdminSummary {
  totalUsers: number;
  invitedUsers: number;
  totalHumanMatches: number;
  totalBotMatches: number;
  returningUsers: number;
}

export interface AdminDailyStat {
  date: string;
  newUsers: number;
  activeUsers: number;
  humanMatches: number;
  botMatches: number;
}

export interface AdminUserEntry {
  telegramId: number;
  username: string | null;
  firstName: string;
  rating: number;
  gamesPlayed: number;
  gamesWon: number;
  createdAt: string;
}

export interface AdminStats {
  summary: AdminSummary;
  daily: AdminDailyStat[];
  users: AdminUserEntry[];
}

export interface QuestionImportError {
  line: number;
  message: string;
}

export interface QuestionImportResult {
  category: Category;
  inserted: number;
  errors: QuestionImportError[];
}
