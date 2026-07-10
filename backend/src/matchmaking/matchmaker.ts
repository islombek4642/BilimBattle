import { randomUUID } from 'crypto';
import type { AppServer } from '../socket/socketServer';
import { joinQueue, leaveQueue, popTwoIfAvailable, QueuedPlayer } from './queue';
import { startGame } from '../game/gameEngine';
import { isValidCategory } from '../questions/questionRepository';
import { getOrCreateBotUser, getUserById } from '../users/userRepository';

const BOT_MATCH_TIMEOUT_MS = 15_000;
// Tracks users currently waiting in a queue (joined, not yet paired), keyed
// by userId, so their bot-fallback timer can be found and cancelled on a
// real pairing or an explicit leave_queue. handleJoinQueue guards against a
// duplicate join for a user already present here (see below), so — unlike
// gameEngine.ts's activeTimers — an entry can't be silently orphaned by a
// double-join; it's always removed by exactly one of: a real pairing, an
// explicit cancelWaiting, or the bot-timeout callback itself firing.
const waitingTimers = new Map<number, NodeJS.Timeout>();

// Per-category serialization for every operation that touches the queue's
// Redis list (join, pop-pair, leave). queue.ts's popTwoIfAvailable is
// documented as NOT ATOMIC (LLEN + two LPOPs = three round-trips) and calls
// out that its caller — this module — must serialize calls per category to
// avoid double-pairing/stranded pops. Two players calling join_queue at
// nearly the same wall-clock moment is the normal case for a matchmaker, not
// a rare edge case, so this is a real hazard, not a theoretical one.
//
// Fix: chain every queue-touching operation for a given category onto a
// single promise so at most one is ever "in flight" against Redis for that
// category at a time. This is a simple async mutex keyed by category — far
// simpler than a Lua script and sufficient for this MVP's single-instance,
// small-queue scale (matches the same tradeoff already made in
// gameEngine.ts's submitAnswer). If this ever needs to hold across multiple
// server instances, it must become a Lua script (or Redis-based lock)
// instead, since an in-memory Map obviously can't serialize across processes.
const categoryLocks = new Map<string, Promise<unknown>>();

// Presentation-only display names for the bot fallback opponent - picked
// fresh per match so the same human never sees a literal "Bot" (the DB
// user's real first_name), and so a user playing many matches doesn't
// always see the identical fake name either. The underlying bot `users` row
// (telegram_id 0, first_name "Bot") is never changed - this only affects
// what gets sent over the wire in match_found/reconnect_game.
export const BOT_DISPLAY_NAMES = [
  'Aziz', 'Malika', 'Sardor', 'Dilnoza', 'Jasur', 'Nodira', 'Bekzod',
  'Zarina', 'Otabek', 'Madina', 'Sherzod', 'Gulnora', 'Farrux', 'Shahnoza',
  "Ulug'bek",
];

export function pickRandomBotDisplayName(): string {
  return BOT_DISPLAY_NAMES[Math.floor(Math.random() * BOT_DISPLAY_NAMES.length)];
}

function runSerialized<T>(category: string, fn: () => Promise<T>): Promise<T> {
  const previous = categoryLocks.get(category) ?? Promise.resolve();
  const result = previous.then(fn, fn);
  // Swallow errors here only for chaining purposes so one failed operation
  // doesn't permanently wedge the lock for the category; the real error still
  // propagates to the caller via `result`.
  categoryLocks.set(
    category,
    result.then(
      () => undefined,
      () => undefined
    )
  );
  return result;
}

export async function handleJoinQueue(io: AppServer, socketId: string, userId: number, category: string): Promise<void> {
  if (!(await isValidCategory(category))) return;

  // Idempotency guard: a duplicate join_queue call (double-tap, client
  // retry) for a user already waiting must be ignored. Without this,
  // waitingTimers.set(userId, timer) below would silently overwrite the
  // first timer's map entry without clearing its underlying setTimeout (the
  // stray timer fires later and deletes the SECOND timer's map entry
  // instead of its own), and joinQueue would push a second Redis entry for
  // the same user, letting popTwoIfAvailable return [thisUser, thisUser] —
  // a user matched against themselves.
  if (waitingTimers.has(userId)) {
    console.log(`matchmaker: ignoring duplicate join_queue from userId=${userId} (already waiting) category=${category}`);
    return;
  }

  console.log(`matchmaker: join_queue received userId=${userId} socketId=${socketId} category=${category}`);

  const pair = await runSerialized(category, async () => {
    await joinQueue(category, { userId, socketId });
    return popTwoIfAvailable(category);
  });

  if (pair) {
    const [player1, player2] = pair;
    console.log(`matchmaker: paired userId=${player1.userId} with userId=${player2.userId} category=${category}`);
    clearWaitingTimer(player1.userId);
    clearWaitingTimer(player2.userId);
    await createMatch(io, category, player1, player2);
    return;
  }

  console.log(`matchmaker: no opponent yet for userId=${userId} category=${category} - waiting up to ${BOT_MATCH_TIMEOUT_MS}ms before bot fallback`);

  const timer = setTimeout(() => {
    waitingTimers.delete(userId);
    void runSerialized(category, () => leaveQueue(category, userId)).then(async (removed) => {
      // Narrow but real race: this setTimeout callback and a concurrent
      // real player joining the same category are asynchronous relative to
      // each other. It's possible for both to be "in flight" at once: this
      // callback has already fired (and deleted the waitingTimer entry
      // above) at the exact moment a second real player's handleJoinQueue
      // call reaches popTwoIfAvailable first and pairs this user with a
      // real opponent before this callback's own (serialized) leaveQueue
      // turn runs. In that case leaveQueue finds nothing to remove (this
      // user is already gone from the Redis list, and already has/will have
      // a real match) — `removed` is false, and we must NOT proceed to
      // create a second, duplicate bot match for the same user.
      if (!removed) {
        console.log(`matchmaker: bot-fallback timer fired for userId=${userId} but they were already paired/removed - skipping`);
        return;
      }
      console.log(`matchmaker: bot-fallback timeout reached for userId=${userId} category=${category} - matching with a bot`);
      const bot = await getOrCreateBotUser();
      await createMatch(io, category, { userId, socketId }, { userId: bot.id, socketId: 'bot' }, true);
    }).catch((err) => {
      console.error('matchmaker: bot-fallback match failed', err);
    });
  }, BOT_MATCH_TIMEOUT_MS);
  waitingTimers.set(userId, timer);
}

// Called from the 'leave_queue' socket event. Also reachable (harmlessly) if
// a client emits leave_queue after already being matched: by then
// handleJoinQueue's match branch has already cleared this user's waiting
// timer (clearWaitingTimer is a no-op the second time), and leaveQueue itself
// is a no-op search-and-remove that finds nothing because popTwoIfAvailable
// already popped this user out of the Redis list. So this function is safe
// to call at any point in a player's queue lifecycle, matched or not.
export function cancelWaiting(userId: number, category: string): void {
  clearWaitingTimer(userId);
  runSerialized(category, () => leaveQueue(category, userId)).catch((err) => {
    console.error('matchmaker: failed to leave queue', err);
  });
}

function clearWaitingTimer(userId: number): void {
  const timer = waitingTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    waitingTimers.delete(userId);
  }
}

export async function createMatch(
  io: AppServer,
  category: string,
  player1: QueuedPlayer,
  player2: QueuedPlayer,
  player2IsBot = false
): Promise<void> {
  const gameId = randomUUID();

  const socket1 = io.sockets.sockets.get(player1.socketId);
  if (socket1) {
    socket1.join(gameId);
    socket1.data.gameId = gameId;
  }

  const socket2 = player2.socketId !== 'bot' ? io.sockets.sockets.get(player2.socketId) : undefined;
  if (socket2) {
    socket2.join(gameId);
    socket2.data.gameId = gameId;
  }

  const botDisplayName = player2IsBot ? pickRandomBotDisplayName() : undefined;

  // Each side needs the OTHER side's identity, so both are fetched up front
  // and match_found is emitted to each socket individually below (not
  // broadcast via io.to(gameId).emit, which would send the identical
  // payload to both - the whole point here is the payloads differ).
  const [player1User, player2User] = await Promise.all([
    getUserById(player1.userId),
    getUserById(player2.userId),
  ]);

  if (socket1 && player2User) {
    socket1.emit('match_found', {
      gameId,
      category,
      opponent: {
        telegramId: player2User.telegramId,
        firstName: botDisplayName ?? player2User.firstName,
      },
    });
  } else if (socket1) {
    console.error(`matchmaker: missing user record for player2 userId=${player2.userId} - skipping match_found emit to player1 (gameId=${gameId})`);
  }
  if (socket2 && player1User) {
    socket2.emit('match_found', {
      gameId,
      category,
      opponent: { telegramId: player1User.telegramId, firstName: player1User.firstName },
    });
  } else if (socket2) {
    console.error(`matchmaker: missing user record for player1 userId=${player1.userId} - skipping match_found emit to player2 (gameId=${gameId})`);
  }

  await startGame(gameId, category, player1, { ...player2, isBot: player2IsBot }, botDisplayName);
}
