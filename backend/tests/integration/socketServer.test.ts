import { createServer } from 'http';
import { AddressInfo } from 'net';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { initSocketServer } from '../../src/socket/socketServer';
import { signSession } from '../../src/auth/jwt';
import * as gameEngine from '../../src/game/gameEngine';
import * as matchmaker from '../../src/matchmaking/matchmaker';
import { pool } from '../../src/config/db';
import { redis, closeRedis } from '../../src/config/redis';
import { upsertUser, getOrCreateBotUser } from '../../src/users/userRepository';
import { saveGame, deleteGame, GameState } from '../../src/game/gameState';
import { leaveQueue } from '../../src/matchmaking/queue';
import { consumeInvite } from '../../src/invite/inviteRoom';
import { upsertLevelProgress } from '../../src/game/levelProgress';

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

  it('throttles rapid join_queue emissions from the same socket', (done) => {
    const handleJoinQueueSpy = jest.spyOn(matchmaker, 'handleJoinQueue').mockResolvedValue(undefined);
    const token = signSession({ userId: 8888, telegramId: 8888 });
    const client: ClientSocket = ioClient(`http://localhost:${port}`, { auth: { token } });

    client.on('connect', () => {
      for (let i = 0; i < 10; i += 1) {
        client.emit('join_queue', { category: 'umumiy_bilim' });
      }
      setTimeout(() => {
        expect(handleJoinQueueSpy.mock.calls.length).toBeGreaterThan(0);
        expect(handleJoinQueueSpy.mock.calls.length).toBeLessThanOrEqual(5);
        handleJoinQueueSpy.mockRestore();
        client.close();
        done();
      }, 100);
    });
  });

  // Regression test for the fix alongside this test: reconnect_game's
  // throttle guard used to be a bare `return` on the throttled path, which
  // never called `ack(...)`. The frontend's reconnectGame() has no timeout
  // on that promise, so a throttled reconnect used to hang forever instead
  // of failing fast. RECONNECT_THROTTLE.max is 5 per second, so emitting 10
  // rapid calls (each with its own ack) guarantees at least some are
  // throttled - and this asserts every single one, throttled or not, still
  // receives an ack({ found: false }) (the gameId doesn't exist, so the
  // non-throttled calls resolve to "not found" too, same shape).
  it('acks a throttled reconnect_game call instead of leaving it hanging', (done) => {
    const token = signSession({ userId: 6666, telegramId: 6666 });
    const client: ClientSocket = ioClient(`http://localhost:${port}`, { auth: { token } });
    const acks: unknown[] = [];
    const totalEmits = 10;

    client.on('connect', () => {
      for (let i = 0; i < totalEmits; i += 1) {
        client.emit('reconnect_game', { gameId: 'reconnect-throttle-test-no-such-game' }, (state: unknown) => {
          acks.push(state);
        });
      }

      setTimeout(() => {
        try {
          expect(acks.length).toBe(totalEmits);
          acks.forEach((state) => expect(state).toEqual({ found: false }));
        } catch (err) {
          done(err as Error);
          return;
        } finally {
          client.close();
        }
        done();
      }, 300);
    });
  });

  // Regression test: a user opening their own invite link (previewing it,
  // or accidentally tapping their own "share" link) used to sail straight
  // through join_invite and get matched against themselves - createMatch
  // was called with both players resolving to the same userId. The fix
  // checks socket.data.telegramId against the inviterTelegramId payload
  // before consuming the invite, so this also asserts the invite survives
  // the self-join attempt untouched (consumeInvite still finds it).
  it('refuses to match a user against their own invite, and does not consume it', async () => {
    const category = 'umumiy_bilim';
    const telegramId = 8601;
    const user = await upsertUser(telegramId, 'selfJoin', 'SelfJoin', null);
    const createMatchSpy = jest.spyOn(matchmaker, 'createMatch');

    const token = signSession({ userId: user.id, telegramId });
    const client: ClientSocket = ioClient(`http://localhost:${port}`, { auth: { token } });

    try {
      await new Promise<void>((resolve, reject) => {
        client.on('connect_error', reject);
        client.on('connect', () => {
          client.on('invite_created', () => resolve());
          client.emit('create_invite', { category });
        });
      });

      await new Promise<void>((resolve, reject) => {
        client.on('invite_expired', () => resolve());
        client.emit('join_invite', { inviterTelegramId: telegramId, category });
        setTimeout(() => reject(new Error('timed out waiting for invite_expired')), 2000);
      });

      expect(createMatchSpy).not.toHaveBeenCalled();
      const stillPending = await consumeInvite(telegramId);
      expect(stillPending).not.toBeNull();
    } finally {
      client.close();
      createMatchSpy.mockRestore();
      await pool.query(`DELETE FROM users WHERE telegram_id = $1`, [telegramId]);
    }
  });

  it('includes opponent info in the reconnect_game ack, using the bot display name when the other player is a bot', async () => {
    const category = 'umumiy_bilim';
    const gameId = 'reconnect-opponent-test-game';
    const human = await upsertUser(8901, 'reconA', 'ReconA', null);
    const bot = await getOrCreateBotUser();

    const fakeGame: GameState = {
      gameId,
      category,
      questions: [{ id: 1, text: 'q', options: ['a', 'b'], correctIndex: 0 }],
      currentQuestionIndex: 0,
      players: [
        { userId: human.id, socketId: 'placeholder', score: 0, answers: [], isBot: false },
        { userId: bot.id, socketId: 'bot', score: 0, answers: [], isBot: true },
      ],
      status: 'active',
      botDisplayName: 'Sardor',
    };
    await saveGame(fakeGame);

    const token = signSession({ userId: human.id, telegramId: 8901 });
    const client: ClientSocket = ioClient(`http://localhost:${port}`, { auth: { token } });

    try {
      const ack = await new Promise<any>((resolve, reject) => {
        client.on('connect_error', reject);
        client.on('connect', () => {
          client.emit('reconnect_game', { gameId }, (state: any) => resolve(state));
        });
      });

      expect(ack.found).toBe(true);
      expect(ack.opponent).toEqual({ telegramId: 0, firstName: 'Sardor' });
    } finally {
      client.close();
      await deleteGame(gameId);
      await pool.query(`DELETE FROM users WHERE telegram_id = 8901`);
    }
  });

  it('includes opponent info in the reconnect_game ack for a human-vs-human match, with no bot override', async () => {
    const category = 'umumiy_bilim';
    const gameId = 'reconnect-human-opponent-test-game';
    const human = await upsertUser(8902, 'reconB', 'ReconB', null);
    const opponentHuman = await upsertUser(8903, 'reconC', 'ReconC', null);

    const fakeGame: GameState = {
      gameId,
      category,
      questions: [{ id: 1, text: 'q', options: ['a', 'b'], correctIndex: 0 }],
      currentQuestionIndex: 0,
      players: [
        { userId: human.id, socketId: 'placeholder', score: 0, answers: [], isBot: false },
        { userId: opponentHuman.id, socketId: 'placeholder-2', score: 0, answers: [], isBot: false },
      ],
      status: 'active',
    };
    await saveGame(fakeGame);

    const token = signSession({ userId: human.id, telegramId: 8902 });
    const client: ClientSocket = ioClient(`http://localhost:${port}`, { auth: { token } });

    try {
      const ack = await new Promise<any>((resolve, reject) => {
        client.on('connect_error', reject);
        client.on('connect', () => {
          client.emit('reconnect_game', { gameId }, (state: any) => resolve(state));
        });
      });

      expect(ack.found).toBe(true);
      expect(ack.opponent).toEqual({ telegramId: 8903, firstName: 'ReconC' });
    } finally {
      client.close();
      await deleteGame(gameId);
      await pool.query(`DELETE FROM users WHERE telegram_id IN (8902, 8903)`);
    }
  });

  // Level-mode equivalents of the join_queue/create_invite/join_invite
  // coverage above. gameEngine.startGame is mocked out for these (same
  // technique matchmaker.test.ts's "handleJoinLevelQueue pairs two players"
  // test already uses) so this test only exercises matchmaker.ts's pairing
  // and socketServer.ts's handler wiring, not gameEngine's real per-question
  // setTimeout chain (30s/question, driven by real Redis/Postgres) - which
  // would still be pending long after this file's afterAll (pool.end()/
  // closeRedis()) has run, the same hazard already called out on the
  // 'ignores a join_queue call from a socket already in an active match'
  // test above.
  //
  // Level 3 (rather than level 1) is used here deliberately: level 1 is
  // unlocked for every user with zero fixture data, which is exactly why
  // matchmaker.test.ts's own level-pairing tests already use the SAME real
  // Redis key ('queue:level:1') - and Jest runs test files in separate
  // parallel workers against one shared real Redis instance, so two files
  // both queueing on 'queue:level:1' at the same wall-clock moment could
  // pair a user from this file with a user from matchmaker.test.ts instead
  // of with each other. Level 3 needs one extra level_progress fixture row
  // per user (level 2, stars >= 2) but isn't touched by any other test file,
  // so 'queue:level:3' is exclusively this test's.
  describe('level mode socket events', () => {
    it('join_level_queue pairs two sockets that chose the SAME level, and starts a knockout-free match', async () => {
      const level = 3;
      const user1 = await upsertUser(8801001, 'levelSockA', 'LevelSockA', null);
      const user2 = await upsertUser(8801002, 'levelSockB', 'LevelSockB', null);
      await upsertLevelProgress(user1.id, 2, 2);
      await upsertLevelProgress(user2.id, 2, 2);
      const startGameSpy = jest.spyOn(gameEngine, 'startGame').mockResolvedValueOnce(undefined);

      const token1 = signSession({ userId: user1.id, telegramId: 8801001 });
      const token2 = signSession({ userId: user2.id, telegramId: 8801002 });
      const client1: ClientSocket = ioClient(`http://localhost:${port}`, { auth: { token: token1 } });
      const client2: ClientSocket = ioClient(`http://localhost:${port}`, { auth: { token: token2 } });

      try {
        // Both clients' 'connect' handlers (and client1's 'match_found'
        // handler) must be registered up front, in the same synchronous
        // tick as client creation above, and only THEN awaited together.
        // Registering client2's handler after awaiting on client1 (as an
        // earlier version of this test did) races client2's actual
        // connection - socket.io-client can connect within that await, so
        // by the time .on('connect', ...) was attached the event had
        // already fired and would never fire again, meaning client2 never
        // emitted join_level_queue at all and client1 would sit in the real
        // queue until the 15s bot-fallback timer, blowing this test's own
        // timeout in the process.
        const matchFound1Promise = new Promise<any>((resolve) => client1.on('match_found', resolve));
        const client1Connected = new Promise<void>((resolve) => client1.on('connect', () => {
          client1.emit('join_level_queue', { level });
          resolve();
        }));
        const client2Connected = new Promise<void>((resolve) => client2.on('connect', () => {
          client2.emit('join_level_queue', { level });
          resolve();
        }));

        await Promise.all([client1Connected, client2Connected]);
        const matchFound1 = await matchFound1Promise;
        await new Promise((resolve) => setTimeout(resolve, 300));

        expect(matchFound1.level).toBe(level);
        expect(matchFound1.opponent.telegramId).toBe(8801002);
      } finally {
        client1.close();
        client2.close();
        startGameSpy.mockRestore();
        await pool.query(`DELETE FROM matches WHERE player1_id IN ($1, $2) OR player2_id IN ($1, $2)`, [user1.id, user2.id]);
        await pool.query(`DELETE FROM level_progress WHERE user_id IN ($1, $2)`, [user1.id, user2.id]);
        await pool.query(`DELETE FROM users WHERE telegram_id IN (8801001, 8801002)`);
      }
    });

    it('leave_level_queue removes a waiting user from the level queue', async () => {
      const level = 3;
      const user = await upsertUser(8801003, 'levelSockC', 'LevelSockC', null);
      await upsertLevelProgress(user.id, 2, 2);

      const token = signSession({ userId: user.id, telegramId: 8801003 });
      const client: ClientSocket = ioClient(`http://localhost:${port}`, { auth: { token } });

      try {
        await new Promise<void>((resolve, reject) => {
          client.on('connect_error', reject);
          client.on('connect', () => {
            client.emit('join_level_queue', { level });
            resolve();
          });
        });
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(await redis.llen(`queue:level:${level}`)).toBe(1);

        client.emit('leave_level_queue', { level });
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(await redis.llen(`queue:level:${level}`)).toBe(0);
      } finally {
        client.close();
        await pool.query(`DELETE FROM level_progress WHERE user_id = $1`, [user.id]);
        await pool.query(`DELETE FROM users WHERE telegram_id = 8801003`);
      }
    });

    it('create_level_invite + join_level_invite pairs the inviter and invitee and starts a level match', async () => {
      const level = 1; // always unlocked for every user - no level_progress fixture needed
      const inviterTelegramId = 8801004;
      const inviter = await upsertUser(inviterTelegramId, 'levelSockD', 'LevelSockD', null);
      const invitee = await upsertUser(8801005, 'levelSockE', 'LevelSockE', null);
      const startGameSpy = jest.spyOn(gameEngine, 'startGame').mockResolvedValueOnce(undefined);

      const inviterToken = signSession({ userId: inviter.id, telegramId: inviterTelegramId });
      const inviteeToken = signSession({ userId: invitee.id, telegramId: 8801005 });
      const inviterClient: ClientSocket = ioClient(`http://localhost:${port}`, { auth: { token: inviterToken } });
      const inviteeClient: ClientSocket = ioClient(`http://localhost:${port}`, { auth: { token: inviteeToken } });

      try {
        // inviteeClient's 'connect' handler must be registered here, in the
        // same synchronous tick as inviteeClient's creation above, not
        // deferred behind the inviter's invite_created round-trip below -
        // same race as join_level_queue's test above: attaching it later
        // could miss an already-fired 'connect' event, meaning
        // join_level_invite is never emitted and both sides hang until this
        // test's own timeout.
        const inviteeConnected = new Promise<void>((resolve, reject) => {
          inviteeClient.on('connect_error', reject);
          inviteeClient.on('connect', () => resolve());
        });

        await new Promise<void>((resolve, reject) => {
          inviterClient.on('connect_error', reject);
          inviterClient.on('connect', () => {
            inviterClient.on('invite_created', () => resolve());
            inviterClient.emit('create_level_invite', { level });
          });
        });
        await inviteeConnected;

        const [inviterMatchFound, inviteeMatchFound] = await Promise.all([
          new Promise<any>((resolve) => inviterClient.on('match_found', resolve)),
          new Promise<any>((resolve) => {
            inviteeClient.on('match_found', resolve);
            inviteeClient.emit('join_level_invite', { inviterTelegramId });
          }),
        ]);

        expect(inviterMatchFound.level).toBe(level);
        expect(inviterMatchFound.opponent.telegramId).toBe(8801005);
        expect(inviteeMatchFound.level).toBe(level);
        expect(inviteeMatchFound.opponent.telegramId).toBe(inviterTelegramId);
      } finally {
        inviterClient.close();
        inviteeClient.close();
        startGameSpy.mockRestore();
        await pool.query(`DELETE FROM matches WHERE player1_id IN ($1, $2) OR player2_id IN ($1, $2)`, [inviter.id, invitee.id]);
        await pool.query(`DELETE FROM users WHERE telegram_id IN ($1, $2)`, [inviterTelegramId, 8801005]);
      }
    });

    // Mirrors join_level_queue's server-side unlock re-check: a modified
    // client could emit create_level_invite with an arbitrary level number,
    // trying to hand a friend a link to a level the inviter hasn't actually
    // unlocked themselves. Level 3 requires level 2 to have stars >= 2 (see
    // isLevelUnlocked); this user has no level_progress rows at all, so
    // level 3 must be refused.
    it('create_level_invite refuses to create an invite for a level the inviter has not unlocked', async () => {
      const level = 3;
      const telegramId = 8801006;
      const user = await upsertUser(telegramId, 'levelSockF', 'LevelSockF', null);

      const token = signSession({ userId: user.id, telegramId });
      const client: ClientSocket = ioClient(`http://localhost:${port}`, { auth: { token } });

      try {
        let inviteCreated = false;
        client.on('invite_created', () => {
          inviteCreated = true;
        });
        await new Promise<void>((resolve, reject) => {
          client.on('connect_error', reject);
          client.on('connect', () => {
            client.emit('create_level_invite', { level });
            resolve();
          });
        });
        await new Promise((resolve) => setTimeout(resolve, 300));

        expect(inviteCreated).toBe(false);
        const stillPending = await consumeInvite(telegramId);
        expect(stillPending).toBeNull();
      } finally {
        client.close();
        await pool.query(`DELETE FROM users WHERE telegram_id = $1`, [telegramId]);
      }
    });
  });
});
