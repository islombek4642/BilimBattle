// frontend/src/api/achievements.ts
import { apiGet } from './client';

export interface Achievement {
  key: string;
  category: 'games' | 'streak' | 'rating' | 'level';
  label: string;
  description: string;
}

export interface EarnedAchievement {
  key: string;
  earnedAt: string;
}

export interface AchievementsResponse {
  catalog: Achievement[];
  earned: EarnedAchievement[];
}

export function getAchievements(token: string): Promise<AchievementsResponse> {
  return apiGet<AchievementsResponse>('/achievements', token);
}
