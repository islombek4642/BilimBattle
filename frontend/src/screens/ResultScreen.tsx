// frontend/src/screens/ResultScreen.tsx
import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import { useGameSocketContext } from '../context/GameSocketContext';
import { shareInviteLink } from '../telegram/webApp';
import { findMyScore, findOpponentScore } from '../utils/score';
import { playResultFeedback } from '../utils/feedback';
import { ScoreEntry } from '../api/types';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';

const HP_MAX = 500;

// A star rating for the WINNER only, based on how much HP they had left
// (i.e. how little the loser managed to score) when the match ended - a
// near-full-HP win (the loser barely scored) is a 5-star "dominant" victory,
// a narrow win (the loser almost caught up) is a 1-star "close call".
export function calculateStars(loserScore: number): number {
  const remainingHpPct = Math.max(0, (HP_MAX - loserScore) / HP_MAX) * 100;
  if (remainingHpPct >= 80) return 5;
  if (remainingHpPct >= 60) return 4;
  if (remainingHpPct >= 40) return 3;
  if (remainingHpPct >= 20) return 2;
  return 1;
}

export function ResultScreen({
  scores,
  winnerId,
  forfeited,
  knockout,
  level,
  levelStars,
}: {
  scores: ScoreEntry[];
  winnerId: number | null;
  forfeited: boolean;
  knockout: boolean;
  level: number;
  levelStars?: number;
}) {
  const { user } = useAuth();
  const { reset } = useNavigation();
  const { joinLevelQueue } = useGameSocketContext();
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
  const isLevelResult = levelStars !== undefined;

  const handlePlayAgain = () => {
    joinLevelQueue(level);
    reset({ name: 'waiting', level, intent: 'quick' });
  };

  if (isLevelResult) {
    return (
      <div className="flex min-h-full flex-col justify-center gap-8 p-6">
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-ios-card px-6 py-10 text-center shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
          <h2 className="text-2xl font-bold text-ios-label">{level}-bosqich tugadi!</h2>
          <div className="flex gap-1" data-testid="level-stars">
            {Array.from({ length: 3 }, (_, i) => (
              <span
                key={i}
                className={`animate-star-pop text-3xl ${i < levelStars ? 'text-ios-gold' : 'text-ios-divider'}`}
                style={{ animationDelay: `${i * 150}ms` }}
              >
                ★
              </span>
            ))}
          </div>
          <div className="mt-2 flex flex-col items-center">
            <span className="text-xs font-medium text-ios-secondary-label">Sizning ballingiz</span>
            <span className="text-4xl font-bold tabular-nums text-ios-label">{myScore}</span>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <PrimaryButton onClick={handlePlayAgain}>Yana o'ynash</PrimaryButton>
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

  const opponentScore = findOpponentScore(scores, user.id);
  const resultText = isDraw ? 'Durrang!' : isWinner ? "G'alaba qozondingiz!" : "Mag'lubiyat";
  // Stars are a "how good was this win" signal - a forfeit win isn't a
  // battle performance to rate, so it's excluded even though the player
  // technically won.
  const showStars = isWinner && !forfeited;
  const stars = showStars ? calculateStars(opponentScore) : 0;

  const handleShare = () => {
    const botUsername = import.meta.env.VITE_BOT_USERNAME ?? 'bilimbattle_bot';
    shareInviteLink(`https://t.me/${botUsername}`, `BilimBattle'da ${myScore} ball to'pladim!`);
  };

  const resultColor = isDraw ? 'text-ios-secondary-label' : isWinner ? 'text-ios-green' : 'text-ios-red';

  return (
    <div className="flex min-h-full flex-col justify-center gap-8 p-6">
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-ios-card px-6 py-10 text-center shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
        <h2 className={`text-2xl font-bold ${resultColor}`}>{resultText}</h2>
        {forfeited && (
          <p className="text-sm text-ios-secondary-label">Raqibingiz o'yindan chiqib ketdi</p>
        )}
        {showStars && (
          <div className="flex gap-1" data-testid="victory-stars">
            {Array.from({ length: 5 }, (_, i) => (
              <span
                key={i}
                className={`animate-star-pop text-2xl ${i < stars ? 'text-ios-gold' : 'text-ios-divider'}`}
                style={{ animationDelay: `${i * 150}ms` }}
              >
                ★
              </span>
            ))}
          </div>
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
