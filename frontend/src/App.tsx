// frontend/src/App.tsx
import { useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { NavigationProvider, useNavigation, Screen } from './context/NavigationContext';
import { GameSocketProvider, useGameSocketContext } from './context/GameSocketContext';
import { BottomNav } from './components/BottomNav';
import { PrimaryButton } from './components/PrimaryButton';
import { HomeScreen } from './screens/HomeScreen';
import { CategorySelectScreen } from './screens/CategorySelectScreen';
import { WaitingScreen } from './screens/WaitingScreen';
import { BattleScreen } from './screens/BattleScreen';
import { ResultScreen } from './screens/ResultScreen';
import { LeaderboardScreen } from './screens/LeaderboardScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { readyWebApp, getStartParam } from './telegram/webApp';

function Router() {
  const { current } = useNavigation();

  switch (current.name) {
    case 'home':
      return <HomeScreen />;
    case 'categorySelect':
      return <CategorySelectScreen intent={current.intent} />;
    case 'waiting':
      return <WaitingScreen category={current.category} intent={current.intent} />;
    case 'battle':
      return <BattleScreen gameId={current.gameId} />;
    case 'result':
      return (
        <ResultScreen scores={current.scores} winnerId={current.winnerId} forfeited={current.forfeited} />
      );
    case 'leaderboard':
      return <LeaderboardScreen />;
    case 'settings':
      return <SettingsScreen />;
    default: {
      const _exhaustive: never = current;
      throw new Error(`Unhandled screen: ${(_exhaustive as Screen).name}`);
    }
  }
}

function AppShell() {
  const { loading, error } = useAuth();
  const { current, reset } = useNavigation();
  const { sessionReplaced, joinInvite } = useGameSocketContext();

  useEffect(() => {
    readyWebApp();
  }, []);

  const hasHandledInviteRef = useRef(false);

  useEffect(() => {
    if (loading || error || sessionReplaced) return;
    if (hasHandledInviteRef.current) return;

    const startParam = getStartParam();
    const match = startParam?.match(/^invite_(\d+)$/);
    if (!match) return;

    hasHandledInviteRef.current = true;
    const inviterTelegramId = Number(match[1]);
    joinInvite(inviterTelegramId, 'umumiy_bilim');
    reset({ name: 'waiting', category: 'umumiy_bilim', intent: 'joining' });
  }, [loading, error, sessionReplaced, joinInvite, reset]);

  if (loading) return <div className="p-6 text-center">Yuklanmoqda...</div>;
  if (error) return <div className="p-6 text-center text-red-600">{error}</div>;
  if (sessionReplaced) {
    return (
      <div className="flex flex-col items-center gap-4 p-6 text-center">
        <p>Bu sessiya boshqa qurilmada ochildi.</p>
        <PrimaryButton onClick={() => window.location.reload()}>Qayta yuklash</PrimaryButton>
      </div>
    );
  }

  const showBottomNav = ['home', 'leaderboard', 'settings'].includes(current.name);

  return (
    <div className="flex min-h-screen flex-col justify-between">
      <div className="flex-1">
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
