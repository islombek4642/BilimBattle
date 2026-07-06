import { Server, Socket } from 'socket.io';
import { createServer } from 'http';
import { verifySession } from '../auth/jwt';
import { submitAnswer, handleDisconnect, handleReconnect } from '../game/gameEngine';
import { getGame } from '../game/gameState';
import { handleJoinQueue, cancelWaiting } from '../matchmaking/matchmaker';

export interface SocketData {
  userId: number;
  telegramId: number;
  gameId?: string;
}

export type AppServer = Server<any, any, any, SocketData>;
export type AppSocket = Socket<any, any, any, SocketData>;

let io: AppServer | null = null;
let activeSocketsByUser = new Map<number, string>();

function trackActiveSocket(io: AppServer, socket: AppSocket, userId: number): void {
  const existingSocketId = activeSocketsByUser.get(userId);
  if (existingSocketId && existingSocketId !== socket.id) {
    const existingSocket = io.sockets.sockets.get(existingSocketId);
    existingSocket?.emit('session_replaced');
    existingSocket?.disconnect(true);
  }
  activeSocketsByUser.set(userId, socket.id);

  socket.on('disconnect', () => {
    if (activeSocketsByUser.get(userId) === socket.id) {
      activeSocketsByUser.delete(userId);
    }
  });
}

export function initSocketServer(httpServer: ReturnType<typeof createServer>): AppServer {
  activeSocketsByUser = new Map<number, string>();
  io = new Server<any, any, any, SocketData>(httpServer, { cors: { origin: '*' } });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      next(new Error('Sessiya topilmadi'));
      return;
    }
    const payload = verifySession(token);
    if (!payload) {
      next(new Error('Sessiya yaroqsiz'));
      return;
    }
    socket.data.userId = payload.userId;
    socket.data.telegramId = payload.telegramId;
    next();
  });

  io.on('connection', (socket: AppSocket) => {
    trackActiveSocket(io!, socket, socket.data.userId);

    socket.on('submit_answer', async ({ gameId, questionIndex, selectedOption }: { gameId: string; questionIndex: number; selectedOption: number }) => {
      await submitAnswer(gameId, socket.data.userId, selectedOption, questionIndex);
    });

    socket.on('join_queue', async ({ category }: { category: string }) => {
      await handleJoinQueue(io!, socket.id, socket.data.userId, category);
    });

    socket.on('leave_queue', ({ category }: { category: string }) => {
      cancelWaiting(socket.data.userId, category);
    });

    socket.on('reconnect_game', async ({ gameId }: { gameId: string }, ack: (state: unknown) => void) => {
      const reconnected = await handleReconnect(gameId, socket.data.userId, socket.id);
      if (!reconnected) {
        ack({ found: false });
        return;
      }
      socket.join(gameId);
      socket.data.gameId = gameId;
      const game = await getGame(gameId);
      ack({
        found: true,
        currentQuestionIndex: game!.currentQuestionIndex,
        scores: game!.players.map((p) => ({ userId: p.userId, score: p.score })),
      });
    });

    // Separate from trackActiveSocket's own 'disconnect' listener (which only
    // enforces single-session-per-user bookkeeping) - Socket.io supports
    // multiple listeners for the same event, and keeping this one separate
    // avoids touching trackActiveSocket's existing behavior. Only forfeit-eligible
    // if this socket was actually in an active game (socket.data.gameId is set
    // by createMatch on match start and by reconnect_game above).
    socket.on('disconnect', () => {
      if (socket.data.gameId) {
        handleDisconnect(socket.data.gameId, socket.data.userId).catch((err) => {
          console.error(`socketServer: failed to handle disconnect for game ${socket.data.gameId}`, err);
        });
      }
    });
  });

  return io;
}

export function getIO(): AppServer {
  if (!io) {
    throw new Error('Socket.io server hali ishga tushirilmagan');
  }
  return io;
}

export function setIOForTesting(mockIO: AppServer): void {
  io = mockIO;
}
