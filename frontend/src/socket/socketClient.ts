// frontend/src/socket/socketClient.ts
import { io, Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from './useGameSocket';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:3000';

export function createSocket(token: string): Socket<ServerToClientEvents, ClientToServerEvents> {
  return io(SOCKET_URL, {
    auth: { token },
    autoConnect: false,
  });
}
