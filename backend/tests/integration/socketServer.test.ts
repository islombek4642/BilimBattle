import { createServer } from 'http';
import { AddressInfo } from 'net';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { initSocketServer } from '../../src/socket/socketServer';
import { signSession } from '../../src/auth/jwt';
import * as gameEngine from '../../src/game/gameEngine';
import * as matchmaker from '../../src/matchmaking/matchmaker';
import { pool } from '../../src/config/db';
import { redis, closeRedis } from '../../src/config/redis';
import { upsertUser } from '../../src/users/userRepository';
import { saveGame, deleteGame, GameState } from '../../src/game/gameState';
import { leaveQueue } from '../../src/matchmaking/queue';

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
    httpServer.close(async () => {
      await pool.end();
      await closeRedis();
      done();
    });
  });

  it('rejects a connection without a valid token', (done) => {
    const client: ClientSocket = ioClient(`http://localhost:${port}`, { auth: { token: 'invalid' } });
    client.on('connect_error', (err) => {
      expect(err.message).toContain('yaroqsiz');
      client.close();
      done();
    });
  });

  it('rejects a connection with no token at all', (done) => {
    const client: ClientSocket = ioClient(`http://localhost:${port}`, { auth: {} });
    client.on('connect_error', (err) => {
      expect(err.message).toContain('topilmadi');
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

  // Regression test for the crash fixed alongside this test: 'reconnect_game'
  // used to be an unwrapped `async (...) => {}` Socket.io listener. Socket.io
  // never awaits or catches a listener's returned promise, and this backend
  // has no global unhandledRejection handler, so a rejected promise inside
  // that handler (e.g. a transient Redis/Postgres blip in handleReconnect)
  // would have crashed the ENTIRE process - taking down every concurrent
  // match, not just this connection. This forces exactly that rejection via
  // a mocked handleReconnect and proves the server (and this same socket)
  // is still alive and answering normally afterward.
  it('survives a rejected handleReconnect instead of crashing the process', (done) => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const handleReconnectSpy = jest
      .spyOn(gameEngine, 'handleReconnect')
      .mockRejectedValueOnce(new Error('simulated Redis blip'));

    const token = signSession({ userId: 7777, telegramId: 7777 });
    const client: ClientSocket = ioClient(`http://localhost:${port}`, { auth: { token } });

    client.on('connect', () => {
      // First call: handleReconnect is forced to reject. The handler's
      // .catch() swallows it and only logs - it never calls this ack, so we
      // deliberately don't wait on it. If the rejection were left unhandled
      // (the bug this test pins), the process would crash right here and
      // every assertion below would never run.
      client.emit('reconnect_game', { gameId: 'forced-rejection-game' }, () => {
        done(new Error('ack should not be called when handleReconnect rejects'));
      });

      // Give the rejected promise a tick to be handled, then prove the
      // connection - and the whole process - is still alive by sending a
      // second, unrelated reconnect_game call (handleReconnect's real
      // implementation this time, since mockRejectedValueOnce only affects
      // the first call) and confirming it gets a normal ack response.
      setTimeout(() => {
        client.emit('reconnect_game', { gameId: 'still-no-such-game' }, (state: unknown) => {
          try {
            expect(state).toEqual({ found: false });
            expect(consoleErrorSpy).toHaveBeenCalledWith(
              expect.stringContaining('socketServer: failed to reconnect game forced-rejection-game'),
              expect.any(Error)
            );
            client.close();
            done();
          } catch (err) {
            done(err as Error);
          } finally {
            consoleErrorSpy.mockRestore();
            handleReconnectSpy.mockRestore();
          }
        });
      }, 100);
    });
  });

  // Regression test for the double-booking guard added to the 'join_queue'
  // handler: create_invite/join_invite already refused to act while
  // socket.data.gameId was set (the socket is mid-match), but join_queue had
  // no equivalent check. Without it, a user already in an active match who
  // called join_queue again would get pushed into the real Redis queue a
  // second time and could be paired into a second, concurrent match -
  // silently overwriting socket.data.gameId and leaving the first game's
  // disconnect/reconnect bookkeeping pointing at the wrong game.
  //
  // Getting socket.data.gameId set deliberately does NOT go through a real
  // create_invite/join_queue match here - that would spin up gameEngine's
  // real per-question setTimeout chain (10s per question, driven by real
  // Redis/Postgres), which would still be pending long after this test (and
  // this file's pool.end()/closeRedis() in afterAll) has finished, logging
  // spurious "Connection is closed" errors and leaking an open handle. A
  // game is instead fabricated directly via gameState.saveGame - the same
  // Redis-backed store gameEngine itself reads/writes - and 'reconnect_game'
  // (already exercised above) is used to make the server set
  // socket.data.gameId on THIS socket exactly the way production code does,
  // with no timers involved at all.
  //
  // Testing this via matchmaking/matchmaker.test.ts's fake-socket harness
  // (which calls handleJoinQueue directly) wouldn't exercise this guard at
  // all, since the guard lives in this socket handler, one layer above
  // handleJoinQueue - so a real client/server pair is used instead, and a
  // spy on matchmaker.handleJoinQueue confirms it's never even reached.
  it('ignores a join_queue call from a socket already in an active match', async () => {
    const category = 'umumiy_bilim';
    const gameId = 'double-booking-guard-test-game';
    const user = await upsertUser(8801, 'dbA', 'DoubleBookA', null);
    const handleJoinQueueSpy = jest.spyOn(matchmaker, 'handleJoinQueue');

    const fakeGame: GameState = {
      gameId,
      category,
      questions: [{ id: 1, text: 'q', options: ['a', 'b'], correctIndex: 0 }],
      currentQuestionIndex: 0,
      players: [
        { userId: user.id, socketId: 'placeholder', score: 0, answers: [], isBot: false },
        { userId: -1, socketId: 'placeholder-bot', score: 0, answers: [], isBot: true },
      ],
      status: 'active',
    };
    await saveGame(fakeGame);

    const token = signSession({ userId: user.id, telegramId: 8801 });
    const client: ClientSocket = ioClient(`http://localhost:${port}`, { auth: { token } });

    try {
      await new Promise<void>((resolve, reject) => {
        client.on('connect_error', reject);
        client.on('connect', () => {
          // Mirrors the "reconnect after a real match started" flow: this is
          // exactly how production sets socket.data.gameId on this socket,
          // just without startGame's real timers attached to `gameId`.
          client.emit('reconnect_game', { gameId }, (state: { found: boolean }) => {
            if (!state.found) {
              reject(new Error('expected the fabricated game to be found'));
              return;
            }
            resolve();
          });
        });
      });

      client.emit('join_queue', { category });

      // Give the (should-be-a-no-op) handler a moment to run so this isn't
      // racing its own async work before asserting.
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(handleJoinQueueSpy).not.toHaveBeenCalled();
      const queueLength = await redis.llen(`queue:${category}`);
      expect(queueLength).toBe(0);
    } finally {
      client.close();
      handleJoinQueueSpy.mockRestore();
      await deleteGame(gameId);
      // Belt-and-suspenders: if the guard being tested here ever regresses,
      // handleJoinQueue really would push this user into the real queue (the
      // assertions above would already have failed the test by this point,
      // but this keeps a regressed run from leaving a stray Redis entry for
      // the next run of this test, or of matchmaker.test.ts, which uses the
      // same category).
      await leaveQueue(category, user.id);
      await pool.query(`DELETE FROM users WHERE telegram_id = 8801`);
    }
  });
});
