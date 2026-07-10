// frontend/src/api/admin.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as client from './client';
import { getAdminStats, importQuestions } from './admin';

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

  it('calls apiPostForm with /admin/questions/import, the form data, and the token', async () => {
    const apiPostFormSpy = vi.spyOn(client, 'apiPostForm').mockResolvedValue({
      category: { key: 'umumiy_bilim', label: 'Umumiy bilim' },
      inserted: 3,
      errors: [],
    });
    const formData = new FormData();

    const result = await importQuestions(formData, 'tok');

    expect(apiPostFormSpy).toHaveBeenCalledWith('/admin/questions/import', formData, 'tok');
    expect(result.inserted).toBe(3);
  });
});
