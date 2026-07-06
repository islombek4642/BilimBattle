import { Server, Socket } from 'socket.io';
import { createServer } from 'http';
import { verifySession } from '../auth/jwt';

let io: Server | null = null;
const activeSocketsByUser = new Map<number, string>();

export function initSocketServer(httpServer: ReturnType<typeof createServer>): Server {
  io = new Server(httpServer, { cors: { origin: '*' } });

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

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId as number;
    const existingSocketId = activeSocketsByUser.get(userId);
    if (existingSocketId && existingSocketId !== socket.id) {
      const existingSocket = io!.sockets.sockets.get(existingSocketId);
      existingSocket?.emit('session_replaced');
      existingSocket?.disconnect(true);
    }
    activeSocketsByUser.set(userId, socket.id);

    socket.on('disconnect', () => {
      if (activeSocketsByUser.get(userId) === socket.id) {
        activeSocketsByUser.delete(userId);
      }
    });
  });

  return io;
}

export function getIO(): Server {
  if (!io) {
    throw new Error('Socket.io server hali ishga tushirilmagan');
  }
  return io;
}

export function setIOForTesting(mockIO: Server): void {
  io = mockIO;
}
