import { describe, it, expect, beforeEach } from 'vitest';
import { findAndMarkNewlySeenAchievements } from './achievementSeen';

describe('findAndMarkNewlySeenAchievements', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns all keys as newly seen the first time, and marks them', () => {
    const newly = findAndMarkNewlySeenAchievements(['games_1', 'streak_3']);
    expect(newly.sort()).toEqual(['games_1', 'streak_3']);
  });

  it('does not re-report an already-seen key on a later call', () => {
    findAndMarkNewlySeenAchievements(['games_1']);
    const secondCall = findAndMarkNewlySeenAchievements(['games_1']);
    expect(secondCall).toEqual([]);
  });

  it('reports only the genuinely new key when mixed with an already-seen one', () => {
    findAndMarkNewlySeenAchievements(['games_1']);
    const secondCall = findAndMarkNewlySeenAchievements(['games_1', 'streak_3']);
    expect(secondCall).toEqual(['streak_3']);
  });

  it('returns an empty array for an empty input without touching storage', () => {
    expect(findAndMarkNewlySeenAchievements([])).toEqual([]);
    expect(localStorage.getItem('bilimbattle:seenAchievements')).toBeNull();
  });
});
