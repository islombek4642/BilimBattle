// frontend/src/components/ScoreBar.tsx
import { useAuth } from '../context/AuthContext';
import { ScoreEntry } from '../api/types';
import { findMyScore, findOpponentScore } from '../utils/score';

export function ScoreBar({ scores }: { scores: ScoreEntry[] }) {
  const { user } = useAuth();
  const myUserId = user?.id ?? -1;

  return (
    <div className="flex justify-between text-sm font-semibold" data-testid="score-bar">
      <span>Siz: {findMyScore(scores, myUserId)}</span>
      <span>Raqib: {findOpponentScore(scores, myUserId)}</span>
    </div>
  );
}
