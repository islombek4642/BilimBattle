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
  const { sessionReplaced, joinInvite, connected } = useGameSocketContext();

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
    // This chat-fallback deep-link path (see backend/src/bot/telegramBot.ts's
    // extractStartPayload/buildWebAppUrl) predates level mode and has no way
    // to carry a level number through a plain `/start invite_123` message -
    // level invites are joined via the proper `startapp` query-param path
    // instead (which DOES carry richer state end-to-end), so this fallback
    // is intentionally a no-op now rather than guessing a default level.
  }, [loading, error, sessionReplaced, connected, joinInvite, reset]);

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
