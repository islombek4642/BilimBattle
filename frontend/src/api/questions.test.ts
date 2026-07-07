// frontend/src/api/questions.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as client from './client';
import { getCategories } from './questions';

describe('api/questions', () => {
  it('calls apiGet with /categories and returns the response', async () => {
    const apiGetSpy = vi.spyOn(client, 'apiGet').mockResolvedValue({
      categories: [{ key: 'umumiy_bilim', label: 'Umumiy bilim' }],
    });

    const result = await getCategories();

    expect(apiGetSpy).toHaveBeenCalledWith('/categories');
    expect(result.categories).toEqual([{ key: 'umumiy_bilim', label: 'Umumiy bilim' }]);
  });
});
