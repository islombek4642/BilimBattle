// frontend/src/screens/WaitingScreen.tsx
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import { useGameSocketContext } from '../context/GameSocketContext';
import { buildInviteLink, shareInviteLink } from '../telegram/webApp';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { BattleAvatar } from '../components/BattleAvatar';

const VS_REVEAL_MS = 1800;

export function WaitingScreen({
  level,
  intent,
}: {
  level: number;
  intent: 'quick' | 'invite' | 'joining';
}) {
  const { user } = useAuth();
  const { replace, goBack } = useNavigation();
  const {
    matchFound,
    opponent,
    clearMatchFound,
    leaveLevelQueue,
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
  }, [matchFound]);

  // `GameSocketProvider` sits above `NavigationProvider`, so `matchFound`/
  // `inviteCreated`/`inviteExpired` persist across mount/unmount as the user
  // navigates between screens. Without this cleanup, a match that lands
  // right as the user cancels (leave_queue is fire-and-forget, no ack) would
  // sit in state and get picked up as stale data the next time this screen
  // mounts for an unrelated queue/invite. `opponent` is deliberately NOT
  // cleared here - it needs to survive into BattleScreen (see BattleScreen's
  // own unmount cleanup for where it's cleared).
  //
  // This MUST be its own effect with a stable (never-changing) dependency
  // array, not folded into the effect above. clearMatchFound/etc are stable
  // useCallback references, so this cleanup only fires on true unmount. If
  // `matchFound` were a dependency here (as it was in an earlier, buggy
  // version), React would run this cleanup on every `matchFound` CHANGE, not
  // just unmount - immediately clearing `matchFound` back to null the
  // instant it arrives, before the VS-reveal timer effect below ever gets a
  // render where `showVs` and `matchFound` are both truthy at once. The
  // symptom in production was a match that paired successfully (VS screen
  // showed real names/photos) but never advanced to the battle screen -
  // stuck on VS forever, because the timer's guard condition never passed.
  // Confirmed via a real (non-mocked) GameSocketProvider + fake-socket
  // integration test - the mocked-context unit test alone did not catch
  // this, since a static mock's clearMatchFound() has no reactive effect on
  // the next render the way the real hook's state setter does.
  useEffect(() => {
    return () => {
      clearMatchFound();
      clearInviteCreated();
      clearInviteExpired();
    };
  }, [clearMatchFound, clearInviteCreated, clearInviteExpired]);

  useEffect(() => {
    if (!showVs || !matchFound) return;
    const timer = setTimeout(() => {
      replace({ name: 'battle', gameId: matchFound.gameId, level: matchFound.level ?? level });
      clearMatchFound();
    }, VS_REVEAL_MS);
    return () => clearTimeout(timer);
  }, [showVs, matchFound, replace, clearMatchFound]);

  // Elapsed time while actively searching, so the wait doesn't feel
  // indefinite/frozen. Resets to 0 (via the `!showVs` guard tearing the
  // interval down and a fresh one starting) if this screen is reused for a
  // new search after cancelling.
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    if (showVs) return;
    setElapsedSeconds(0);
    const start = Date.now();
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [showVs]);

  const handleCancel = () => {
    if (intent === 'quick') {
      leaveLevelQueue(level);
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
      <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-gradient-to-br from-ios-blue/10 via-ios-bg to-ios-red/10 p-6 text-center">
        <div className="flex animate-vs-reveal items-center gap-6">
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
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 p-6 text-center">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <div className="absolute h-20 w-20 animate-ping rounded-full bg-ios-blue/20" />
        <div className="h-14 w-14 rounded-full bg-ios-blue/10" />
      </div>
      <p className="text-lg font-medium text-ios-label">
        {intent === 'joining'
          ? "Do'stingiz o'yiniga ulanmoqda..."
          : intent === 'invite'
            ? `${level}-bosqich bo'yicha taklif havolasi tayyorlanmoqda...`
            : `${level}-bosqich bo'yicha raqib qidirilmoqda...`}
      </p>
      <p className="text-sm tabular-nums text-ios-secondary-label" data-testid="waiting-elapsed">
        {elapsedSeconds}s
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
