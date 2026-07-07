// frontend/src/api/leaderboard.ts
import { apiGet } from './client';
import { LeaderboardEntry } from './types';

export function getGlobalLeaderboard(token: string): Promise<{ leaderboard: LeaderboardEntry[] }> {
  return apiGet<{ leaderboard: LeaderboardEntry[] }>('/leaderboard/global', token);
}

export function getFriendsLeaderboard(token: string): Promise<{ leaderboard: LeaderboardEntry[] }> {
  return apiGet<{ leaderboard: LeaderboardEntry[] }>('/leaderboard/friends', token);
}
