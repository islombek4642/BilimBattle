// frontend/src/api/stats.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as client from './client';
import { getMyStats } from './stats';

describe('api/stats', () => {
  it('calls apiGet with /stats/me and the token', async () => {
    const apiGetSpy = vi.spyOn(client, 'apiGet').mockResolvedValue({
      gamesPlayed: 5, gamesWon: 3, winRate: 60, currentStreak: 1, bestStreak: 2, rating: 1020,
    });

    const result = await getMyStats('tok');

    expect(apiGetSpy).toHaveBeenCalledWith('/stats/me', 'tok');
    expect(result.winRate).toBe(60);
  });
});
