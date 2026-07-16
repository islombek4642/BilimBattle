// frontend/src/screens/SettingsScreen.tsx
import { ReactNode, useEffect, useState } from 'react';
import { SpeakerHigh, Percent, Flame, Medal, ShieldCheck, CaretRight } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import { getMyStats } from '../api/stats';
import { Stats } from '../api/types';
import { SOUND_KEY, isSoundEnabled } from '../utils/settings';
import { BattleAvatar } from '../components/BattleAvatar';
import { getProfile, ProfileResponse } from '../api/profile';
import { getMyLeague, LeagueResponse } from '../api/league';
import { MasteryBadge } from '../components/MasteryBadge';
import { leagueTierBorderClass } from '../utils/leagueTierStyle';

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
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [league, setLeague] = useState<LeagueResponse | null>(null);

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

    // Independent of the stats fetch above (which alone gates this screen's
    // loading/error state) - these two only decorate the "Mening profilim"
    // avatar with a league-tier border and mastery title, so a slow or
    // failed fetch here must never block or error out the rest of the
    // settings screen.
    getProfile(token)
      .then((res) => {
        if (cancelled) return;
        setProfile(res);
      })
      .catch(() => {});

    getMyLeague(token)
      .then((res) => {
        if (cancelled) return;
        setLeague(res);
      })
      .catch(() => {});

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

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <p className="text-sm text-ios-secondary-label">Yuklanmoqda...</p>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="flex min-h-full items-center justify-center p-6 text-center">
        <p className="text-sm text-ios-red">Statistikani yuklab bo'lmadi.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <h2 className="text-lg font-bold text-ios-label">Sozlamalar</h2>

      <button
        type="button"
        onClick={() => navigate({ name: 'profile' })}
        className="flex items-center gap-3 rounded-2xl bg-ios-card p-4 text-left shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]"
      >
        <BattleAvatar
          telegramId={user?.telegramId ?? null}
          size={48}
          borderColorClass={league ? leagueTierBorderClass(league.tier) : ''}
        />
        <span className="flex-1 font-medium text-ios-label">Mening profilim</span>
        {profile && <MasteryBadge rank={profile.masteryRank} />}
        <CaretRight size={16} className="text-ios-secondary-label" />
      </button>

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
