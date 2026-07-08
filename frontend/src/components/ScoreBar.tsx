// frontend/src/components/ScoreBar.tsx
import { useAuth } from '../context/AuthContext';
import { ScoreEntry } from '../api/types';
import { findMyScore, findOpponentScore } from '../utils/score';

export function ScoreBar({ scores }: { scores: ScoreEntry[] }) {
  const { user } = useAuth();
  const myUserId = user?.id ?? -1;

  return (
    <div
      className="flex items-center justify-between rounded-2xl bg-ios-card px-5 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]"
      data-testid="score-bar"
    >
      <div className="flex flex-col items-start">
        <span className="text-xs font-medium text-ios-secondary-label">Siz</span>
        <span className="text-xl font-bold text-ios-blue">{findMyScore(scores, myUserId)}</span>
      </div>
      <div className="flex flex-col items-end">
        <span className="text-xs font-medium text-ios-secondary-label">Raqib</span>
        <span className="text-xl font-bold text-ios-label">{findOpponentScore(scores, myUserId)}</span>
      </div>
    </div>
  );
}
