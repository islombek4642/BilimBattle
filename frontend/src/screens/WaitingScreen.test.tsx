// frontend/src/screens/WaitingScreen.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WaitingScreen } from './WaitingScreen';
import * as authContext from '../context/AuthContext';
import * as navigationContext from '../context/NavigationContext';
import * as gameSocketContext from '../context/GameSocketContext';
import * as telegram from '../telegram/webApp';
import type { OpponentInfo } from '../socket/useGameSocket';

describe('WaitingScreen', () => {
  const navigate = vi.fn();
  const replace = vi.fn();
  const goBack = vi.fn();
  const leaveQueue = vi.fn();
  const clearMatchFound = vi.fn();
  const clearInviteCreated = vi.fn();
  const clearInviteExpired = vi.fn();

  function mockSocket(overrides: Partial<ReturnType<typeof buildDefaultSocket>> = {}) {
    vi.spyOn(gameSocketContext, 'useGameSocketContext').mockReturnValue({
      ...buildDefaultSocket(),
      ...overrides,
    } as any);
  }

  function buildDefaultSocket() {
    return {
      matchFound: null,
      opponent: null as OpponentInfo | null,
      clearMatchFound,
      leaveQueue,
      inviteCreated: false,
      clearInviteCreated,
      inviteExpired: false,
      clearInviteExpired,
      connected: true,
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    navigate.mockClear();
    replace.mockClear();
    goBack.mockClear();
    leaveQueue.mockClear();
    clearMatchFound.mockClear();
    clearInviteCreated.mockClear();
    clearInviteExpired.mockClear();

    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1, telegramId: 555, firstName: 'Aziz' } as any, loading: false, error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'waiting', category: 'umumiy_bilim', intent: 'quick' },
      navigate, goBack, replace, reset: vi.fn(),
    });

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a searching message with the category label', () => {
    mockSocket();
    render(<WaitingScreen category="umumiy_bilim" intent="quick" />);
    expect(screen.getByText(/Umumiy bilim/)).toBeInTheDocument();
  });

  it('shows a "VS" reveal with both names when matchFound arrives, then replaces with battle after the reveal delay', () => {
    // Regression test: mounting with matchFound ALREADY set (as a previous
    // version of this test did) does not reproduce the real production bug,
    // because there was no prior render for React to diff against - the
    // bug only manifested on the TRANSITION from matchFound=null to a real
    // value (i.e. the socket event arriving after the screen is already
    // showing). Using rerender() here to simulate that real transition is
    // what actually caught the bug: an earlier version of WaitingScreen
    // cleared matchFound back to null as a side effect of the SAME render
    // that set showVs=true, so the reveal-timer effect's
    // `if (!showVs || !matchFound) return;` guard never saw both flags true
    // at once - the VS screen displayed correctly (opponent state is
    // separate and unaffected) but `replace` was never called, leaving both
    // players stuck on the VS screen forever.
    mockSocket();
    const { rerender } = render(<WaitingScreen category="umumiy_bilim" intent="quick" />);

    mockSocket({
      matchFound: { gameId: 'g1', category: 'umumiy_bilim', opponent: { telegramId: 999, firstName: 'Vali' } } as any,
      opponent: { telegramId: 999, firstName: 'Vali' },
    });
    rerender(<WaitingScreen category="umumiy_bilim" intent="quick" />);

    expect(screen.getByText('VS')).toBeInTheDocument();
    expect(screen.getByText('Aziz')).toBeInTheDocument();
    expect(screen.getByText('Vali')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);

    expect(replace).toHaveBeenCalledWith({ name: 'battle', gameId: 'g1' });
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

  it('shows a disconnect message when the socket is not connected', () => {
    mockSocket({ connected: false });
    render(<WaitingScreen category="umumiy_bilim" intent="quick" />);
    expect(screen.getByText(/Aloqa uzildi/)).toBeInTheDocument();
  });

  it('shows a joining-specific message and no share button for intent=joining', () => {
    mockSocket();
    render(<WaitingScreen category="umumiy_bilim" intent="joining" />);
    expect(screen.getByText(/Do'stingiz o'yiniga ulanmoqda/)).toBeInTheDocument();
    expect(screen.queryByText("Do'stga ulashish")).not.toBeInTheDocument();
  });

  it('does not call leaveQueue when cancelling a joining attempt', () => {
    mockSocket();
    render(<WaitingScreen category="umumiy_bilim" intent="joining" />);
    fireEvent.click(screen.getByText('Bekor qilish'));
    expect(leaveQueue).not.toHaveBeenCalled();
    expect(goBack).toHaveBeenCalledOnce();
  });

  it('shows an invite-expired message when inviteExpired is true', () => {
    mockSocket({ inviteExpired: true });
    render(<WaitingScreen category="umumiy_bilim" intent="invite" />);
    expect(screen.getByText(/Taklif muddati tugadi/)).toBeInTheDocument();
  });
});
