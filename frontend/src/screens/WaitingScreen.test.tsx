// frontend/src/screens/WaitingScreen.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { WaitingScreen } from './WaitingScreen';
import * as authContext from '../context/AuthContext';
import * as navigationContext from '../context/NavigationContext';
import * as gameSocketContext from '../context/GameSocketContext';
import * as telegram from '../telegram/webApp';
import type { OpponentInfo } from '../socket/useGameSocket';

describe('WaitingScreen', () => {
  const navigate = vi.fn();
  const replace = vi.fn();
  const reset = vi.fn();
  const leaveLevelQueue = vi.fn();
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
      leaveLevelQueue,
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
    reset.mockClear();
    leaveLevelQueue.mockClear();
    clearMatchFound.mockClear();
    clearInviteCreated.mockClear();
    clearInviteExpired.mockClear();

    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1, telegramId: 555, firstName: 'Aziz' } as any, loading: false, error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'waiting', level: 5, intent: 'quick' },
      navigate, goBack: vi.fn(), replace, reset,
    });

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a searching message with the level number', () => {
    mockSocket();
    render(<WaitingScreen level={5} intent="quick" />);
    expect(screen.getByText(/5-bosqich bo'yicha raqib qidirilmoqda/)).toBeInTheDocument();
  });

  it('shows an invite-specific message (not "searching for opponent") for intent=invite', () => {
    // Regression: intent=invite previously fell through to the same
    // "raqib qidirilmoqda" (searching for opponent) copy as intent=quick,
    // even though createInvite() (not joinQueue()) is what actually ran -
    // misleading, since no public matchmaking search is happening here.
    mockSocket();
    render(<WaitingScreen level={5} intent="invite" />);
    expect(screen.queryByText(/raqib qidirilmoqda/)).not.toBeInTheDocument();
    expect(screen.getByText(/5-bosqich bo'yicha taklif havolasi tayyorlanmoqda/)).toBeInTheDocument();
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
    const { rerender } = render(<WaitingScreen level={5} intent="quick" />);

    mockSocket({
      matchFound: { gameId: 'g1', level: 5, opponent: { telegramId: 999, firstName: 'Vali' } } as any,
      opponent: { telegramId: 999, firstName: 'Vali' },
    });
    rerender(<WaitingScreen level={5} intent="quick" />);

    expect(screen.getByText('VS')).toBeInTheDocument();
    expect(screen.getByText('Aziz')).toBeInTheDocument();
    expect(screen.getByText('Vali')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);

    expect(replace).toHaveBeenCalledWith({ name: 'battle', gameId: 'g1', level: 5 });
    expect(clearMatchFound).toHaveBeenCalledOnce();
  });

  it('counts up the elapsed search time once per second while searching', () => {
    mockSocket();
    render(<WaitingScreen level={5} intent="quick" />);

    expect(screen.getByTestId('waiting-elapsed')).toHaveTextContent('0s');

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByTestId('waiting-elapsed')).toHaveTextContent('3s');
  });

  it('calls leaveLevelQueue and resets to levelSelect when cancelling a quick match', () => {
    // Regression: this MUST use reset(), not goBack() - WaitingScreen is
    // also reached via ResultScreen's "Yana o'ynash" and App.tsx's
    // invite-accept deep link, both of which reset() the stack down to just
    // this screen, so goBack() would silently do nothing there (no history
    // to pop) and the cancel button would appear completely unresponsive.
    mockSocket();
    render(<WaitingScreen level={5} intent="quick" />);

    fireEvent.click(screen.getByText('Bekor qilish'));

    expect(leaveLevelQueue).toHaveBeenCalledWith(5);
    expect(reset).toHaveBeenCalledWith({ name: 'levelSelect', intent: 'quick' });
  });

  it('does not call leaveLevelQueue when cancelling an invite (no queue was joined)', () => {
    mockSocket();
    render(<WaitingScreen level={5} intent="invite" />);

    fireEvent.click(screen.getByText('Bekor qilish'));

    expect(leaveLevelQueue).not.toHaveBeenCalled();
    expect(reset).toHaveBeenCalledWith({ name: 'levelSelect', intent: 'invite' });
  });

  it('shows a share button for invite intent that shares the deep link', () => {
    mockSocket({ inviteCreated: true });
    const shareSpy = vi.spyOn(telegram, 'shareInviteLink').mockImplementation(() => {});

    render(<WaitingScreen level={5} intent="invite" />);
    fireEvent.click(screen.getByText("Do'stga ulashish"));

    expect(shareSpy).toHaveBeenCalledOnce();
    const [link] = shareSpy.mock.calls[0];
    expect(link).toContain('startapp=invite_555');
  });

  it('does not show a share button for quick-match intent', () => {
    mockSocket();
    render(<WaitingScreen level={5} intent="quick" />);
    expect(screen.queryByText("Do'stga ulashish")).not.toBeInTheDocument();
  });

  it('shows a disconnect message when the socket is not connected', () => {
    mockSocket({ connected: false });
    render(<WaitingScreen level={5} intent="quick" />);
    expect(screen.getByText(/Aloqa uzildi/)).toBeInTheDocument();
  });

  it('shows a joining-specific message and no share button for intent=joining', () => {
    mockSocket();
    render(<WaitingScreen level={5} intent="joining" />);
    expect(screen.getByText(/Do'stingiz o'yiniga ulanmoqda/)).toBeInTheDocument();
    expect(screen.queryByText("Do'stga ulashish")).not.toBeInTheDocument();
  });

  it('does not call leaveLevelQueue when cancelling a joining attempt', () => {
    mockSocket();
    render(<WaitingScreen level={5} intent="joining" />);
    fireEvent.click(screen.getByText('Bekor qilish'));
    expect(leaveLevelQueue).not.toHaveBeenCalled();
    expect(reset).toHaveBeenCalledWith({ name: 'home' });
  });

  it('shows an invite-expired message when inviteExpired is true', () => {
    mockSocket({ inviteExpired: true });
    render(<WaitingScreen level={5} intent="invite" />);
    expect(screen.getByText(/Taklif muddati tugadi/)).toBeInTheDocument();
  });
});
