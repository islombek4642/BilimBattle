import { describe, it, expect } from 'vitest';
import { categoryLabel } from './category';

describe('utils/category', () => {
  it('returns the known Uzbek label for a known category key', () => {
    expect(categoryLabel('umumiy_bilim')).toBe('Umumiy bilim');
    expect(categoryLabel('sport_kino_musiqa')).toBe('Sport/Kino/Musiqa');
  });

  it('falls back to the raw key for an unknown category', () => {
    expect(categoryLabel('unknown_key')).toBe('unknown_key');
  });
});
