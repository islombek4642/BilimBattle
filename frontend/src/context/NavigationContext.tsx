// frontend/src/context/NavigationContext.tsx
import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { getTelegramWebApp } from '../telegram/webApp';
import { ScoreEntry } from '../api/types';

export type Screen =
  | { name: 'home' }
  | { name: 'categorySelect'; intent: 'quick' | 'invite' }
  | { name: 'waiting'; category: string; intent: 'quick' | 'invite' | 'joining' }
  | { name: 'battle'; gameId: string; category: string }
  | { name: 'result'; scores: ScoreEntry[]; winnerId: number | null; forfeited: boolean; category: string }
  | { name: 'leaderboard' }
  | { name: 'settings' }
  | { name: 'admin' };

interface NavigationContextValue {
  current: Screen;
  navigate: (screen: Screen) => void;
  goBack: () => void;
  replace: (screen: Screen) => void;
  reset: (screen: Screen) => void;
}

const SCREENS_WITHOUT_BACK_BUTTON = new Set<Screen['name']>(['battle']);

const NavigationContext = createContext<NavigationContextValue | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Screen[]>([{ name: 'home' }]);

  const navigate = useCallback((screen: Screen) => {
    setStack((prev) => [...prev, screen]);
  }, []);

  const goBack = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const replace = useCallback((screen: Screen) => {
    setStack((prev) => [...prev.slice(0, -1), screen]);
  }, []);

  const reset = useCallback((screen: Screen) => {
    setStack([screen]);
  }, []);

  const current = stack[stack.length - 1];

  useEffect(() => {
    const webApp = getTelegramWebApp();
    if (!webApp) return;

    const shouldShowBack = stack.length > 1 && !SCREENS_WITHOUT_BACK_BUTTON.has(current.name);
    if (shouldShowBack) {
      webApp.BackButton.show();
    } else {
      webApp.BackButton.hide();
    }
  }, [stack.length, current.name]);

  useEffect(() => {
    const webApp = getTelegramWebApp();
    if (!webApp) return;

    webApp.BackButton.onClick(goBack);
    return () => webApp.BackButton.offClick(goBack);
  }, [goBack]);

  return (
    <NavigationContext.Provider value={{ current, navigate, goBack, replace, reset }}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error('useNavigation must be used within NavigationProvider');
  return ctx;
}
