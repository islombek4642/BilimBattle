import { pool } from '../../src/config/db';
import { redis, closeRedis } from '../../src/config/redis';
import { setIOForTesting } from '../../src/socket/socketServer';
import { startGame, handleDisconnect, handleReconnect } from '../../src/game/gameEngine';
import { upsertUser } from '../../src/users/userRepository';
import { randomUUID } from 'crypto';

function createFakeIO() {
  const events: { room: string; event: string; payload: unknown }[] = [];
  const fakeIO = {
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          events.push({ room, event, payload });
        },
      };
    },
  };
  return { fakeIO, events };
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
// advanceTimersByTime; and (2) yield real event-loop turns (not just
// microtasks) after advancing timers, so the async chain the fake timer
// kicked off (getGame -> saveGame -> emit -> recordMatchResult -> deleteGame)
// has enough real turns to run to completion before we assert. Forty turns is
// generously more than the ~2-3 real round trips that chain needs (measured
// empirically), and in practice the two required assertions (winnerId,
// forfeited, and "no game_over on reconnect") pass reliably with this margin.
// Note: because the actual completion time of real Redis/Postgres I/O is a
// function of wall-clock time, not "how many turns we spun", there is no
// turn count that provides an absolute guarantee - only a very high
// probability. On rare runs a *second*, harmless "gameEngine: failed to
// process forfeit/resolve question" console.error can still appear (from a
// fire-and-forget .catch() handler discovering afterAll's cleanup already ran
// by the time its own chain finally settles) without affecting the
// assertions above, which by then have already observed the correct events.
// This is the same class of test-teardown-vs-timer-driven-async-chain race
// already called out in gameEngine.test.ts's comments; it's noise, not a
// functional bug.
async function flushRealAsyncWork(turns = 40): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
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
    // See flushRealAsyncWork's comment above for why nextTick/setImmediate/
    // hrtime must stay real: setTimeout/setInterval are what gameEngine.ts
    // actually schedules its timers with, so faking only those is enough to
    // deterministically control the 10s grace/timeout windows via
    // advanceTimersByTime, while real Redis/Postgres calls made from inside
    // those timer callbacks keep working normally.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'hrtime'] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('forfeits a player who does not reconnect within the grace period', async () => {
    const { fakeIO, events } = createFakeIO();
    setIOForTesting(fakeIO as any);

    const gameId = randomUUID();
    await startGame(gameId, 'umumiy_bilim', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' });

    await handleDisconnect(gameId, player1Id);
    jest.advanceTimersByTime(10_000);
    await flushRealAsyncWork();

    const gameOverEvent = events.find((e) => e.event === 'game_over');
    expect(gameOverEvent).toBeDefined();
    const payload = gameOverEvent!.payload as { winnerId: number; forfeited: boolean };
    expect(payload.winnerId).toBe(player2Id);
    expect(payload.forfeited).toBe(true);
  });

  it('cancels the forfeit if the player reconnects in time', async () => {
    const { fakeIO, events } = createFakeIO();
    setIOForTesting(fakeIO as any);

    const gameId = randomUUID();
    await startGame(gameId, 'umumiy_bilim', { userId: player1Id, socketId: 'sock1' }, { userId: player2Id, socketId: 'sock2' });

    await handleDisconnect(gameId, player1Id);
    const reconnected = await handleReconnect(gameId, player1Id, 'sock1-new');
    expect(reconnected).toBe(true);

    jest.advanceTimersByTime(10_000);
    // No disconnect timer is pending here (handleReconnect cleared it above),
    // but the ordinary question-timeout timer armed by startGame still fires
    // and kicks off its own real getGame/saveGame/emit chain (resolveQuestion
    // -> sendNextQuestion) for question 0. Flush it to completion too so it
    // can't leak into afterAll's pool.end()/closeRedis() (see
    // flushRealAsyncWork's comment above).
    await flushRealAsyncWork();

    const gameOverEvent = events.find((e) => e.event === 'game_over');
    expect(gameOverEvent).toBeUndefined();
  });
});
