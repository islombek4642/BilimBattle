// frontend/src/socket/useGameSocket.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useGameSocket } from './useGameSocket';
import { createSocket } from './socketClient';

vi.mock('./socketClient', () => ({
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

describe('useGameSocket', () => {
  let fakeSocket: ReturnType<typeof createFakeSocket>;

  beforeEach(() => {
    fakeSocket = createFakeSocket();
    (createSocket as any).mockReturnValue(fakeSocket);
  });

  it('does not create a socket when token is null', () => {
    renderHook(() => useGameSocket(null));
    expect(createSocket).not.toHaveBeenCalled();
  });

  it('connects the socket when a token is provided and updates connected state', async () => {
    const { result } = renderHook(() => useGameSocket('tok'));

    expect(createSocket).toHaveBeenCalledWith('tok');
    expect(fakeSocket.connect).toHaveBeenCalledOnce();
    expect(result.current.connected).toBe(false);

    act(() => fakeSocket.__trigger('connect'));

    await waitFor(() => expect(result.current.connected).toBe(true));
  });

  it('exposes match_found, question, question_result, and game_over payloads as they arrive', async () => {
    const { result } = renderHook(() => useGameSocket('tok'));

    act(() =>
      fakeSocket.__trigger('match_found', {
        gameId: 'g1', category: 'umumiy_bilim', opponent: { telegramId: 999, firstName: 'Vali' },
      })
    );
    await waitFor(() =>
      expect(result.current.matchFound).toEqual({
        gameId: 'g1', category: 'umumiy_bilim', opponent: { telegramId: 999, firstName: 'Vali' },
      })
    );
    expect(result.current.opponent).toEqual({ telegramId: 999, firstName: 'Vali' });

    act(() =>
      fakeSocket.__trigger('question', {
        index: 0, total: 7, text: 'Q1?', options: ['A', 'B'], timeLimitMs: 10000,
      })
    );
    await waitFor(() => expect(result.current.question?.text).toBe('Q1?'));

    act(() =>
      fakeSocket.__trigger('question_result', {
        index: 0, correctIndex: 1, scores: [{ userId: 1, score: 100 }],
      })
    );
    await waitFor(() => expect(result.current.questionResult?.correctIndex).toBe(1));

    act(() =>
      fakeSocket.__trigger('game_over', { scores: [{ userId: 1, score: 700 }], winnerId: 1 })
    );
    await waitFor(() => expect(result.current.gameOver?.winnerId).toBe(1));
  });

  it('clears questionResult when a new question event arrives', async () => {
    const { result } = renderHook(() => useGameSocket('tok'));

    act(() =>
      fakeSocket.__trigger('question_result', { index: 0, correctIndex: 1, scores: [] })
    );
    await waitFor(() => expect(result.current.questionResult).not.toBeNull());

    act(() =>
      fakeSocket.__trigger('question', { index: 1, total: 7, text: 'Q2?', options: [], timeLimitMs: 10000 })
    );
    await waitFor(() => expect(result.current.questionResult).toBeNull());
  });

  it('sets sessionReplaced, inviteCreated, and inviteExpired flags on their respective events', async () => {
    const { result } = renderHook(() => useGameSocket('tok'));

    act(() => fakeSocket.__trigger('session_replaced'));
    await waitFor(() => expect(result.current.sessionReplaced).toBe(true));

    act(() => fakeSocket.__trigger('invite_created'));
    await waitFor(() => expect(result.current.inviteCreated).toBe(true));

    act(() => fakeSocket.__trigger('invite_expired'));
    await waitFor(() => expect(result.current.inviteExpired).toBe(true));
  });

  it('joinQueue/leaveQueue/submitAnswer/createInvite/joinInvite emit the correct events and payloads', () => {
    const { result } = renderHook(() => useGameSocket('tok'));

    result.current.joinQueue('umumiy_bilim');
    expect(fakeSocket.emit).toHaveBeenCalledWith('join_queue', { category: 'umumiy_bilim' });

    result.current.leaveQueue('umumiy_bilim');
    expect(fakeSocket.emit).toHaveBeenCalledWith('leave_queue', { category: 'umumiy_bilim' });

    result.current.submitAnswer('game-1', 2, 3);
    expect(fakeSocket.emit).toHaveBeenCalledWith('submit_answer', {
      gameId: 'game-1', questionIndex: 2, selectedOption: 3,
    });

    result.current.createInvite('sport_kino_musiqa');
    expect(fakeSocket.emit).toHaveBeenCalledWith('create_invite', { category: 'sport_kino_musiqa' });

    result.current.joinInvite(999, 'umumiy_bilim');
    expect(fakeSocket.emit).toHaveBeenCalledWith('join_invite', {
      inviterTelegramId: 999, category: 'umumiy_bilim',
    });
  });

  it('joinLevelQueue/leaveLevelQueue/createLevelInvite/joinLevelInvite emit the correct events and payloads', () => {
    const { result } = renderHook(() => useGameSocket('tok'));

    result.current.joinLevelQueue(7);
    expect(fakeSocket.emit).toHaveBeenCalledWith('join_level_queue', { level: 7 });

    result.current.leaveLevelQueue(7);
    expect(fakeSocket.emit).toHaveBeenCalledWith('leave_level_queue', { level: 7 });

    result.current.createLevelInvite(7);
    expect(fakeSocket.emit).toHaveBeenCalledWith('create_level_invite', { level: 7 });

    result.current.joinLevelInvite(999);
    expect(fakeSocket.emit).toHaveBeenCalledWith('join_level_invite', { inviterTelegramId: 999 });
  });

  it('includes level in matchFound and levelStars in gameOver when the server sends them', () => {
    const { result } = renderHook(() => useGameSocket('tok'));

    act(() => fakeSocket.__trigger('match_found', { gameId: 'g1', category: 'ingliz_tili', level: 7, opponent: { telegramId: 1, firstName: 'A' } }));
    expect(result.current.matchFound?.level).toBe(7);

    act(() => fakeSocket.__trigger('game_over', { scores: [], winnerId: null, levelStars: 2 }));
    expect(result.current.gameOver?.levelStars).toBe(2);
  });

  it('reconnectGame emits reconnect_game and resolves with the ack payload', async () => {
    const { result } = renderHook(() => useGameSocket('tok'));

    fakeSocket.emit.mockImplementation((event: string, payload: any, ack: any) => {
      if (event === 'reconnect_game') {
        ack({ found: true, currentQuestionIndex: 3, scores: [] });
      }
    });

    const ack = await result.current.reconnectGame('game-1');

    expect(fakeSocket.emit).toHaveBeenCalledWith('reconnect_game', { gameId: 'game-1' }, expect.any(Function));
    expect(ack).toEqual({ found: true, currentQuestionIndex: 3, scores: [] });
  });

  it('sets opponent from a reconnect_game ack when it includes one', async () => {
    const { result } = renderHook(() => useGameSocket('tok'));

    fakeSocket.emit.mockImplementation((event: string, _payload: any, ack: any) => {
      if (event === 'reconnect_game') {
        ack({ found: true, currentQuestionIndex: 2, scores: [], opponent: { telegramId: 42, firstName: 'Aziz' } });
      }
    });

    await result.current.reconnectGame('game-1');

    await waitFor(() => expect(result.current.opponent).toEqual({ telegramId: 42, firstName: 'Aziz' }));
  });

  it('clearOpponent resets opponent to null', async () => {
    const { result } = renderHook(() => useGameSocket('tok'));

    act(() =>
      fakeSocket.__trigger('match_found', {
        gameId: 'g1', category: 'umumiy_bilim', opponent: { telegramId: 999, firstName: 'Vali' },
      })
    );
    await waitFor(() => expect(result.current.opponent).not.toBeNull());

    act(() => result.current.clearOpponent());
    expect(result.current.opponent).toBeNull();
  });

  it('disconnects the socket on unmount', () => {
    const { unmount } = renderHook(() => useGameSocket('tok'));
    unmount();
    expect(fakeSocket.disconnect).toHaveBeenCalledOnce();
  });

  it('does not resolve reconnectGame if the component unmounts before the ack arrives', async () => {
    const { result, unmount } = renderHook(() => useGameSocket('tok'));

    let capturedAck: ((response: any) => void) | undefined;
    fakeSocket.emit.mockImplementation((event: string, _payload: any, ack: any) => {
      if (event === 'reconnect_game') {
        capturedAck = ack;
      }
    });

    const promise = result.current.reconnectGame('game-1');
    unmount();

    // Ack arrives AFTER unmount — should be a no-op, not resolve the promise.
    capturedAck?.({ found: true, currentQuestionIndex: 3, scores: [] });

    const resolved = await Promise.race([
      promise.then(() => 'resolved'),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 50)),
    ]);

    expect(resolved).toBe('timeout');
  });

  it('does not read ack.opponent (and so cannot call setOpponent) from a late reconnect_game ack that arrives after unmount', async () => {
    const { result, unmount } = renderHook(() => useGameSocket('tok'));

    let capturedAck: ((response: any) => void) | undefined;
    fakeSocket.emit.mockImplementation((event: string, _payload: any, ack: any) => {
      if (event === 'reconnect_game') {
        capturedAck = ack;
      }
    });

    result.current.reconnectGame('game-1');
    unmount();

    // Trap access to `opponent` on the stale ack payload. The epoch guard
    // (`if (epochRef.current !== requestEpoch) return;`) must run BEFORE
    // `if (ack.opponent) setOpponent(ack.opponent);` - if it ran after
    // instead, `ack.opponent` would be read (and setOpponent called with it)
    // regardless of the stale epoch. Reading the getter is a direct proxy
    // for "the code reached past the guard", which is a more reliable signal
    // than relying on a React unmounted-component warning (React 19 no
    // longer logs one for this case).
    const opponentGetter = vi.fn(() => ({ telegramId: 1, firstName: 'X' }));
    const staleAck: any = { found: true, currentQuestionIndex: 3, scores: [] };
    Object.defineProperty(staleAck, 'opponent', { get: opponentGetter, enumerable: true });

    // Ack arrives AFTER unmount and carries an opponent.
    capturedAck?.(staleAck);

    expect(opponentGetter).not.toHaveBeenCalled();
  });
});
