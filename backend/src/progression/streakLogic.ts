// backend/src/progression/streakLogic.ts

// All date arithmetic here operates on UTC calendar dates (not the user's
// local time zone) - a documented simplification (see the design spec) that
// avoids needing per-user timezone data for a first version of daily streaks.
function toUtcDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysBetween(a: Date, b: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((toUtcDateOnly(a).getTime() - toUtcDateOnly(b).getTime()) / MS_PER_DAY);
}

// Monday-start week boundary, matching the wider product's weekly cadence
// (Daily Quest/League design docs both reset weekly) - used only to decide
// whether a streak-freeze was already spent "this week".
export function mostRecentMonday(date: Date): Date {
  const d = toUtcDateOnly(date);
  const day = d.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
  const diffToMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  return d;
}

// Whether a streak-freeze is available to spend: either none has ever been
// used, or the most recent use was in a prior week (before this week's
// Monday) - freezes replenish weekly.
export function isFreezeAvailable(referenceDate: Date, streakFreezeUsedAt: Date | null): boolean {
  return !streakFreezeUsedAt || daysBetween(mostRecentMonday(referenceDate), streakFreezeUsedAt) > 0;
}

export interface StreakState {
  dailyStreak: number;
  bestDailyStreak: number;
  lastActiveDate: Date | null;
  streakFreezeUsedAt: Date | null;
}

export interface StreakUpdateResult extends StreakState {
  alreadyRecordedToday: boolean;
}

// Pure function - no DB access - so it's fully unit-testable without
// Postgres. The caller (users/userRepository.ts's recordDailyActivity) is
// responsible for reading the current state and persisting the result.
export function computeStreakUpdate(today: Date, current: StreakState): StreakUpdateResult {
  if (current.lastActiveDate && daysBetween(today, current.lastActiveDate) === 0) {
    // Already recorded activity today (e.g. a second match same day) -
    // streak must not be incremented twice for one day.
    return { ...current, alreadyRecordedToday: true };
  }

  const gap = current.lastActiveDate ? daysBetween(today, current.lastActiveDate) : null;

  if (gap === 1) {
    const newStreak = current.dailyStreak + 1;
    return {
      dailyStreak: newStreak,
      bestDailyStreak: Math.max(current.bestDailyStreak, newStreak),
      lastActiveDate: today,
      streakFreezeUsedAt: current.streakFreezeUsedAt,
      alreadyRecordedToday: false,
    };
  }

  const freezeAvailable = isFreezeAvailable(today, current.streakFreezeUsedAt);
  if (gap === 2 && freezeAvailable) {
    const newStreak = current.dailyStreak + 1;
    return {
      dailyStreak: newStreak,
      bestDailyStreak: Math.max(current.bestDailyStreak, newStreak),
      lastActiveDate: today,
      streakFreezeUsedAt: today,
      alreadyRecordedToday: false,
    };
  }

  // No prior activity, or too large a gap with no freeze available - streak
  // restarts at 1 (today's own activity).
  return {
    dailyStreak: 1,
    bestDailyStreak: Math.max(current.bestDailyStreak, 1),
    lastActiveDate: today,
    streakFreezeUsedAt: current.streakFreezeUsedAt,
    alreadyRecordedToday: false,
  };
}
