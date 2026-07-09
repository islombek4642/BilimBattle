// frontend/src/screens/SettingsScreen.tsx
import { ReactNode, useEffect, useState } from 'react';
import { SpeakerHigh, Percent, Flame, Medal, ShieldCheck, CaretRight } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import { getMyStats } from '../api/stats';
import { Stats } from '../api/types';
import { SOUND_KEY, isSoundEnabled } from '../utils/settings';
import { BattleAvatar } from '../components/BattleAvatar';

export function SettingsScreen() {
  const { token, user } = useAuth();
  const { navigate } = useNavigation();
  const adminTelegramId = import.meta.env.VITE_ADMIN_TELEGRAM_ID
    ? Number(import.meta.env.VITE_ADMIN_TELEGRAM_ID)
    : null;
  const isAdmin = adminTelegramId !== null && user?.telegramId === adminTelegramId;
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(isSoundEnabled);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    setLoading(true);
    setError(false);

    getMyStats(token)
      .then((res) => {
        if (cancelled) return;
        setStats(res);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    try {
      localStorage.setItem(SOUND_KEY, String(next));
    } catch {
      // Storage unavailable (private mode, restricted WebView) - preference
      // just won't persist across sessions; not worth surfacing to the user.
    }
  };

  return (
    <div className="flex flex-col gap-4 p-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <h2 className="text-lg font-bold text-ios-label">Sozlamalar</h2>

      <div className="flex flex-col items-center gap-3 rounded-2xl bg-ios-card p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
        <BattleAvatar telegramId={user?.telegramId ?? null} size={72} />
        <div className="text-center">
          <p className="font-bold text-ios-label">{user?.firstName}</p>
          {user?.username && <p className="text-sm text-ios-secondary-label">@{user.username}</p>}
        </div>

        {!loading && !error && stats && (
          <div className="mt-1 flex w-full items-stretch border-t border-ios-divider pt-3">
            <div className="flex flex-1 flex-col items-center gap-0.5">
              <span className="text-lg font-bold tabular-nums text-ios-label">{stats.gamesPlayed}</span>
              <span className="text-xs text-ios-secondary-label">O'yinlar</span>
            </div>
            <div className="w-px bg-ios-divider" />
            <div className="flex flex-1 flex-col items-center gap-0.5">
              <span className="text-lg font-bold tabular-nums text-ios-blue">{stats.rating}</span>
              <span className="text-xs text-ios-secondary-label">Reyting</span>
            </div>
          </div>
        )}
      </div>

      {loading && <p className="text-sm text-ios-secondary-label">Yuklanmoqda...</p>}
      {!loading && error && <p className="text-sm text-ios-red">Statistikani yuklab bo'lmadi.</p>}

      <div className="flex flex-col rounded-2xl bg-ios-card px-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
        <SettingsRow
          icon={SpeakerHigh}
          iconBgClass="bg-ios-blue"
          label="Ovoz/Vibratsiya"
          right={
            <button
              type="button"
              role="switch"
              aria-checked={soundEnabled}
              aria-label="Ovoz/Vibratsiya"
              onClick={toggleSound}
              className={`relative h-[30px] w-[52px] rounded-full transition-colors duration-200 ${
                soundEnabled ? 'bg-ios-green' : 'bg-ios-divider'
              }`}
            >
              <span
                className={`absolute left-0 top-[3px] h-6 w-6 rounded-full bg-white shadow transition-transform duration-200 ${
                  soundEnabled ? 'translate-x-[25px]' : 'translate-x-[3px]'
                }`}
              />
            </button>
          }
        />

        {!loading && !error && stats && (
          <>
            <SettingsRow
              icon={Percent}
              iconBgClass="bg-ios-green"
              label="G'alaba foizi"
              right={<span className="font-semibold tabular-nums text-ios-label">{stats.winRate}%</span>}
            />
            <SettingsRow
              icon={Flame}
              iconBgClass="bg-ios-orange"
              label="Joriy seriya"
              right={<span className="font-semibold tabular-nums text-ios-label">{stats.currentStreak}</span>}
            />
            <SettingsRow
              icon={Medal}
              iconBgClass="bg-ios-purple"
              label="Eng uzun seriya"
              right={<span className="font-semibold tabular-nums text-ios-label">{stats.bestStreak}</span>}
              last
            />
          </>
        )}
      </div>

      {isAdmin && (
        <div className="rounded-2xl bg-ios-card px-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
          <button
            type="button"
            onClick={() => navigate({ name: 'admin' })}
            className="flex w-full items-center gap-3 py-3.5 text-left"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ios-label text-white">
              <ShieldCheck size={18} weight="fill" />
            </span>
            <span className="flex-1 font-medium text-ios-label">Admin statistikasi</span>
            <CaretRight size={16} className="text-ios-secondary-label" />
          </button>
        </div>
      )}
    </div>
  );
}

function SettingsRow({
  icon: Icon,
  iconBgClass,
  label,
  right,
  last = false,
}: {
  icon: typeof SpeakerHigh;
  iconBgClass: string;
  label: string;
  right: ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 py-3 ${last ? '' : 'border-b border-ios-divider'}`}>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white ${iconBgClass}`}>
        <Icon size={18} weight="fill" />
      </span>
      <span className="flex-1 text-sm text-ios-secondary-label">{label}</span>
      {right}
    </div>
  );
}
