// frontend/src/screens/ResultScreen.tsx
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import { shareInviteLink } from '../telegram/webApp';
import { findMyScore } from '../utils/score';
import { ScoreEntry } from '../api/types';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';

export function ResultScreen({
  scores,
  winnerId,
  forfeited,
}: {
  scores: ScoreEntry[];
  winnerId: number | null;
  forfeited: boolean;
}) {
  const { user } = useAuth();
  const { reset } = useNavigation();

  if (!user) return null;

  const myScore = findMyScore(scores, user.id);
  const isWinner = winnerId === user.id;
  const isDraw = winnerId === null;
  const resultText = isDraw ? 'Durrang!' : isWinner ? "G'alaba qozondingiz!" : "Mag'lubiyat";

  const handleShare = () => {
    const botUsername = import.meta.env.VITE_BOT_USERNAME ?? 'bilimbattle_bot';
    shareInviteLink(`https://t.me/${botUsername}`, `BilimBattle'da ${myScore} ball to'pladim!`);
  };

  return (
    <div className="flex flex-col items-center gap-4 p-6">
      <h2 className="text-2xl font-bold">{resultText}</h2>
      {forfeited && <p className="text-sm text-gray-500">Raqibingiz o'yindan chiqib ketdi</p>}
      <p className="text-lg">Sizning ballingiz: {myScore}</p>
      <PrimaryButton onClick={() => reset({ name: 'home' })}>Yana o'ynash</PrimaryButton>
      <SecondaryButton onClick={handleShare}>Do'stga ulashish</SecondaryButton>
    </div>
  );
}
