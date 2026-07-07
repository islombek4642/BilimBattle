// frontend/src/context/GameSocketContext.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GameSocketProvider, useGameSocketContext } from './GameSocketContext';
import * as authContext from './AuthContext';
import * as gameSocketHook from '../socket/useGameSocket';

function Consumer() {
  const { connected } = useGameSocketContext();
  return <div>connected: {String(connected)}</div>;
}

describe('GameSocketContext', () => {
  it('calls useGameSocket exactly once with the current auth token and shares the result', () => {
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'shared-token', user: null, loading: false, error: null,
    });
    const useGameSocketSpy = vi.spyOn(gameSocketHook, 'useGameSocket').mockReturnValue({
      connected: true,
    } as any);

    render(
      <GameSocketProvider>
        <Consumer />
        <Consumer />
      </GameSocketProvider>
    );

    expect(useGameSocketSpy).toHaveBeenCalledOnce();
    expect(useGameSocketSpy).toHaveBeenCalledWith('shared-token');
    expect(screen.getAllByText('connected: true')).toHaveLength(2);
  });

  it('throws when useGameSocketContext is used outside the provider', () => {
    function Bare() {
      useGameSocketContext();
      return null;
    }
    // Suppress the expected React error-boundary console noise for this one assertion.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Bare />)).toThrow('useGameSocketContext must be used within GameSocketProvider');
    consoleSpy.mockRestore();
  });
});
