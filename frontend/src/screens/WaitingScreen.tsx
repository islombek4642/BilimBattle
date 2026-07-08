// frontend/src/screens/WaitingScreen.tsx
import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import { useGameSocketContext } from '../context/GameSocketContext';
import { categoryLabel } from '../utils/category';
import { buildInviteLink, shareInviteLink } from '../telegram/webApp';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';

export function WaitingScreen({
  category,
  intent,
}: {
  category: string;
  intent: 'quick' | 'invite';
}) {
  const { user } = useAuth();
  const { replace, goBack } = useNavigation();
  const { matchFound, clearMatchFound, leaveQueue, inviteCreated } = useGameSocketContext();

  useEffect(() => {
    if (matchFound) {
      replace({ name: 'battle', gameId: matchFound.gameId, category: matchFound.category });
      clearMatchFound();
    }
  }, [matchFound, replace, clearMatchFound]);

  const handleCancel = () => {
    if (intent === 'quick') {
      leaveQueue(category);
    }
    goBack();
  };

  const handleShare = () => {
    if (!user) return;
    const botUsername = import.meta.env.VITE_BOT_USERNAME ?? 'bilimbattle_bot';
    const link = buildInviteLink(botUsername, user.telegramId);
    shareInviteLink(link, "BilimBattle'da men bilan o'ynang!");
  };

  return (
    <div className="flex flex-col items-center gap-4 p-6">
      <p className="text-lg">{categoryLabel(category)} bo'yicha raqib qidirilmoqda...</p>
      {intent === 'invite' && inviteCreated && (
        <p className="text-sm text-gray-500">Havola yuborildi, do'stingiz kutilmoqda</p>
      )}
      {intent === 'invite' && (
        <PrimaryButton onClick={handleShare}>Do'stga ulashish</PrimaryButton>
      )}
      <SecondaryButton onClick={handleCancel}>Bekor qilish</SecondaryButton>
    </div>
  );
}
