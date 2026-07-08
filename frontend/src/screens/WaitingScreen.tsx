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
  intent: 'quick' | 'invite' | 'joining';
}) {
  const { user } = useAuth();
  const { replace, goBack } = useNavigation();
  const {
    matchFound,
    clearMatchFound,
    leaveQueue,
    inviteCreated,
    clearInviteCreated,
    inviteExpired,
    clearInviteExpired,
    connected,
  } = useGameSocketContext();

  useEffect(() => {
    if (matchFound) {
      replace({ name: 'battle', gameId: matchFound.gameId });
      clearMatchFound();
    }
    // `GameSocketProvider` sits above `NavigationProvider`, so `matchFound`/
    // `inviteCreated`/`inviteExpired` persist across mount/unmount as the
    // user navigates between screens. Without this cleanup, a match that
    // lands right as the user cancels (leave_queue is fire-and-forget, no
    // ack) would sit in state and get picked up as stale data the next time
    // this screen mounts for an unrelated queue/invite.
    // clearMatchFound/clearInviteCreated/clearInviteExpired are idempotent,
    // so this is safe to run unconditionally on unmount.
    return () => {
      clearMatchFound();
      clearInviteCreated();
      clearInviteExpired();
    };
  }, [matchFound, replace, clearMatchFound, clearInviteCreated, clearInviteExpired]);

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
      <p className="text-lg">
        {intent === 'joining'
          ? "Do'stingiz o'yiniga ulanmoqda..."
          : `${categoryLabel(category)} bo'yicha raqib qidirilmoqda...`}
      </p>
      {!connected && (
        <p className="text-sm text-red-500">Aloqa uzildi. Qayta ulanmoqda...</p>
      )}
      {inviteExpired && (
        <p className="text-sm text-red-500">Taklif muddati tugadi yoki band.</p>
      )}
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
