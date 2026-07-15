// frontend/src/App.tsx
import { useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { NavigationProvider, useNavigation, Screen } from './context/NavigationContext';
import { GameSocketProvider, useGameSocketContext } from './context/GameSocketContext';
import { BottomNav } from './components/BottomNav';
import { PrimaryButton } from './components/PrimaryButton';
import { HomeScreen } from './screens/HomeScreen';
import { LevelSelectScreen } from './screens/LevelSelectScreen';
import { WaitingScreen } from './screens/WaitingScreen';
import { BattleScreen } from './screens/BattleScreen';
import { ResultScreen } from './screens/ResultScreen';
import { LeaderboardScreen } from './screens/LeaderboardScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AchievementsScreen } from './screens/AchievementsScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { AdminScreen } from './screens/AdminScreen';
import { readyWebApp, getStartParam } from './telegram/webApp';

function Router() {
  const { current } = useNavigation();

  switch (current.name) {
    case 'home':
      return <HomeScreen />;
    case 'levelSelect':
      return <LevelSelectScreen intent={current.intent} />;
    case 'waiting':
      return <WaitingScreen level={current.level} intent={current.intent} />;
    case 'battle':
      return <BattleScreen gameId={current.gameId} level={current.level} />;
    case 'result':
      return (
        <ResultScreen
          scores={current.scores}
          winnerId={current.winnerId}
          forfeited={current.forfeited}
          knockout={current.knockout}
          level={current.level}
          levelStars={current.levelStars}
        />
      );
    case 'leaderboard':
      return <LeaderboardScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'achievements':
      return <AchievementsScreen />;
    case 'profile':
      return <ProfileScreen />;
    case 'admin':
      return <AdminScreen />;
    default: {
      const _exhaustive: never = current;
      throw new Error(`Unhandled screen: ${(_exhaustive as Screen).name}`);
    }
  }
}

function AppShell() {
  const { loading, error } = useAuth();
  const { current, reset } = useNavigation();
  const { sessionReplaced, joinLevelInvite, connected } = useGameSocketContext();

  useEffect(() => {
    readyWebApp();
  }, []);

  const hasHandledInviteRef = useRef(false);

  useEffect(() => {
    if (loading || error || sessionReplaced || !connected) return;
    if (hasHandledInviteRef.current) return;

    const startParam = getStartParam();
    const match = startParam?.match(/^invite_(\d+)$/);
    if (!match) return;

    hasHandledInviteRef.current = true;
    // Both the native `startapp` launch and the chat-fallback `/start
    // invite_123` message surface here identically as `invite_<id>`. The
    // level itself doesn't need to travel through the deep link - the server
    // looks up the invite record (created earlier by the inviter via
    // `create_level_invite`) from just the inviter's telegram id to know
    // which level to match on. So we just join and show the waiting screen;
    // the real level arrives later via `match_found` (see WaitingScreen's
    // `replace({ name: 'battle', ... level: matchFound.level ?? level })`).
    const inviterTelegramId = Number(match[1]);
    joinLevelInvite(inviterTelegramId);
    reset({ name: 'waiting', level: 1, intent: 'joining' });
  }, [loading, error, sessionReplaced, connected, joinLevelInvite, reset]);

  if (loading) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-ios-bg p-6 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-ios-divider border-t-ios-blue" />
        <p className="text-sm text-ios-secondary-label">Yuklanmoqda...</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-ios-bg p-6 text-center text-ios-red">
        {error}
      </div>
    );
  }
  if (sessionReplaced) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ios-bg p-6 text-center">
        <p className="text-ios-label">Bu sessiya boshqa qurilmada ochildi.</p>
        <PrimaryButton onClick={() => window.location.reload()}>Qayta yuklash</PrimaryButton>
      </div>
    );
  }

  const showBottomNav = ['home', 'leaderboard', 'settings'].includes(current.name);

  return (
    <div className="h-dvh overflow-hidden bg-ios-bg">
      <div className={`h-full overflow-y-auto ${showBottomNav ? 'pb-24' : ''}`}>
        <Router />
      </div>
      {showBottomNav && <BottomNav />}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationProvider>
        <GameSocketProvider>
          <AppShell />
        </GameSocketProvider>
      </NavigationProvider>
    </AuthProvider>
  );
}
