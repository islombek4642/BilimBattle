// frontend/src/components/MasteryBadge.tsx
import { MasteryRank } from '../api/profile';

const RANK_LABEL: Record<MasteryRank, string> = {
  Boshlangich: "Boshlang'ich",
  Orta: "O'rta",
  Yuqori: 'Yuqori',
  Usta: 'Usta',
  Professor: 'Professor',
};

// Reuses the app's existing iOS color tokens rather than inventing new ones
// - a deliberate "light intensity" progression from neutral gray up to a
// glowing gold at the top tier (see the design spec's Art Direction
// reference), each tier one step further along the SAME palette the rest of
// the app already uses.
const RANK_CLASSNAME: Record<MasteryRank, string> = {
  Boshlangich: 'bg-ios-bg text-ios-secondary-label',
  Orta: 'bg-ios-blue/10 text-ios-blue',
  Yuqori: 'bg-ios-green/10 text-ios-green',
  Usta: 'bg-ios-purple/10 text-ios-purple',
  Professor: 'bg-ios-gold/10 text-ios-gold shadow-[0_0_12px_rgba(255,192,46,0.5)]',
};

export function MasteryBadge({ rank }: { rank: MasteryRank }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ${RANK_CLASSNAME[rank]}`}>
      {RANK_LABEL[rank]}
    </span>
  );
}
