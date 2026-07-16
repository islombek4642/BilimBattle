// frontend/src/api/league.ts
import { apiGet } from './client';

export type LeagueTier = 'Bronza' | 'Kumush' | 'Oltin' | 'Platina' | 'Olmos' | 'Usta' | 'Chempion';

export interface LeagueBracketEntry {
  telegramId: number;
  firstName: string;
  weeklyXp: number;
}

export interface LeagueResponse {
  tier: LeagueTier;
  weeklyXp: number;
  bracket: LeagueBracketEntry[];
}

export function getMyLeague(token: string): Promise<LeagueResponse> {
  return apiGet<LeagueResponse>('/league', token);
}
