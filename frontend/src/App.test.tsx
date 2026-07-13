// frontend/src/App.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from './App';
import * as authContext from './context/AuthContext';
import * as gameSocketContext from './context/GameSocketContext';
import * as telegram from './telegram/webApp';

vi.mock('./context/AuthContext', async () => {
  const actual = await vi.importActual<typeof import('./context/AuthContext')>('./context/AuthContext');
  // AuthProvider is also replaced with a passthrough, not just useAuth. If the
  // real AuthProvider rendered here, its internal useEffect would still fire
  // a REAL login() call (unmocked fetch, in jsdom, with no window.Telegram) -
  // noisy/undeterministic and irrelevant, since AppShell reads from the
  // mocked useAuth() return value below, not from real context state anyway.
  return { ...actual, useAuth: vi.fn(), AuthProvider: ({ children }: any) => children };
});
vi.mock('./context/GameSocketContext', async () => {
  const actual = await vi.importActual<typeof import('./context/GameSocketContext')>(
    './context/GameSocketContext'
  );
  return { ...actual, useGameSocketContext: vi.fn(), GameSocketProvider: ({ children }: any) => children };
});

describe('App', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(telegram, 'readyWebApp').mockImplementation(() => {});
  });

  it('shows a loading state while auth is in progress', () => {
    vi.mocked(authContext.useAuth).mockReturnValue({
      token: null, user: null, loading: true, error: null,
    });
    vi.mocked(gameSocketContext.useGameSocketContext).mockReturnValue({
      sessionReplaced: false,
    } as any);

    render(<App />);

    expect(screen.getByText('Yuklanmoqda...')).toBeInTheDocument();
  });

  it('shows the auth error when login failed', () => {
    vi.mocked(authContext.useAuth).mockReturnValue({
      token: null, user: null, loading: false, error: 'Tizimga kirishda xatolik yuz berdi',
    });
    vi.mocked(gameSocketContext.useGameSocketContext).mockReturnValue({
      sessionReplaced: false,
    } as any);

    render(<App />);

    expect(screen.getByText('Tizimga kirishda xatolik yuz berdi')).toBeInTheDocument();
  });

  it('shows the home screen and bottom nav once loaded successfully', () => {
    vi.mocked(authContext.useAuth).mockReturnValue({
      token: 'tok', user: { id: 1, firstName: 'Aziz', rating: 1000 } as any, loading: false, error: null,
    });
    vi.mocked(gameSocketContext.useGameSocketContext).mockReturnValue({
      sessionReplaced: false,
    } as any);

    render(<App />);

    expect(screen.getByText("Tezkor o'yin")).toBeInTheDocument();
    expect(screen.getByTestId('bottom-nav')).toBeInTheDocument();
  });

  it('shows a session-replaced message and hides normal UI when another device logs in', () => {
    vi.mocked(authContext.useAuth).mockReturnValue({
      token: 'tok', user: { id: 1, firstName: 'Aziz', rating: 1000 } as any, loading: false, error: null,
    });
    vi.mocked(gameSocketContext.useGameSocketContext).mockReturnValue({
      sessionReplaced: true,
    } as any);

    render(<App />);

    expect(screen.getByText(/boshqa qurilmada ochildi/)).toBeInTheDocument();
    expect(screen.queryByTestId('bottom-nav')).not.toBeInTheDocument();
  });

  it('shows a reload button on the session-replaced screen', () => {
    vi.mocked(authContext.useAuth).mockReturnValue({
      token: 'tok', user: { id: 1, firstName: 'Aziz', rating: 1000 } as any, loading: false, error: null,
    });
    vi.mocked(gameSocketContext.useGameSocketContext).mockReturnValue({
      sessionReplaced: true,
    } as any);
    const reloadSpy = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload: reloadSpy });

    render(<App />);
    fireEvent.click(screen.getByText('Qayta yuklash'));

    expect(reloadSpy).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('calls readyWebApp on mount', () => {
    vi.mocked(authContext.useAuth).mockReturnValue({
      token: 'tok', user: { id: 1, firstName: 'Aziz', rating: 1000 } as any, loading: false, error: null,
    });
    vi.mocked(gameSocketContext.useGameSocketContext).mockReturnValue({
      sessionReplaced: false,
    } as any);

    render(<App />);

    expect(telegram.readyWebApp).toHaveBeenCalledOnce();
  });

  it('does not join an invite even when start_param matches invite_<id> (chat-fallback deep-link is disabled)', () => {
    const joinInvite = vi.fn();
    vi.mocked(authContext.useAuth).mockReturnValue({
      token: 'tok', user: { id: 1, firstName: 'Aziz', rating: 1000 } as any, loading: false, error: null,
    });
    vi.mocked(gameSocketContext.useGameSocketContext).mockReturnValue({
      sessionReplaced: false,
      joinInvite,
      matchFound: null,
      clearMatchFound: vi.fn(),
      leaveQueue: vi.fn(),
      inviteCreated: false,
      clearInviteCreated: vi.fn(),
      inviteExpired: false,
      clearInviteExpired: vi.fn(),
      connected: true,
    } as any);
    vi.spyOn(telegram, 'getStartParam').mockReturnValue('invite_555');

    render(<App />);

    expect(joinInvite).not.toHaveBeenCalled();
    expect(screen.getByText("Tezkor o'yin")).toBeInTheDocument();
  });

  it('does not call joinInvite when there is no invite start_param', () => {
    const joinInvite = vi.fn();
    vi.mocked(authContext.useAuth).mockReturnValue({
      token: 'tok', user: { id: 1, firstName: 'Aziz', rating: 1000 } as any, loading: false, error: null,
    });
    vi.mocked(gameSocketContext.useGameSocketContext).mockReturnValue({
      sessionReplaced: false,
      joinInvite,
      connected: true,
    } as any);
    vi.spyOn(telegram, 'getStartParam').mockReturnValue(undefined);

    render(<App />);

    expect(joinInvite).not.toHaveBeenCalled();
    expect(screen.getByText("Tezkor o'yin")).toBeInTheDocument();
  });

  it('does not join an invite until the socket is connected', () => {
    const joinInvite = vi.fn();
    vi.mocked(authContext.useAuth).mockReturnValue({
      token: 'tok', user: { id: 1, firstName: 'Aziz', rating: 1000 } as any, loading: false, error: null,
    });
    vi.mocked(gameSocketContext.useGameSocketContext).mockReturnValue({
      sessionReplaced: false, joinInvite, connected: false,
    } as any);
    vi.spyOn(telegram, 'getStartParam').mockReturnValue('invite_555');

    render(<App />);

    expect(joinInvite).not.toHaveBeenCalled();
  });
});
