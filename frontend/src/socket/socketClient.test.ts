import { describe, it, expect, vi } from 'vitest';
import { io } from 'socket.io-client';
import { createSocket } from './socketClient';

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({ id: 'fake-socket' })),
}));

describe('socket/socketClient', () => {
  it('calls io() with the socket URL, the token in auth, and autoConnect disabled', () => {
    createSocket('my-jwt-token');

    expect(io).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ auth: { token: 'my-jwt-token' }, autoConnect: false })
    );
  });
});
