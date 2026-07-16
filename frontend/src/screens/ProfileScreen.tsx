// frontend/src/screens/ProfileScreen.tsx
import { useEffect, useState } from 'react';
import { Flame, Trophy } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import { getProfile, ProfileResponse } from '../api/profile';
import { getMyStats } from '../api/stats';
import { getAchievements, Achievement, EarnedAchievement } from '../api/achievements';
import { getMyLeague, LeagueResponse } from '../api/league';
import { Stats } from '../api/types';
import { BattleAvatar } from '../components/BattleAvatar';
import { MasteryBadge } from '../components/MasteryBadge';
import { leagueTierBorderClass } from '../utils/leagueTierStyle';

const RECENT_ACHIEVEMENT_LIMIT = 3;

export function ProfileScreen() {
  const { user, token } = useAuth();
  const { navigate } = useNavigation();
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [profileError, setProfileError] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [catalog, setCatalog] = useState<Achievement[]>([]);
  const [earned, setEarned] = useState<EarnedAchievement[]>([]);
  const [league, setLeague] = useState<LeagueResponse | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    getProfile(token)
      .then((res) => {
        if (cancelled) return;
        setProfile(res);
      })
      .catch(() => {
        if (cancelled) return;
        setProfileError(true);
      });

    getMyStats(token)
      .then((res) => {
        if (cancelled) return;
        setStats(res);
      })
      .catch(() => {});

    getAchievements(token)
      .then((res) => {
        if (cancelled) return;
        setCatalog(res.catalog);
        setEarned(res.earned);
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

  if (!user) return null;

  const catalogByKey = new Map(catalog.map((a) => [a.key, a]));
  const recentEarned = [...earned]
    .sort((a, b) => new Date(b.earnedAt).getTime() - new Date(a.earnedAt).getTime())
    .slice(0, RECENT_ACHIEVEMENT_LIMIT);

  return (
    <div className="flex flex-col gap-5 p-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <h2 className="text-lg font-bold text-ios-label">Mening profilim</h2>

      <div className="flex flex-col items-center gap-3 rounded-2xl bg-ios-card p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
        <BattleAvatar
          telegramId={user.telegramId}
          size={72}
          borderColorClass={league ? leagueTierBorderClass(league.tier) : ''}
        />
        <div className="text-center">
          <p className="font-bold text-ios-label">{user.firstName}</p>
          {user.username && <p className="text-sm text-ios-secondary-label">@{user.username}</p>}
        </div>
        {profile && <MasteryBadge rank={profile.masteryRank} />}
      </div>

      {profileError && !profile && (
        <p className="text-center text-sm text-ios-red">Progressni yuklab bo'lmadi.</p>
      )}

      {profile && (
        <div className="flex items-stretch rounded-2xl bg-ios-card p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
          <div className="flex flex-1 flex-col items-center gap-0.5">
            <span className="text-lg font-bold tabular-nums text-ios-label">{profile.xp}</span>
            <span className="text-xs text-ios-secondary-label">XP</span>
          </div>
          <div className="w-px bg-ios-divider" />
          <div className="flex flex-1 flex-col items-center gap-0.5">
            <span className="flex items-center gap-1 text-lg font-bold tabular-nums text-ios-orange">
              <Flame size={16} weight="fill" />
              {profile.streak.current}
            </span>
            <span className="text-xs text-ios-secondary-label">Kunlik faollik</span>
          </div>
        </div>
      )}

      {stats && (
        <div className="flex flex-col rounded-2xl bg-ios-card px-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
          <div className="flex items-center gap-3 border-b border-ios-divider py-3">
            <span className="flex-1 text-sm text-ios-secondary-label">O'yinlar</span>
            <span className="font-semibold tabular-nums text-ios-label">{stats.gamesPlayed}</span>
          </div>
          <div className="flex items-center gap-3 py-3">
            <span className="flex-1 text-sm text-ios-secondary-label">Reyting</span>
            <span className="font-semibold tabular-nums text-ios-blue">{stats.rating}</span>
          </div>
        </div>
      )}

      {recentEarned.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-ios-secondary-label">So'nggi yutuqlar</h3>
          <div className="flex flex-col rounded-2xl bg-ios-card px-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
            {recentEarned.map((e, index) => (
              <div
                key={e.key}
                className={`flex items-center gap-3 py-3 ${index === recentEarned.length - 1 ? '' : 'border-b border-ios-divider'}`}
              >
                <Trophy size={18} weight="fill" className="text-ios-gold" />
                <span className="flex-1 text-sm font-medium text-ios-label">
                  {catalogByKey.get(e.key)?.label ?? e.key}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => navigate({ name: 'achievements' })}
        className="text-center text-sm font-semibold text-ios-blue"
      >
        Barcha yutuqlarni ko'rish
      </button>
    </div>
  );
}
