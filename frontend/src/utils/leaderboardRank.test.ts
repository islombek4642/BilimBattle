// frontend/src/utils/leaderboardRank.test.ts
import { describe, it, expect } from 'vitest';
import { findRank } from './leaderboardRank';
import { LeaderboardEntry } from '../api/types';

describe('utils/leaderboardRank', () => {
  const entries: LeaderboardEntry[] = [
    { telegramId: 111, firstName: 'A', username: null, rating: 1200, gamesWon: 5 },
    { telegramId: 222, firstName: 'B', username: null, rating: 1100, gamesWon: 3 },
  ];

  it('returns the 1-based position of a present telegramId', () => {
    expect(findRank(entries, 111)).toBe(1);
    expect(findRank(entries, 222)).toBe(2);
  });

  it('returns null when the telegramId is not in the list', () => {
    expect(findRank(entries, 999)).toBeNull();
  });
});
