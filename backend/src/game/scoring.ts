export const QUESTION_TIME_LIMIT_MS = 10_000;
export const BASE_CORRECT_POINTS = 100;
export const MAX_SPEED_BONUS = 100;

/**
 * Calculates the score for a single answer.
 *
 * - Incorrect answers always score 0, regardless of speed.
 * - Correct answers earn BASE_CORRECT_POINTS plus a speed bonus that falls
 *   off linearly from MAX_SPEED_BONUS (instant answer) to 0 (answer at or
 *   beyond the time limit).
 *
 * `answerTimeMs` is clamped to the [0, QUESTION_TIME_LIMIT_MS] range before
 * the bonus is computed, so callers do not need to pre-validate it: negative
 * values (e.g. from clock skew) are treated as an instant answer, and values
 * beyond the limit are treated as a zero-bonus, on-time answer rather than
 * being rejected or scored negatively.
 */
export function calculateScore(isCorrect: boolean, answerTimeMs: number): number {
  if (!isCorrect) return 0;
  const clampedTime = Math.min(Math.max(answerTimeMs, 0), QUESTION_TIME_LIMIT_MS);
  const remainingMs = QUESTION_TIME_LIMIT_MS - clampedTime;
  const speedBonus = Math.round((remainingMs / QUESTION_TIME_LIMIT_MS) * MAX_SPEED_BONUS);
  return BASE_CORRECT_POINTS + speedBonus;
}
