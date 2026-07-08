import { pool } from '../../src/config/db';
import { redis, closeRedis } from '../../src/config/redis';
import { setIOForTesting } from '../../src/socket/socketServer';
import { startGame, handleDisconnect, handleReconnect } from '../../src/game/gameEngine';
import { upsertUser } from '../../src/users/userRepository';
import { randomUUID } from 'crypto';

function createFakeIO() {
  const events: { room: string; event: string; payload: unknown }[] = [];
  const sockets = new Map<string, { id: string; data: Record<string, unknown> }>();
  const fakeIO = {
    sockets: {
      sockets: {
        get(id: string) {
          if (!sockets.has(id)) {
            sockets.set(id, { id, data: {} });
          }
          return sockets.get(id);
        },
      },
    },
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          events.push({ room, event, payload });
        },
      };
    },
  };
  return { fakeIO, events, sockets };
}

// jest.advanceTimersByTime() only fires the due setTimeout callback
// synchronously; it does NOT wait for whatever that callback goes on to do.
// handleDisconnect's/gameEngine's timers kick off real ioredis/pg calls, and
// those libraries settle their promises via process.nextTick/setImmediate
// callbacks fired from libuv's real poll phase - NOT via the Promise
// microtask queue. Plain `await Promise.resolve()` (even chained many times)
// only drains microtasks and provably never lets that real I/O complete
// (verified empirically: 100 chained `await Promise.resolve()` calls still
// left a real redis GET unresolved, while a single real event-loop turn via
// setImmediate resolved it immediately). So two things are required together:
// (1) tell useFakeTimers to leave nextTick/setImmediate/hrtime real (below),
// so ioredis/pg can actually settle their promises, while setTimeout/
// setInterval stay fake and fully under our control via
// advanceTimersByTime; and (2) actually poll for the condition each test
// cares about using real event-loop turns (not just microtasks), instead of
// spinning a fixed number of turns and hoping it was enough. Polling a real
// predicate is both faster on the common case (returns as soon as the
// condition is true) and more robust than a fixed iteration count, which can
// never be an absolute guarantee since real I/O completion time is a
// function of wall-clock time, not "how many turns we spun". On rare runs a
// *second*, harmless "gameEngine: failed to process forfeit/resolve
// question" console.error can still appear (from a fire-and-forget .catch()
// handler discovering afterAll's cleanup already ran by the time its own
// trailing chain - e.g. recordMatchResult/deleteGame after the awaited
// condition already became true - finally settles) without affecting the
// assertions below, which by then have already observed the correct events.
// That's noise from the test-teardown-vs-timer-driven-async-chain overlap,
// not a functional bug.
async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('gameEngine disconnect/reconnect handling', () => {
  let player1Id: number;
  let player2Id: number;

  beforeAll(async () => {
    const p1 = await upsertUser(7101, 'p1d', 'Player1D', null);
    const p2 = await upsertUser(7102, 'p2d', 'Player2D', null);
    player1Id = p1.id;
    player2Id = p2.id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM matches WHERE player1_id = $1 OR player2_id = $1`, [player1Id]);
    await pool.query(`DELETE FROM users WHERE telegram_id IN (7101, 7102)`);
    await pool.end();
    await closeRedis();
  });

  beforeEach(() => {
    // See waitUntil's comment above for why nextTick/setImmediate/hrtime must
    // stay real: setTimeout/setInterval are what gameEngine.ts actually
    // schedules its timers with, so faking only those is enough to
    // deterministically control the 10s grace/timeout windows via
    // advanceTimersByTime, while real Redis/Postgres calls made from inside
    // those timer callbacks keep working normally. Date is also left real -
    // waitUntil's timeout deadline is computed with Date.now(), which would
    // never advance (and the deadline would never be reached) if Date were
    // faked, since nothing in these tests calls advanceTimersByTime again
    // after the initial 10s jump.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'hrtime', 'Date'] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('forfeits a player who does not reconnect within the grace period', async () => {
    const { fakeIO, events, sockets } = createFakeIO();
    setIOForTesting(fakeIO as any);

    const gameId = randomUUID();
    await startGame(gameId, 'umumiy_bilim', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' });
    // Mirror matchmaker.ts's real behavior on match start.
    fakeIO.sockets.sockets.get('sock1')!.data.gameId = gameId;
    fakeIO.sockets.sockets.get('sock2')!.data.gameId = gameId;

    await handleDisconnect(gameId, player1Id);
    jest.advanceTimersByTime(10_000);
    await waitUntil(() => events.some((e) => e.event === 'game_over'));

    const gameOverEvent = events.find((e) => e.event === 'game_over');
    expect(gameOverEvent).toBeDefined();
    const payload = gameOverEvent!.payload as { winnerId: number; forfeited: boolean };
    expect(payload.winnerId).toBe(player2Id);
    expect(payload.forfeited).toBe(true);

    // Regression: forfeitIfStillDisconnected must clear socket.data.gameId
    // for both players too, same as the natural-finish path in finishGame -
    // otherwise a player whose match ends via forfeit (opponent disappeared)
    // would be permanently unable to join_queue again on that same socket.
    // waitUntil (not just the game_over event check above) is required here:
    // the emit happens partway through forfeitIfStillDisconnected, BEFORE
    // the later persistMatchResult/clearSocketGameId/deleteGame awaits - so
    // "game_over is in the events array" does not by itself guarantee the
    // rest of that async function has finished running yet.
    await waitUntil(() => sockets.get('sock1')!.data.gameId === undefined);
    expect(sockets.get('sock1')!.data.gameId).toBeUndefined();
    expect(sockets.get('sock2')!.data.gameId).toBeUndefined();
  });

  it('cancels the forfeit if the player reconnects in time', async () => {
    const { fakeIO, events } = createFakeIO();
    setIOForTesting(fakeIO as any);

    const gameId = randomUUID();
    await startGame(gameId, 'umumiy_bilim', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' });

    await handleDisconnect(gameId, player1Id);
    // handleReconnect now returns the GameState directly (or null on
    // failure) rather than a boolean - assert it's a non-null object rather
    // than `=== true`.
    const reconnectedGame = await handleReconnect(gameId, player1Id, 'sock1-new');
    expect(reconnectedGame).not.toBeNull();
    expect(reconnectedGame?.gameId).toBe(gameId);

    jest.advanceTimersByTime(10_000);
    // No disconnect timer is pending here (handleReconnect cleared it above),
    // but the ordinary question-timeout timer armed by startGame still fires
    // and kicks off its own real getGame/saveGame/emit chain (resolveQuestion
    // -> sendNextQuestion) for question 0. Wait for that chain to reach its
    // observable end state (the next 'question' event) so it can't leak into
    // afterAll's pool.end()/closeRedis() (see waitUntil's comment above).
    await waitUntil(() => events.filter((e) => e.event === 'question').length >= 2);

    const gameOverEvent = events.find((e) => e.event === 'game_over');
    expect(gameOverEvent).toBeUndefined();
  });
});
