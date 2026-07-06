import { Server, Socket } from 'socket.io';
import { createServer } from 'http';
import { verifySession } from '../auth/jwt';

export interface SocketData {
  userId: number;
  telegramId: number;
}

type AppServer = Server<any, any, any, SocketData>;
type AppSocket = Socket<any, any, any, SocketData>;

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
