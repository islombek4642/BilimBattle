// frontend/src/api/profile.ts
import { apiGet } from './client';

export type MasteryRank = 'Boshlangich' | 'Orta' | 'Yuqori' | 'Usta' | 'Professor';

export interface DailyQuestStatus {
  key: string;
  label: string;
  progress: number;
  target: number;
  completed: boolean;
}

export interface ProfileResponse {
  xp: number;
  masteryPoints: number;
  masteryRank: MasteryRank;
  category: string;
  dailyQuests: DailyQuestStatus[];
  streak: { current: number; best: number; freezeAvailable: boolean };
}

export function getProfile(token: string): Promise<ProfileResponse> {
  return apiGet<ProfileResponse>('/profile', token);
}
