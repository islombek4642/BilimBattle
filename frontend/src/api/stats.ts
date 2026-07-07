// frontend/src/api/stats.ts
import { apiGet } from './client';
import { Stats } from './types';

export function getMyStats(token: string): Promise<Stats> {
  return apiGet<Stats>('/stats/me', token);
}
