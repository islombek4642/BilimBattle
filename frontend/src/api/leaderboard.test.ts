// frontend/src/api/leaderboard.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as client from './client';
import { getGlobalLeaderboard, getFriendsLeaderboard } from './leaderboard';

describe('api/leaderboard', () => {
  it('getGlobalLeaderboard calls apiGet with /leaderboard/global and the token', async () => {
    const apiGetSpy = vi.spyOn(client, 'apiGet').mockResolvedValue({ leaderboard: [] });

    await getGlobalLeaderboard('tok');

    expect(apiGetSpy).toHaveBeenCalledWith('/leaderboard/global', 'tok');
  });

  it('getFriendsLeaderboard calls apiGet with /leaderboard/friends and the token', async () => {
    const apiGetSpy = vi.spyOn(client, 'apiGet').mockResolvedValue({ leaderboard: [] });

    await getFriendsLeaderboard('tok');

    expect(apiGetSpy).toHaveBeenCalledWith('/leaderboard/friends', 'tok');
  });
});
