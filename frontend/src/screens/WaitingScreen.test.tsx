// frontend/src/screens/WaitingScreen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WaitingScreen } from './WaitingScreen';
import * as authContext from '../context/AuthContext';
import * as navigationContext from '../context/NavigationContext';
import * as gameSocketContext from '../context/GameSocketContext';
import * as telegram from '../telegram/webApp';

describe('WaitingScreen', () => {
  const navigate = vi.fn();
  const replace = vi.fn();
  const goBack = vi.fn();
  const leaveQueue = vi.fn();
  const clearMatchFound = vi.fn();

  function mockSocket(overrides: Partial<ReturnType<typeof buildDefaultSocket>> = {}) {
    vi.spyOn(gameSocketContext, 'useGameSocketContext').mockReturnValue({
      ...buildDefaultSocket(),
      ...overrides,
    } as any);
  }

  function buildDefaultSocket() {
    return {
      matchFound: null,
      clearMatchFound,
      leaveQueue,
      inviteCreated: false,
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    navigate.mockClear();
    replace.mockClear();
    goBack.mockClear();
    leaveQueue.mockClear();
    clearMatchFound.mockClear();

    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1, telegramId: 555 } as any, loading: false, error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'waiting', category: 'umumiy_bilim', intent: 'quick' },
      navigate, goBack, replace, reset: vi.fn(),
    });
  });

  it('shows a searching message with the category label', () => {
    mockSocket();
    render(<WaitingScreen category="umumiy_bilim" intent="quick" />);
    expect(screen.getByText(/Umumiy bilim/)).toBeInTheDocument();
  });

  it('replaces the current screen with battle when matchFound arrives', async () => {
    mockSocket({ matchFound: { gameId: 'g1', category: 'umumiy_bilim' } as any });
    render(<WaitingScreen category="umumiy_bilim" intent="quick" />);

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({ name: 'battle', gameId: 'g1', category: 'umumiy_bilim' })
    );
    expect(clearMatchFound).toHaveBeenCalledOnce();
  });

  it('calls leaveQueue and goes back when cancelling a quick match', () => {
    mockSocket();
    render(<WaitingScreen category="umumiy_bilim" intent="quick" />);

    fireEvent.click(screen.getByText('Bekor qilish'));

    expect(leaveQueue).toHaveBeenCalledWith('umumiy_bilim');
    expect(goBack).toHaveBeenCalledOnce();
  });

  it('does not call leaveQueue when cancelling an invite (no queue was joined)', () => {
    mockSocket();
    render(<WaitingScreen category="umumiy_bilim" intent="invite" />);

    fireEvent.click(screen.getByText('Bekor qilish'));

    expect(leaveQueue).not.toHaveBeenCalled();
    expect(goBack).toHaveBeenCalledOnce();
  });

  it('shows a share button for invite intent that shares the deep link', () => {
    mockSocket({ inviteCreated: true });
    const shareSpy = vi.spyOn(telegram, 'shareInviteLink').mockImplementation(() => {});

    render(<WaitingScreen category="umumiy_bilim" intent="invite" />);
    fireEvent.click(screen.getByText("Do'stga ulashish"));

    expect(shareSpy).toHaveBeenCalledOnce();
    const [link] = shareSpy.mock.calls[0];
    expect(link).toContain('startapp=invite_555');
  });

  it('does not show a share button for quick-match intent', () => {
    mockSocket();
    render(<WaitingScreen category="umumiy_bilim" intent="quick" />);
    expect(screen.queryByText("Do'stga ulashish")).not.toBeInTheDocument();
  });
});
