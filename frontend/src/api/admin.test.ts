// frontend/src/api/admin.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as client from './client';
import { getAdminStats } from './admin';

describe('api/admin', () => {
  it('calls apiGet with /admin/stats and the token', async () => {
    const apiGetSpy = vi.spyOn(client, 'apiGet').mockResolvedValue({
      summary: { totalUsers: 10, invitedUsers: 3, totalHumanMatches: 20, totalBotMatches: 5, returningUsers: 4 },
      daily: [],
    });

    const result = await getAdminStats('tok');

    expect(apiGetSpy).toHaveBeenCalledWith('/admin/stats', 'tok');
    expect(result.summary.totalUsers).toBe(10);
  });
});
