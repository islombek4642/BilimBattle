import { createServer } from 'http';
import { AddressInfo } from 'net';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { initSocketServer } from '../../src/socket/socketServer';
import { signSession } from '../../src/auth/jwt';

describe('socket server session handling', () => {
  let httpServer: ReturnType<typeof createServer>;
  let port: number;

  beforeAll((done) => {
    httpServer = createServer();
    initSocketServer(httpServer);
    httpServer.listen(0, () => {
      port = (httpServer.address() as AddressInfo).port;
      done();
    });
  });

  afterAll((done) => {
    httpServer.close(done);
  });

  it('rejects a connection without a valid token', (done) => {
    const client: ClientSocket = ioClient(`http://localhost:${port}`, { auth: { token: 'invalid' } });
    client.on('connect_error', (err) => {
      expect(err.message).toContain('yaroqsiz');
      client.close();
      done();
    });
  });

  it('disconnects the previous socket when the same user connects again', (done) => {
    const token = signSession({ userId: 9999, telegramId: 9999 });
    const clientA: ClientSocket = ioClient(`http://localhost:${port}`, { auth: { token } });

    clientA.on('connect', () => {
      const clientB: ClientSocket = ioClient(`http://localhost:${port}`, { auth: { token } });

      clientA.on('session_replaced', () => {
        clientA.close();
        clientB.close();
        done();
      });
    });
  });
});
