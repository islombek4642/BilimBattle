// backend/src/progression/masteryTiers.ts
export type MasteryRank = 'Boshlangich' | 'Orta' | 'Yuqori' | 'Usta' | 'Professor';

const CEFR_WEIGHTS: Record<string, number> = {
  A1: 1,
  A2: 2,
  B1: 3,
  B2: 4,
  C1: 5,
  C2: 6,
};

// Unknown/missing CEFR tags default to the easiest weight rather than
// throwing - defensive against any row that might lack a tag (see
// questionRepository.ts's cefr_level column, which is nullable).
export function cefrWeight(cefrLevel: string | null | undefined): number {
  if (!cefrLevel) return 1;
  return CEFR_WEIGHTS[cefrLevel] ?? 1;
}

interface MasteryTierBoundary {
  rank: MasteryRank;
  minPoints: number;
}

// Checked from highest to lowest so the first match wins. Thresholds are a
// deliberate design choice (see the design spec) tuned so ~30 days of
// regular play reaches Orta, ~90 days reaches Yuqori/Usta, and ~1 year
// reaches Professor - not derived from real play data yet.
const MASTERY_TIERS: MasteryTierBoundary[] = [
  { rank: 'Professor', minPoints: 3000 },
  { rank: 'Usta', minPoints: 1200 },
  { rank: 'Yuqori', minPoints: 450 },
  { rank: 'Orta', minPoints: 150 },
  { rank: 'Boshlangich', minPoints: 0 },
];

export function masteryRankForPoints(masteryPoints: number): MasteryRank {
  const tier = MASTERY_TIERS.find((t) => masteryPoints >= t.minPoints);
  return tier?.rank ?? 'Boshlangich';
}
