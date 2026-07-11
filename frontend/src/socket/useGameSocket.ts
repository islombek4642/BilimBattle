// frontend/src/socket/useGameSocket.ts
import { useEffect, useRef, useState, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { createSocket } from './socketClient';
import { ScoreEntry } from '../api/types';

export interface QuestionPayload {
  index: number;
  total: number;
  text: string;
  options: string[];
  timeLimitMs: number;
}

export interface QuestionResultPayload {
  index: number;
  correctIndex: number;
  scores: ScoreEntry[];
}

export interface GameOverPayload {
  scores: ScoreEntry[];
  winnerId: number | null;
  forfeited?: boolean;
  knockout?: boolean;
}

export interface OpponentInfo {
  telegramId: number;
  firstName: string;
}

export interface MatchFoundPayload {
  gameId: string;
  category: string;
  opponent: OpponentInfo;
}

export interface ReconnectAck {
  found: boolean;
  currentQuestionIndex?: number;
  scores?: ScoreEntry[];
  opponent?: OpponentInfo;
}

// Socket.io's own built-in lifecycle events ('connect'/'disconnect') are
// intentionally left out of this map - the base `Socket` class already types
// them internally, and redeclaring them here with no-arg signatures is
// unnecessary (and, depending on the socket.io-client version, can conflict
// with its own internal overloads for those two event names).
export interface ServerToClientEvents {
  match_found: (payload: MatchFoundPayload) => void;
  question: (payload: QuestionPayload) => void;
  question_result: (payload: QuestionResultPayload) => void;
  game_over: (payload: GameOverPayload) => void;
  session_replaced: () => void;
  invite_created: () => void;
  invite_expired: () => void;
}

export interface ClientToServerEvents {
  join_queue: (payload: { category: string }) => void;
  leave_queue: (payload: { category: string }) => void;
  submit_answer: (payload: { gameId: string; questionIndex: number; selectedOption: number }) => void;
  create_invite: (payload: { category: string }) => void;
  join_invite: (payload: { inviterTelegramId: number; category: string }) => void;
  reconnect_game: (payload: { gameId: string }, ack: (response: ReconnectAck) => void) => void;
}

export interface UseGameSocketResult {
  connected: boolean;
  matchFound: MatchFoundPayload | null;
  opponent: OpponentInfo | null;
  question: QuestionPayload | null;
  questionResult: QuestionResultPayload | null;
  gameOver: GameOverPayload | null;
  sessionReplaced: boolean;
  inviteCreated: boolean;
  inviteExpired: boolean;
  joinQueue: (category: string) => void;
  leaveQueue: (category: string) => void;
  submitAnswer: (gameId: string, questionIndex: number, selectedOption: number) => void;
  createInvite: (category: string) => void;
  joinInvite: (inviterTelegramId: number, category: string) => void;
  reconnectGame: (gameId: string) => Promise<ReconnectAck>;
  clearMatchFound: () => void;
  clearOpponent: () => void;
  clearQuestion: () => void;
  clearQuestionResult: () => void;
  clearGameOver: () => void;
  clearInviteCreated: () => void;
  clearInviteExpired: () => void;
}

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function useGameSocket(token: string | null): UseGameSocketResult {
  const socketRef = useRef<GameSocket | null>(null);
  // Bumped every time the effect tears down (unmount, or `token` changing).
  // reconnectGame's ack callback closes over the value that was current when
  // the emit was issued and refuses to resolve the promise if the ref has
  // since moved on to a later "epoch" - this is what stops a slow ack from a
  // now-defunct socket from being mistaken for a reply from the current one,
  // and stops it from doing anything at all once the component has unmounted.
  const epochRef = useRef(0);
  const [connected, setConnected] = useState(false);
  const [matchFound, setMatchFound] = useState<MatchFoundPayload | null>(null);
  const [opponent, setOpponent] = useState<OpponentInfo | null>(null);
  const [question, setQuestion] = useState<QuestionPayload | null>(null);
  const [questionResult, setQuestionResult] = useState<QuestionResultPayload | null>(null);
  const [gameOver, setGameOver] = useState<GameOverPayload | null>(null);
  const [sessionReplaced, setSessionReplaced] = useState(false);
  const [inviteCreated, setInviteCreated] = useState(false);
  const [inviteExpired, setInviteExpired] = useState(false);

  useEffect(() => {
    if (!token) return;

    const socket = createSocket(token);
    socketRef.current = socket;
    const currentEpoch = epochRef.current;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('match_found', (payload: MatchFoundPayload) => {
      setMatchFound(payload);
      setOpponent(payload.opponent);
    });
    socket.on('question', (payload: QuestionPayload) => {
      setQuestion(payload);
      setQuestionResult(null);
    });
    socket.on('question_result', (payload: QuestionResultPayload) => setQuestionResult(payload));
    socket.on('game_over', (payload: GameOverPayload) => setGameOver(payload));
    socket.on('session_replaced', () => setSessionReplaced(true));
    socket.on('invite_created', () => setInviteCreated(true));
    socket.on('invite_expired', () => setInviteExpired(true));

    socket.connect();

    return () => {
      // Advance the epoch BEFORE disconnecting so any reconnectGame ack that
      // fires after this point (even synchronously during disconnect()) sees
      // a stale epoch and no-ops instead of resolving against a socket that's
      // on its way out.
      epochRef.current = currentEpoch + 1;
      socket.disconnect();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [token]);

  const joinQueue = useCallback((category: string) => {
    socketRef.current?.emit('join_queue', { category });
  }, []);

  const leaveQueue = useCallback((category: string) => {
    socketRef.current?.emit('leave_queue', { category });
  }, []);

  const submitAnswer = useCallback(
    (gameId: string, questionIndex: number, selectedOption: number) => {
      socketRef.current?.emit('submit_answer', { gameId, questionIndex, selectedOption });
    },
    []
  );

  const createInvite = useCallback((category: string) => {
    socketRef.current?.emit('create_invite', { category });
  }, []);

  const joinInvite = useCallback((inviterTelegramId: number, category: string) => {
    socketRef.current?.emit('join_invite', { inviterTelegramId, category });
  }, []);

  const reconnectGame = useCallback((gameId: string): Promise<ReconnectAck> => {
    const socket = socketRef.current;
    const requestEpoch = epochRef.current;
    return new Promise((resolve) => {
      socket?.emit('reconnect_game', { gameId }, (ack: ReconnectAck) => {
        // The effect's cleanup bumps epochRef synchronously before it
        // disconnects the socket, so if that has already happened by the
        // time this ack arrives, the component has unmounted (or `token`
        // changed and a new socket has taken over) - resolving now would
        // hand a stale result to a caller that may no longer exist, or race
        // with state belonging to the new socket. Just drop it.
        if (epochRef.current !== requestEpoch) return;
        if (ack.opponent) setOpponent(ack.opponent);
        resolve(ack);
      });
    });
  }, []);

  const clearMatchFound = useCallback(() => setMatchFound(null), []);
  const clearOpponent = useCallback(() => setOpponent(null), []);
  const clearQuestion = useCallback(() => setQuestion(null), []);
  const clearQuestionResult = useCallback(() => setQuestionResult(null), []);
  const clearGameOver = useCallback(() => setGameOver(null), []);
  const clearInviteCreated = useCallback(() => setInviteCreated(false), []);
  const clearInviteExpired = useCallback(() => setInviteExpired(false), []);

  return {
    connected,
    matchFound,
    opponent,
    question,
    questionResult,
    gameOver,
    sessionReplaced,
    inviteCreated,
    inviteExpired,
    joinQueue,
    leaveQueue,
    submitAnswer,
    createInvite,
    joinInvite,
    reconnectGame,
    clearMatchFound,
    clearOpponent,
    clearQuestion,
    clearQuestionResult,
    clearGameOver,
    clearInviteCreated,
    clearInviteExpired,
  };
}
