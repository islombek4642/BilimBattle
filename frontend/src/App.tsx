// frontend/src/App.tsx
import { useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { NavigationProvider, useNavigation } from './context/NavigationContext';
import { GameSocketProvider, useGameSocketContext } from './context/GameSocketContext';
import { BottomNav } from './components/BottomNav';
import { HomeScreen } from './screens/HomeScreen';
import { CategorySelectScreen } from './screens/CategorySelectScreen';
import { WaitingScreen } from './screens/WaitingScreen';
import { BattleScreen } from './screens/BattleScreen';
import { ResultScreen } from './screens/ResultScreen';
import { LeaderboardScreen } from './screens/LeaderboardScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { readyWebApp } from './telegram/webApp';

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
  }
}

function AppShell() {
  const { loading, error } = useAuth();
  const { current } = useNavigation();
  const { sessionReplaced } = useGameSocketContext();

  useEffect(() => {
    readyWebApp();
  }, []);

  if (loading) return <div className="p-6 text-center">Yuklanmoqda...</div>;
  if (error) return <div className="p-6 text-center text-red-600">{error}</div>;
  if (sessionReplaced) {
    return (
      <div className="p-6 text-center">Bu sessiya boshqa qurilmada ochildi.</div>
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
