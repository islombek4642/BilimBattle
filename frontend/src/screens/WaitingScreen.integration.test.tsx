// frontend/src/screens/WaitingScreen.integration.test.tsx
//
// Regression test using the REAL GameSocketProvider/useGameSocket (only the
// underlying socket.io client is faked) instead of a mocked
// useGameSocketContext() return value, unlike WaitingScreen.test.tsx.
//
// This distinction matters: a production bug (VS screen displayed
// correctly, but the reveal timer never fired replace() to enter battle -
// both players stuck on VS forever) involved a real, reactive
// setState/cleanup interaction between two effects that a STATIC mocked
// context cannot reproduce, since calling a mocked clearMatchFound() has no
// effect on what the next render sees. This test caught the bug that
// WaitingScreen.test.tsx's mocked-context test did not.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { WaitingScreen } from './WaitingScreen';
import { GameSocketProvider } from '../context/GameSocketContext';
import * as authContext from '../context/AuthContext';
import * as navigationContext from '../context/NavigationContext';
import { createSocket } from '../socket/socketClient';

vi.mock('../socket/socketClient', () => ({
  createSocket: vi.fn(),
}));

function createFakeSocket() {
  const listeners: Record<string, (payload?: any, ack?: any) => void> = {};
  return {
    on: vi.fn((event: string, cb: any) => {
      listeners[event] = cb;
    }),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    __trigger: (event: string, payload?: any, ack?: any) => {
      listeners[event]?.(payload, ack);
    },
  };
}

describe('WaitingScreen + real useGameSocket integration', () => {
  const replace = vi.fn();
  let fakeSocket: ReturnType<typeof createFakeSocket>;

  beforeEach(() => {
    vi.useFakeTimers();
    fakeSocket = createFakeSocket();
    (createSocket as any).mockReturnValue(fakeSocket);
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1, telegramId: 555, firstName: 'Aziz' } as any, loading: false, error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'waiting', category: 'umumiy_bilim', intent: 'quick' },
      navigate: vi.fn(), goBack: vi.fn(), replace, reset: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows the VS reveal and actually navigates to battle after a real match_found event', () => {
    render(
      <GameSocketProvider>
        <WaitingScreen category="umumiy_bilim" intent="quick" />
      </GameSocketProvider>
    );

    act(() => {
      fakeSocket.__trigger('match_found', {
        gameId: 'g1', category: 'umumiy_bilim', opponent: { telegramId: 999, firstName: 'Vali' },
      });
    });

    expect(screen.getByText('VS')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(replace).toHaveBeenCalledWith({ name: 'battle', gameId: 'g1' });
  });
});
