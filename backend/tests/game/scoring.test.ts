import { calculateScore, QUESTION_TIME_LIMIT_MS, BASE_CORRECT_POINTS, MAX_SPEED_BONUS } from '../../src/game/scoring';

describe('calculateScore', () => {
  it('returns 0 for an incorrect answer regardless of speed', () => {
    expect(calculateScore(false, 500)).toBe(0);
    expect(calculateScore(false, 9999)).toBe(0);
  });

  it('returns max points for an instant correct answer', () => {
    expect(calculateScore(true, 0)).toBe(BASE_CORRECT_POINTS + MAX_SPEED_BONUS);
  });

  it('returns base points with no speed bonus for a correct answer at the time limit', () => {
    expect(calculateScore(true, QUESTION_TIME_LIMIT_MS)).toBe(BASE_CORRECT_POINTS);
  });

  it('returns a partial speed bonus for a correct answer halfway through the time window', () => {
    expect(calculateScore(true, QUESTION_TIME_LIMIT_MS / 2)).toBe(BASE_CORRECT_POINTS + MAX_SPEED_BONUS / 2);
  });

  it('clamps answer times beyond the limit to zero bonus', () => {
    expect(calculateScore(true, QUESTION_TIME_LIMIT_MS * 2)).toBe(BASE_CORRECT_POINTS);
  });
});
