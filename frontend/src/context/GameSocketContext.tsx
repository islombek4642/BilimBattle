// frontend/src/context/GameSocketContext.tsx
import { createContext, useContext, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { useGameSocket, UseGameSocketResult } from '../socket/useGameSocket';

const GameSocketContext = createContext<UseGameSocketResult | null>(null);

export function GameSocketProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const socket = useGameSocket(token);

  return <GameSocketContext.Provider value={socket}>{children}</GameSocketContext.Provider>;
}

export function useGameSocketContext(): UseGameSocketResult {
  const ctx = useContext(GameSocketContext);
  if (!ctx) throw new Error('useGameSocketContext must be used within GameSocketProvider');
  return ctx;
}
