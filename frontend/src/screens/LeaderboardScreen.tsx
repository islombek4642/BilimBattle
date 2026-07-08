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
    <div className="flex flex-col gap-3 p-6">
      <div className="flex gap-2">
        <button
          type="button"
          aria-current={tab === 'global' ? 'page' : undefined}
          className={`flex-1 rounded-lg py-2 font-semibold ${
            tab === 'global' ? 'bg-blue-600 text-white' : 'bg-gray-100'
          }`}
          onClick={() => setTab('global')}
        >
          Umumiy
        </button>
        <button
          type="button"
          aria-current={tab === 'friends' ? 'page' : undefined}
          className={`flex-1 rounded-lg py-2 font-semibold ${
            tab === 'friends' ? 'bg-blue-600 text-white' : 'bg-gray-100'
          }`}
          onClick={() => setTab('friends')}
        >
          Do'stlar
        </button>
      </div>
      {loading && <p className="text-sm text-gray-500">Yuklanmoqda...</p>}
      {!loading && error && (
        <p className="text-sm text-red-500">Reytingni yuklab bo'lmadi.</p>
      )}
      {!loading && !error && myRank !== null && (
        <p className="text-sm text-gray-500">Sizning o'rningiz: {myRank}</p>
      )}
      {!loading && !error && (
        <ul className="flex flex-col gap-2">
          {entries.map((entry, index) => (
            <li key={entry.telegramId} className="flex justify-between rounded-lg bg-gray-50 px-3 py-2">
              <span>
                {index + 1}. {entry.firstName}
              </span>
              <span className="font-semibold">{entry.rating}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
