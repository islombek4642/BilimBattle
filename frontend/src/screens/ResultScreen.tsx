// frontend/src/screens/ResultScreen.tsx
import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import { useGameSocketContext } from '../context/GameSocketContext';
import { shareInviteLink } from '../telegram/webApp';
import { findMyScore } from '../utils/score';
import { playResultFeedback } from '../utils/feedback';
import { ScoreEntry } from '../api/types';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';

export function ResultScreen({
  scores,
  winnerId,
  forfeited,
  category,
}: {
  scores: ScoreEntry[];
  winnerId: number | null;
  forfeited: boolean;
  category: string;
}) {
  const { user } = useAuth();
  const { reset } = useNavigation();
  const { joinQueue } = useGameSocketContext();
  const isWinner = winnerId === user?.id;
  const isDraw = winnerId === null;

  // Fires once on mount (the outcome for a given result screen never
  // changes) - not gated behind the `!user` guard below since hooks must
  // run unconditionally on every render; user is always set by the time
  // this screen is reachable in practice (see HomeScreen's identical guard).
  useEffect(() => {
    if (!user) return;
    playResultFeedback(isDraw ? 'draw' : isWinner ? 'win' : 'loss');
  }, []);

  if (!user) return null;

  const myScore = findMyScore(scores, user.id);
  const resultText = isDraw ? 'Durrang!' : isWinner ? "G'alaba qozondingiz!" : "Mag'lubiyat";

  const handleShare = () => {
    const botUsername = import.meta.env.VITE_BOT_USERNAME ?? 'bilimbattle_bot';
    shareInviteLink(`https://t.me/${botUsername}`, `BilimBattle'da ${myScore} ball to'pladim!`);
  };

  const handlePlayAgain = () => {
    joinQueue(category);
    reset({ name: 'waiting', category, intent: 'quick' });
  };

  const resultColor = isDraw ? 'text-ios-secondary-label' : isWinner ? 'text-ios-green' : 'text-ios-red';

  return (
    <div className="flex min-h-full flex-col justify-center gap-8 p-6">
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-ios-card px-6 py-10 text-center shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
        <h2 className={`text-2xl font-bold ${resultColor}`}>{resultText}</h2>
        {forfeited && (
          <p className="text-sm text-ios-secondary-label">Raqibingiz o'yindan chiqib ketdi</p>
        )}
        <div className="mt-2 flex flex-col items-center">
          <span className="text-xs font-medium text-ios-secondary-label">Sizning ballingiz</span>
          <span className="text-4xl font-bold tabular-nums text-ios-label">{myScore}</span>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <PrimaryButton onClick={handlePlayAgain}>Yana o'ynash</PrimaryButton>
        <SecondaryButton onClick={handleShare}>Do'stga ulashish</SecondaryButton>
        <button
          type="button"
          onClick={() => reset({ name: 'home' })}
          className="py-2 text-sm font-medium text-ios-secondary-label"
        >
          Bosh sahifa
        </button>
      </div>
    </div>
  );
}
