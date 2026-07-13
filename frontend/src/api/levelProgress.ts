// frontend/src/api/levelProgress.ts
import { apiGet } from './client';

export interface LevelProgressEntry {
  levelNumber: number;
  stars: number;
}

export interface LevelProgressResponse {
  progress: LevelProgressEntry[];
  maxAvailableLevel: number;
}

export function getLevelProgress(token: string): Promise<LevelProgressResponse> {
  return apiGet<LevelProgressResponse>('/level-progress', token);
}
