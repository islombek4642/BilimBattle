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
}

export interface MatchFoundPayload {
  gameId: string;
  category: string;
}

export interface ReconnectAck {
  found: boolean;
  currentQuestionIndex?: number;
  scores?: ScoreEntry[];
}

export interface UseGameSocketResult {
  connected: boolean;
  matchFound: MatchFoundPayload | null;
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
  clearQuestionResult: () => void;
  clearGameOver: () => void;
  clearInviteCreated: () => void;
  clearInviteExpired: () => void;
}

export function useGameSocket(token: string | null): UseGameSocketResult {
  const socketRef = useRef<Socket | null>(null);
  // Bumped every time the effect tears down (unmount, or `token` changing).
  // reconnectGame's ack callback closes over the value that was current when
  // the emit was issued and refuses to resolve the promise if the ref has
  // since moved on to a later "epoch" - this is what stops a slow ack from a
  // now-defunct socket from being mistaken for a reply from the current one,
  // and stops it from doing anything at all once the component has unmounted.
  const epochRef = useRef(0);
  const [connected, setConnected] = useState(false);
  const [matchFound, setMatchFound] = useState<MatchFoundPayload | null>(null);
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
    socket.on('match_found', (payload: MatchFoundPayload) => setMatchFound(payload));
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
        resolve(ack);
      });
    });
  }, []);

  const clearMatchFound = useCallback(() => setMatchFound(null), []);
  const clearQuestionResult = useCallback(() => setQuestionResult(null), []);
  const clearGameOver = useCallback(() => setGameOver(null), []);
  const clearInviteCreated = useCallback(() => setInviteCreated(false), []);
  const clearInviteExpired = useCallback(() => setInviteExpired(false), []);

  return {
    connected,
    matchFound,
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
    clearQuestionResult,
    clearGameOver,
    clearInviteCreated,
    clearInviteExpired,
  };
}
