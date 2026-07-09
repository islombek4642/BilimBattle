// frontend/src/screens/WaitingScreen.tsx
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import { useGameSocketContext } from '../context/GameSocketContext';
import { categoryLabel } from '../utils/category';
import { buildInviteLink, shareInviteLink } from '../telegram/webApp';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { BattleAvatar } from '../components/BattleAvatar';

const VS_REVEAL_MS = 1800;

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
    opponent,
    clearMatchFound,
    leaveQueue,
    inviteCreated,
    clearInviteCreated,
    inviteExpired,
    clearInviteExpired,
    connected,
  } = useGameSocketContext();
  const [showVs, setShowVs] = useState(false);

  useEffect(() => {
    if (matchFound) {
      setShowVs(true);
    }
    // `GameSocketProvider` sits above `NavigationProvider`, so `matchFound`/
    // `inviteCreated`/`inviteExpired` persist across mount/unmount as the
    // user navigates between screens. Without this cleanup, a match that
    // lands right as the user cancels (leave_queue is fire-and-forget, no
    // ack) would sit in state and get picked up as stale data the next time
    // this screen mounts for an unrelated queue/invite. `opponent` is
    // deliberately NOT cleared here - it needs to survive into BattleScreen
    // (see BattleScreen's own unmount cleanup for where it's cleared).
    // clearMatchFound/clearInviteCreated/clearInviteExpired are all
    // idempotent, so this is safe to run unconditionally on unmount.
    return () => {
      clearMatchFound();
      clearInviteCreated();
      clearInviteExpired();
    };
  }, [matchFound, clearMatchFound, clearInviteCreated, clearInviteExpired]);

  useEffect(() => {
    if (!showVs || !matchFound) return;
    const timer = setTimeout(() => {
      replace({ name: 'battle', gameId: matchFound.gameId });
      clearMatchFound();
    }, VS_REVEAL_MS);
    return () => clearTimeout(timer);
  }, [showVs, matchFound, replace, clearMatchFound]);

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

  if (showVs) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-8 p-6 text-center">
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-center gap-2">
            <BattleAvatar telegramId={user?.telegramId ?? null} size={72} borderColorClass="border-ios-blue" />
            <span className="font-semibold text-ios-blue">{user?.firstName ?? 'Siz'}</span>
          </div>
          <span className="text-3xl font-black text-ios-label">VS</span>
          <div className="flex flex-col items-center gap-2">
            <BattleAvatar telegramId={opponent?.telegramId ?? null} size={72} borderColorClass="border-ios-red" />
            <span className="font-semibold text-ios-red">{opponent?.firstName ?? 'Raqib'}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-5 p-6 text-center">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <div className="absolute h-20 w-20 animate-ping rounded-full bg-ios-blue/20" />
        <div className="h-14 w-14 rounded-full bg-ios-blue/10" />
      </div>
      <p className="text-lg font-medium text-ios-label">
        {intent === 'joining'
          ? "Do'stingiz o'yiniga ulanmoqda..."
          : `${categoryLabel(category)} bo'yicha raqib qidirilmoqda...`}
      </p>
      {!connected && (
        <p className="text-sm text-ios-red">Aloqa uzildi. Qayta ulanmoqda...</p>
      )}
      {inviteExpired && (
        <p className="text-sm text-ios-red">Taklif muddati tugadi yoki band.</p>
      )}
      {intent === 'invite' && inviteCreated && (
        <p className="text-sm text-ios-secondary-label">Havola yuborildi, do'stingiz kutilmoqda</p>
      )}
      <div className="flex w-full flex-col gap-3">
        {intent === 'invite' && (
          <PrimaryButton onClick={handleShare}>Do'stga ulashish</PrimaryButton>
        )}
        <SecondaryButton onClick={handleCancel}>Bekor qilish</SecondaryButton>
      </div>
    </div>
  );
}
