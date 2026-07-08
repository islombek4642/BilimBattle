// frontend/src/screens/SettingsScreen.tsx
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getMyStats } from '../api/stats';
import { Stats } from '../api/types';

const SOUND_KEY = 'bilimbattle:soundEnabled';

export function SettingsScreen() {
  const { token } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SOUND_KEY) !== 'false';
    } catch {
      return true;
    }
  });

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
    <div className="flex flex-col gap-4 p-6">
      <h2 className="text-lg font-bold">Sozlamalar</h2>
      <div className="flex items-center justify-between">
        <span>Ovoz/Vibratsiya</span>
        <button
          type="button"
          aria-pressed={soundEnabled}
          className={`rounded-full px-4 py-1 font-semibold ${
            soundEnabled ? 'bg-blue-600 text-white' : 'bg-gray-200'
          }`}
          onClick={toggleSound}
        >
          {soundEnabled ? 'Yoqilgan' : "O'chirilgan"}
        </button>
      </div>
      {loading && <p className="text-sm text-gray-500">Yuklanmoqda...</p>}
      {!loading && error && (
        <p className="text-sm text-red-500">Statistikani yuklab bo'lmadi.</p>
      )}
      {!loading && !error && stats && (
        <div className="flex flex-col gap-1 rounded-lg bg-gray-50 p-4">
          <p>O'ynagan o'yinlar: {stats.gamesPlayed}</p>
          <p>G'alaba foizi: {stats.winRate}%</p>
          <p>Joriy seriya: {stats.currentStreak}</p>
          <p>Eng uzun seriya: {stats.bestStreak}</p>
          <p>Reyting: {stats.rating}</p>
        </div>
      )}
    </div>
  );
}
