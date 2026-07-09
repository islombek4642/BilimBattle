// frontend/src/components/BattleHeader.tsx
import { useAuth } from '../context/AuthContext';
import { BattleAvatar } from './BattleAvatar';
import { ScoreEntry } from '../api/types';
import { OpponentInfo } from '../socket/useGameSocket';
import { findMyScore, findOpponentScore } from '../utils/score';

// At a 500-point lead, the bar is fully at one edge. Chosen as a simple,
// legible starting point (a 7-question match's realistic score spread) -
// adjustable later without needing to touch anything else.
const MAX_SWING_POINTS = 500;

export function BattleHeader({
  scores,
  opponent,
  questionIndex,
  totalQuestions,
}: {
  scores: ScoreEntry[];
  opponent: OpponentInfo | null;
  questionIndex: number;
  totalQuestions: number;
}) {
  const { user } = useAuth();
  const myUserId = user?.id ?? -1;
  const myScore = findMyScore(scores, myUserId);
  const opponentScore = findOpponentScore(scores, myUserId);

  const rawPosition = 50 + ((myScore - opponentScore) / MAX_SWING_POINTS) * 50;
  const position = Math.min(100, Math.max(0, rawPosition));

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-ios-card p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BattleAvatar telegramId={user?.telegramId ?? null} size={36} borderColorClass="border-ios-blue" />
          <span className="text-sm font-semibold text-ios-blue">{user?.firstName ?? 'Siz'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ios-red">{opponent?.firstName ?? 'Raqib'}</span>
          <BattleAvatar telegramId={opponent?.telegramId ?? null} size={36} borderColorClass="border-ios-red" />
        </div>
      </div>
      <span className="text-center text-xs font-semibold tabular-nums text-ios-secondary-label">
        {questionIndex + 1}/{totalQuestions}
      </span>
      <div className="flex h-2 w-full overflow-hidden rounded-full">
        <div data-testid="tugofwar-blue" className="h-full bg-ios-blue transition-all duration-300" style={{ width: `${position}%` }} />
        <div data-testid="tugofwar-red" className="h-full bg-ios-red transition-all duration-300" style={{ width: `${100 - position}%` }} />
      </div>
    </div>
  );
}
