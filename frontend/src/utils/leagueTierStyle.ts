// frontend/src/utils/leagueTierStyle.ts
import { LeagueTier } from '../api/league';

const LEAGUE_TIER_BORDER_CLASS: Record<LeagueTier, string> = {
  Bronza: 'border-ios-bronze',
  Kumush: 'border-ios-silver',
  Oltin: 'border-ios-gold',
  Platina: 'border-league-platinum',
  Olmos: 'border-league-diamond',
  Usta: 'border-league-master',
  // Same color as Oltin, with an added glow - the top tier reads as
  // "beyond gold" rather than needing a whole separate hue, mirroring
  // MasteryBadge's identical glow treatment for its own top ("Professor")
  // tier.
  Chempion: 'border-ios-gold shadow-[0_0_12px_rgba(255,192,46,0.6)]',
};

export function leagueTierBorderClass(tier: LeagueTier): string {
  return LEAGUE_TIER_BORDER_CLASS[tier];
}
