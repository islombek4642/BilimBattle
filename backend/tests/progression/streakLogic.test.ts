import { computeStreakUpdate, mostRecentMonday } from '../../src/progression/streakLogic';

const DAY = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe('computeStreakUpdate', () => {
  it('starts a fresh streak at 1 for a user with no prior activity', () => {
    const result = computeStreakUpdate(DAY(2026, 7, 15), {
      dailyStreak: 0,
      bestDailyStreak: 0,
      lastActiveDate: null,
      streakFreezeUsedAt: null,
    });
    expect(result.dailyStreak).toBe(1);
    expect(result.bestDailyStreak).toBe(1);
    expect(result.alreadyRecordedToday).toBe(false);
  });

  it('does not double-count a second activity on the same day', () => {
    const result = computeStreakUpdate(DAY(2026, 7, 15), {
      dailyStreak: 4,
      bestDailyStreak: 4,
      lastActiveDate: DAY(2026, 7, 15),
      streakFreezeUsedAt: null,
    });
    expect(result.dailyStreak).toBe(4);
    expect(result.alreadyRecordedToday).toBe(true);
  });

  it('increments the streak when activity continues on the very next day', () => {
    const result = computeStreakUpdate(DAY(2026, 7, 15), {
      dailyStreak: 4,
      bestDailyStreak: 4,
      lastActiveDate: DAY(2026, 7, 14),
      streakFreezeUsedAt: null,
    });
    expect(result.dailyStreak).toBe(5);
    expect(result.bestDailyStreak).toBe(5);
  });

  it('resets the streak to 1 after a gap with no freeze available', () => {
    const result = computeStreakUpdate(DAY(2026, 7, 15), {
      dailyStreak: 10,
      bestDailyStreak: 10,
      lastActiveDate: DAY(2026, 7, 10),
      streakFreezeUsedAt: null,
    });
    expect(result.dailyStreak).toBe(1);
    expect(result.bestDailyStreak).toBe(10);
  });

  it('preserves the streak across a single missed day by spending the weekly freeze', () => {
    // 2026-07-13 is a Monday, 2026-07-15 is the following Wednesday - exactly
    // one day (Tuesday) was missed.
    const result = computeStreakUpdate(DAY(2026, 7, 15), {
      dailyStreak: 6,
      bestDailyStreak: 6,
      lastActiveDate: DAY(2026, 7, 13),
      streakFreezeUsedAt: null,
    });
    expect(result.dailyStreak).toBe(7);
    expect(result.streakFreezeUsedAt).toEqual(DAY(2026, 7, 15));
  });

  it('does not apply a second freeze within the same week', () => {
    const result = computeStreakUpdate(DAY(2026, 7, 16), {
      dailyStreak: 7,
      bestDailyStreak: 7,
      lastActiveDate: DAY(2026, 7, 14),
      streakFreezeUsedAt: DAY(2026, 7, 15),
    });
    expect(result.dailyStreak).toBe(1);
  });
});

describe('mostRecentMonday', () => {
  it('returns the same date when given a Monday', () => {
    expect(mostRecentMonday(DAY(2026, 7, 13))).toEqual(DAY(2026, 7, 13));
  });

  it('returns the preceding Monday for a Sunday', () => {
    expect(mostRecentMonday(DAY(2026, 7, 19))).toEqual(DAY(2026, 7, 13));
  });
});
