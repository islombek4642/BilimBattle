// frontend/src/api/leaderboard.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as client from './client';
import { getGlobalLeaderboard, getFriendsLeaderboard } from './leaderboard';

describe('api/leaderboard', () => {
  it('getGlobalLeaderboard calls apiGet with /leaderboard/global and the token', async () => {
    const apiGetSpy = vi.spyOn(client, 'apiGet').mockResolvedValue({ leaderboard: [] });

    const result = await getGlobalLeaderboard('tok');

    expect(apiGetSpy).toHaveBeenCalledWith('/leaderboard/global', 'tok');
    expect(result).toEqual({ leaderboard: [] });
  });

  it('getFriendsLeaderboard calls apiGet with /leaderboard/friends and the token', async () => {
    const apiGetSpy = vi.spyOn(client, 'apiGet').mockResolvedValue({ leaderboard: [] });

    const result = await getFriendsLeaderboard('tok');

    expect(apiGetSpy).toHaveBeenCalledWith('/leaderboard/friends', 'tok');
    expect(result).toEqual({ leaderboard: [] });
  });
});
