import { describe, it, expect } from 'vitest';
import { findMyScore, findOpponentScore } from './score';

describe('utils/score', () => {
  const scores = [
    { userId: 1, score: 450 },
    { userId: 2, score: 300 },
  ];

  it('findMyScore returns the score entry matching the given userId', () => {
    expect(findMyScore(scores, 1)).toBe(450);
  });

  it('findMyScore returns 0 when the userId is not present', () => {
    expect(findMyScore(scores, 999)).toBe(0);
  });

  it('findOpponentScore returns the score entry NOT matching the given userId', () => {
    expect(findOpponentScore(scores, 1)).toBe(300);
  });

  it('findOpponentScore returns 0 when there is no other entry', () => {
    expect(findOpponentScore([{ userId: 1, score: 100 }], 1)).toBe(0);
  });
});
