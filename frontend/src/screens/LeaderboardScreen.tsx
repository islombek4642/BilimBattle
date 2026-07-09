// frontend/src/screens/LeaderboardScreen.tsx
import { useEffect, useState } from 'react';
import { Crown, Star } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { getGlobalLeaderboard, getFriendsLeaderboard } from '../api/leaderboard';
import { LeaderboardEntry } from '../api/types';
import { findRank } from '../utils/leaderboardRank';
import { BattleAvatar } from '../components/BattleAvatar';

const PODIUM_STYLE = {
  1: { avatarSize: 64, barHeight: 'h-20', barBgClass: 'bg-ios-gold', ringClass: 'border-ios-gold' },
  2: { avatarSize: 52, barHeight: 'h-14', barBgClass: 'bg-ios-silver', ringClass: 'border-ios-silver' },
  3: { avatarSize: 52, barHeight: 'h-12', barBgClass: 'bg-ios-bronze', ringClass: 'border-ios-bronze' },
} as const;

function PodiumSlot({ entry, rank }: { entry: LeaderboardEntry | undefined; rank: 1 | 2 | 3 }) {
  if (!entry) return <div className="flex-1" />;
  const style = PODIUM_STYLE[rank];

  return (
    <div className="flex flex-1 flex-col items-center gap-2">
      <div className="relative">
        {rank === 1 && (
          <Crown
            size={22}
            weight="fill"
            className="absolute -top-4 left-1/2 -translate-x-1/2 text-ios-gold"
          />
        )}
        <BattleAvatar telegramId={entry.telegramId} size={style.avatarSize} borderColorClass={style.ringClass} />
      </div>
      <p className="max-w-full truncate text-sm font-semibold text-ios-label">{entry.firstName}</p>
      <span className="flex items-center gap-1 rounded-full bg-ios-bg px-2 py-0.5 text-xs font-bold tabular-nums text-ios-label">
        <Star size={12} weight="fill" className="text-ios-gold" />
        {entry.rating}
      </span>
      <div className={`flex w-full items-end justify-center rounded-t-xl text-lg font-bold text-white ${style.barHeight} ${style.barBgClass}`}>
        {rank}
      </div>
    </div>
  );
}

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
  const podium = entries.slice(0, 3);
  const rest = entries.slice(3);

  return (
    <div className="flex flex-col gap-4 p-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <h2 className="text-lg font-bold text-ios-label">Top reyting</h2>

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
      {!loading && error && <p className="text-sm text-ios-red">Reytingni yuklab bo'lmadi.</p>}
      {!loading && !error && myRank !== null && (
        <p className="text-sm font-medium text-ios-secondary-label">Sizning o'rningiz: {myRank}</p>
      )}

      {!loading && !error && podium.length > 0 && (
        <div className="flex items-end gap-3 rounded-2xl bg-ios-card p-4 pt-8 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
          <PodiumSlot entry={podium[1]} rank={2} />
          <PodiumSlot entry={podium[0]} rank={1} />
          <PodiumSlot entry={podium[2]} rank={3} />
        </div>
      )}

      {!loading && !error && rest.length > 0 && (
        <ul className="flex flex-col gap-2 rounded-2xl bg-ios-card p-2 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
          {rest.map((entry, index) => (
            <li
              key={entry.telegramId}
              className={`flex items-center gap-3 rounded-xl px-3 py-3 ${
                index < rest.length - 1 ? 'border-b border-ios-divider' : ''
              }`}
            >
              <span className="w-5 text-center text-sm font-bold tabular-nums text-ios-secondary-label">
                {index + 4}
              </span>
              <BattleAvatar telegramId={entry.telegramId} size={36} />
              <span className="flex flex-1 flex-col overflow-hidden">
                <span className="truncate font-medium text-ios-label">{entry.firstName}</span>
                {entry.username && (
                  <span className="truncate text-xs text-ios-secondary-label">@{entry.username}</span>
                )}
              </span>
              <span className="flex items-center gap-1 font-semibold tabular-nums text-ios-label">
                <Star size={14} weight="fill" className="text-ios-gold" />
                {entry.rating}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
