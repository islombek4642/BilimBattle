// frontend/src/utils/leaderboardRank.ts
import { LeaderboardEntry } from '../api/types';

export function findRank(entries: LeaderboardEntry[], telegramId: number): number | null {
  const index = entries.findIndex((e) => e.telegramId === telegramId);
  return index === -1 ? null : index + 1;
}
