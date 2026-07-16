// backend/src/league/leagueTiers.ts
export type LeagueTier = 'Bronza' | 'Kumush' | 'Oltin' | 'Platina' | 'Olmos' | 'Usta' | 'Chempion';

export const LEAGUE_TIERS: LeagueTier[] = ['Bronza', 'Kumush', 'Oltin', 'Platina', 'Olmos', 'Usta', 'Chempion'];

const PROMOTION_FRACTION = 0.2;
const RELEGATION_FRACTION = 0.2;

export interface BracketMember {
  userId: number;
  weeklyXp: number;
}

export interface TierChange {
  userId: number;
  newTier: LeagueTier;
}

// Ranks one tier's bracket by weekly XP (descending) and returns the tier
// change for each member who is promoted or demoted - top ~20% up one tier
// (no-op at Chempion, the highest), bottom ~20% down one tier (no-op at
// Bronza, the lowest - see the design spec's "never relegate below Bronza"
// rule). Members not in either band are omitted from the result (their
// tier doesn't change). Fractions are floored, so small brackets (where
// 20% rounds down to 0) simply produce no changes that round.
export function computeTierChanges(tier: LeagueTier, members: BracketMember[]): TierChange[] {
  if (members.length === 0) return [];

  const sorted = [...members].sort((a, b) => b.weeklyXp - a.weeklyXp);
  const promoteCount = Math.floor(sorted.length * PROMOTION_FRACTION);
  const relegateCount = Math.floor(sorted.length * RELEGATION_FRACTION);

  const tierIndex = LEAGUE_TIERS.indexOf(tier);
  const changes: TierChange[] = [];

  if (tierIndex < LEAGUE_TIERS.length - 1) {
    for (let i = 0; i < promoteCount; i += 1) {
      changes.push({ userId: sorted[i].userId, newTier: LEAGUE_TIERS[tierIndex + 1] });
    }
  }

  if (tierIndex > 0) {
    for (let i = 0; i < relegateCount; i += 1) {
      const member = sorted[sorted.length - 1 - i];
      // A member already slated for promotion (only possible in a bracket
      // small enough that promoteCount + relegateCount > length) must not
      // also be relegated - promotion wins.
      if (changes.some((c) => c.userId === member.userId)) continue;
      changes.push({ userId: member.userId, newTier: LEAGUE_TIERS[tierIndex - 1] });
    }
  }

  return changes;
}
