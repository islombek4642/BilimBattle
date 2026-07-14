// frontend/src/api/levelProgress.ts
import { apiGet } from './client';

export interface LevelProgressEntry {
  levelNumber: number;
  stars: number;
}

export interface LevelTierBoundary {
  tier: string;
  fromLevel: number;
  toLevel: number;
}

export interface LevelProgressResponse {
  progress: LevelProgressEntry[];
  maxAvailableLevel: number;
  tierBoundaries: LevelTierBoundary[];
}

export function getLevelProgress(token: string): Promise<LevelProgressResponse> {
  return apiGet<LevelProgressResponse>('/level-progress', token);
}
