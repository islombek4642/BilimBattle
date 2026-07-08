// frontend/src/screens/SettingsScreen.tsx
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import { getMyStats } from '../api/stats';
import { Stats } from '../api/types';
import { SOUND_KEY, isSoundEnabled } from '../utils/settings';

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
    <div className="flex flex-col gap-6 p-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <h2 className="text-lg font-bold text-ios-label">Sozlamalar</h2>

      <div className="rounded-2xl bg-ios-card px-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
        <div className="flex items-center justify-between py-3.5">
          <span className="text-ios-label">Ovoz/Vibratsiya</span>
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
        </div>
      </div>

      {loading && <p className="text-sm text-ios-secondary-label">Yuklanmoqda...</p>}
      {!loading && error && (
        <p className="text-sm text-ios-red">Statistikani yuklab bo'lmadi.</p>
      )}
      {!loading && !error && stats && (
        <div className="flex flex-col gap-2 rounded-2xl bg-ios-card p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
          {[
            { label: "O'ynagan o'yinlar", value: stats.gamesPlayed },
            { label: "G'alaba foizi", value: `${stats.winRate}%` },
            { label: 'Joriy seriya', value: stats.currentStreak },
            { label: 'Eng uzun seriya', value: stats.bestStreak },
            { label: 'Reyting', value: stats.rating },
          ].map((row, i, arr) => (
            <div
              key={row.label}
              className={`flex items-center justify-between py-2 ${
                i < arr.length - 1 ? 'border-b border-ios-divider' : ''
              }`}
            >
              <span className="text-sm text-ios-secondary-label">{row.label}</span>
              <span className="font-semibold tabular-nums text-ios-label">{row.value}</span>
            </div>
          ))}
        </div>
      )}

      {isAdmin && (
        <button
          type="button"
          onClick={() => navigate({ name: 'admin' })}
          className="rounded-2xl bg-ios-card px-4 py-3.5 text-left font-medium text-ios-blue shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]"
        >
          Admin statistikasi
        </button>
      )}
    </div>
  );
}
