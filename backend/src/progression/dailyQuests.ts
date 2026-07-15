// backend/src/progression/dailyQuests.ts

export type DailyQuestMetric = 'matchesPlayed' | 'correctAnswers' | 'bestStarsToday';

export interface DailyQuestDefinition {
  key: string;
  label: string;
  target: number;
  metric: DailyQuestMetric;
}

// Static catalog, same pattern as achievements.ts's ACHIEVEMENTS - fixed,
// versioned with the code. Scoped to ingliz_tili activity only (see the
// design spec) since XP/Mastery tracking itself is English-only in this
// first version.
export const DAILY_QUESTS: DailyQuestDefinition[] = [
  { key: 'matches_3', label: "Bugun 3 ta jang o'ynang", target: 3, metric: 'matchesPlayed' },
  { key: 'correct_10', label: "10 ta savolga to'g'ri javob bering", target: 10, metric: 'correctAnswers' },
  { key: 'stars_2', label: 'Kamida bitta darajada 2+ yulduz oling', target: 2, metric: 'bestStarsToday' },
];
