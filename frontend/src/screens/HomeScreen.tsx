// frontend/src/screens/HomeScreen.tsx
import { Lightning, UserPlus } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { BattleAvatar } from '../components/BattleAvatar';

export function HomeScreen() {
  const { user } = useAuth();
  const { navigate } = useNavigation();

  if (!user) return null;

  const winRate = user.gamesPlayed ? Math.round((user.gamesWon / user.gamesPlayed) * 100) : 0;

  return (
    <div className="flex min-h-full flex-col gap-6 p-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-ios-card px-6 py-6 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
        <BattleAvatar telegramId={user.telegramId ?? null} size={72} />
        <div className="text-center">
          <p className="text-xl font-bold text-ios-label">{user.firstName}</p>
          {user.username && <p className="text-sm text-ios-secondary-label">@{user.username}</p>}
        </div>

        <div className="mt-1 flex w-full items-stretch border-t border-ios-divider pt-3">
          <div className="flex flex-1 flex-col items-center gap-0.5">
            <span className="text-lg font-bold tabular-nums text-ios-label">{user.gamesPlayed ?? 0}</span>
            <span className="text-xs text-ios-secondary-label">O'yinlar</span>
          </div>
          <div className="w-px bg-ios-divider" />
          <div className="flex flex-1 flex-col items-center gap-0.5">
            <span className="text-lg font-bold tabular-nums text-ios-green">{winRate}%</span>
            <span className="text-xs text-ios-secondary-label">G'alaba</span>
          </div>
          <div className="w-px bg-ios-divider" />
          <div className="flex flex-1 flex-col items-center gap-0.5">
            <span className="text-lg font-bold tabular-nums text-ios-blue">{user.rating}</span>
            <span className="text-xs text-ios-secondary-label">Reyting</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <PrimaryButton onClick={() => navigate({ name: 'categorySelect', intent: 'quick' })}>
          <span className="flex items-center justify-center gap-2">
            <Lightning size={20} weight="fill" />
            Tezkor o'yin
          </span>
        </PrimaryButton>
        <SecondaryButton onClick={() => navigate({ name: 'categorySelect', intent: 'invite' })}>
          <span className="flex items-center justify-center gap-2">
            <UserPlus size={20} weight="fill" />
            Do'stni chaqirish
          </span>
        </SecondaryButton>
      </div>
    </div>
  );
}
