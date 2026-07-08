// frontend/src/screens/LeaderboardScreen.tsx
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getGlobalLeaderboard, getFriendsLeaderboard } from '../api/leaderboard';
import { LeaderboardEntry } from '../api/types';
import { findRank } from '../utils/leaderboardRank';

export function LeaderboardScreen() {
  const { token, user } = useAuth();
  const [tab, setTab] = useState<'global' | 'friends'>('global');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    setLoading(true);
    setError(false);

    const fetcher = tab === 'global' ? getGlobalLeaderboard : getFriendsLeaderboard;
    fetcher(token)
      .then((res) => {
        if (cancelled) return;
        setEntries(res.leaderboard);
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
  }, [tab, token]);

  const myRank = user ? findRank(entries, user.telegramId) : null;

  return (
    <div className="flex flex-col gap-4 p-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="flex gap-1 rounded-full bg-ios-divider p-1">
        <button
          type="button"
          aria-current={tab === 'global' ? 'page' : undefined}
          className={`flex-1 rounded-full py-2 text-sm font-semibold transition-colors duration-150 ${
            tab === 'global' ? 'bg-ios-card text-ios-label shadow-sm' : 'text-ios-secondary-label'
          }`}
          onClick={() => setTab('global')}
        >
          Umumiy
        </button>
        <button
          type="button"
          aria-current={tab === 'friends' ? 'page' : undefined}
          className={`flex-1 rounded-full py-2 text-sm font-semibold transition-colors duration-150 ${
            tab === 'friends' ? 'bg-ios-card text-ios-label shadow-sm' : 'text-ios-secondary-label'
          }`}
          onClick={() => setTab('friends')}
        >
          Do'stlar
        </button>
      </div>
      {loading && <p className="text-sm text-ios-secondary-label">Yuklanmoqda...</p>}
      {!loading && error && (
        <p className="text-sm text-ios-red">Reytingni yuklab bo'lmadi.</p>
      )}
      {!loading && !error && myRank !== null && (
        <p className="text-sm font-medium text-ios-secondary-label">Sizning o'rningiz: {myRank}</p>
      )}
      {!loading && !error && (
        <ul className="flex flex-col gap-2 rounded-2xl bg-ios-card p-2 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
          {entries.map((entry, index) => (
            <li
              key={entry.telegramId}
              className={`flex items-center justify-between rounded-xl px-3 py-3 ${
                index < entries.length - 1 ? 'border-b border-ios-divider' : ''
              }`}
            >
              <span className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ios-bg text-xs font-bold text-ios-secondary-label">
                  {index + 1}
                </span>
                <span className="font-medium text-ios-label">{entry.firstName}</span>
              </span>
              <span className="font-semibold tabular-nums text-ios-blue">{entry.rating}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
