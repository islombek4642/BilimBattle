// frontend/src/screens/HomeScreen.tsx
import { useEffect, useState } from 'react';
import { Lightning, UserPlus, Flame, Star, Trophy, CheckCircle, Circle } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import { useGameSocketContext } from '../context/GameSocketContext';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { BattleAvatar } from '../components/BattleAvatar';
import { getMyStats } from '../api/stats';
import { getAchievements, Achievement, EarnedAchievement } from '../api/achievements';
import { getLevelProgress } from '../api/levelProgress';
import { getGlobalLeaderboard } from '../api/leaderboard';
import { getProfile, ProfileResponse } from '../api/profile';
import { getMyLeague, LeagueResponse } from '../api/league';
import { findNextLevelToPlay } from '../utils/levelUnlock';
import { findRank } from '../utils/leaderboardRank';
import { Stats, LeaderboardEntry } from '../api/types';

const ACHIEVEMENT_BADGE_LIMIT = 5;
const LEADERBOARD_PREVIEW_SIZE = 3;

export function HomeScreen() {
  const { user, token } = useAuth();
  const { navigate } = useNavigation();
  const { joinLevelQueue } = useGameSocketContext();
  const [stats, setStats] = useState<Stats | null>(null);
  const [catalog, setCatalog] = useState<Achievement[]>([]);
  const [earned, setEarned] = useState<EarnedAchievement[]>([]);
  const [nextLevel, setNextLevel] = useState<number | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [league, setLeague] = useState<LeagueResponse | null>(null);

  // Six independent fetches, none blocking the others - each section of
  // this screen degrades gracefully (simply doesn't render) if its own
  // fetch is still pending or fails, rather than the whole screen waiting
  // on the slowest one or crashing on one failure. Unlike LevelSelectScreen/
  // AchievementsScreen (which show a full-screen "Yuklanmoqda..." because
  // their ENTIRE content depends on one fetch), HomeScreen's two primary
  // CTA buttons must always be interactable immediately, even before any
  // of this data arrives.
  useEffect(() => {
    if (!token) return;

    getMyStats(token).then(setStats).catch(() => {});

    getAchievements(token)
      .then((res) => {
        setCatalog(res.catalog);
        setEarned(res.earned);
      })
      .catch(() => {});

    getLevelProgress(token)
      .then((res) => {
        const progressByLevel = new Map(res.progress.map((p) => [p.levelNumber, p.stars]));
        setNextLevel(findNextLevelToPlay(res.maxAvailableLevel, progressByLevel));
      })
      .catch(() => {});

    getGlobalLeaderboard(token)
      .then((res) => setLeaderboard(res.leaderboard))
      .catch(() => {});

    getProfile(token).then(setProfile).catch(() => {});

    getMyLeague(token).then(setLeague).catch(() => {});
  }, [token]);

  if (!user) return null;

  const catalogByKey = new Map(catalog.map((a) => [a.key, a]));
  const recentEarned = [...earned]
    .sort((a, b) => new Date(b.earnedAt).getTime() - new Date(a.earnedAt).getTime())
    .slice(0, ACHIEVEMENT_BADGE_LIMIT);

  const podium = leaderboard.slice(0, LEADERBOARD_PREVIEW_SIZE);
  const myRank = findRank(leaderboard, user.telegramId);
  const showOwnRankRow = myRank !== null && myRank > LEADERBOARD_PREVIEW_SIZE;

  return (
    <div className="flex min-h-full flex-col gap-5 p-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="flex items-center gap-3">
        <BattleAvatar telegramId={user.telegramId} size={44} />
        {stats && (
          <div className="animate-fade-in-up ml-auto flex shrink-0 items-center gap-3">
            <span className="flex items-center gap-1 text-sm font-bold text-ios-orange">
              <Flame size={16} weight="fill" />
              {stats.currentStreak}
            </span>
            <span className="flex items-center gap-1 text-sm font-bold text-ios-blue">
              <Star size={16} weight="fill" />
              {stats.rating}
            </span>
          </div>
        )}
      </div>

      {profile && (
        <div className="animate-fade-in-up flex flex-col gap-2 rounded-2xl bg-ios-card p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
          <span className="flex items-center gap-1 text-sm font-semibold text-ios-label">
            <Flame size={16} weight="fill" className="text-ios-orange" />
            Kunlik faollik: {profile.streak.current} kun
          </span>
          <div className="flex flex-col gap-1.5">
            {profile.dailyQuests.map((quest) => (
              <div key={quest.key} className="flex items-center gap-2">
                {quest.completed ? (
                  <CheckCircle size={16} weight="fill" className="text-ios-green" />
                ) : (
                  <Circle size={16} className="text-ios-secondary-label" />
                )}
                <span
                  className={`flex-1 text-xs ${
                    quest.completed ? 'text-ios-secondary-label line-through' : 'text-ios-label'
                  }`}
                >
                  {quest.label}
                </span>
                <span className="text-xs font-semibold tabular-nums text-ios-secondary-label">
                  {quest.progress}/{quest.target}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {recentEarned.length > 0 && (
        <button
          type="button"
          onClick={() => navigate({ name: 'achievements' })}
          className="animate-fade-in-up flex items-center gap-2 overflow-x-auto rounded-2xl bg-ios-card p-3 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]"
        >
          {recentEarned.map((e) => (
            <span
              key={e.key}
              className="shrink-0 rounded-full bg-ios-bg px-3 py-1 text-xs font-semibold text-ios-label"
            >
              {catalogByKey.get(e.key)?.label ?? e.key}
            </span>
          ))}
          <span className="ml-auto shrink-0 text-xs font-medium text-ios-blue">Hammasi</span>
        </button>
      )}

      {nextLevel !== null && (
        <button
          type="button"
          onClick={() => {
            joinLevelQueue(nextLevel);
            navigate({ name: 'waiting', level: nextLevel, intent: 'quick' });
          }}
          className="animate-fade-in-up flex items-center justify-between rounded-2xl bg-ios-card p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]"
        >
          <span className="text-sm font-medium text-ios-label">Davom etish: {nextLevel}-bosqich</span>
          <span className="text-sm font-semibold text-ios-blue">Boshlash</span>
        </button>
      )}

      <div className="flex flex-1 flex-col justify-center gap-3">
        <PrimaryButton shiny onClick={() => navigate({ name: 'levelSelect', intent: 'quick' })}>
          <span className="flex items-center justify-center gap-2">
            <Lightning size={20} weight="fill" />
            Tezkor o'yin
          </span>
        </PrimaryButton>
        <SecondaryButton onClick={() => navigate({ name: 'levelSelect', intent: 'invite' })}>
          <span className="flex items-center justify-center gap-2">
            <UserPlus size={20} weight="fill" />
            Do'stni chaqirish
          </span>
        </SecondaryButton>
      </div>

      {podium.length > 0 && (
        <button
          type="button"
          onClick={() => navigate({ name: 'leaderboard' })}
          className="animate-fade-in-up flex flex-col gap-2 rounded-2xl bg-ios-card p-4 text-left shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]"
        >
          <span className="flex items-center gap-1 text-sm font-semibold text-ios-label">
            <Trophy size={16} weight="fill" className="text-ios-gold" />
            Top reyting
            {league && <span className="ml-1 font-normal text-ios-secondary-label">· {league.tier} ligasi</span>}
          </span>
          {podium.map((entry, index) => (
            <div key={entry.telegramId} className="flex items-center gap-2">
              <span className="w-4 text-xs font-bold tabular-nums text-ios-secondary-label">{index + 1}</span>
              <span className="flex-1 truncate text-sm text-ios-label">{entry.firstName}</span>
              <span className="text-sm font-semibold tabular-nums text-ios-label">{entry.rating}</span>
            </div>
          ))}
          {showOwnRankRow && (
            <div className="flex items-center gap-2 border-t border-ios-divider pt-2">
              <span className="w-4 text-xs font-bold tabular-nums text-ios-secondary-label">{myRank}</span>
              <span className="flex-1 truncate text-sm text-ios-label">{user.firstName}</span>
              <span className="text-sm font-semibold tabular-nums text-ios-label">{stats?.rating ?? ''}</span>
            </div>
          )}
        </button>
      )}
    </div>
  );
}
