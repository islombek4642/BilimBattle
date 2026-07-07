// frontend/src/utils/leaderboardRank.ts
import { LeaderboardEntry } from '../api/types';

// Assumes `entries` is already sorted by rating descending (as returned by
// GET /leaderboard/global and GET /leaderboard/friends); this function only
// searches for a position, it never sorts.
export function findRank(entries: LeaderboardEntry[], telegramId: number): number | null {
  const index = entries.findIndex((e) => e.telegramId === telegramId);
  return index === -1 ? null : index + 1;
}
