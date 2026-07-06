import { randomUUID } from 'crypto';
import type { AppServer } from '../socket/socketServer';
import { joinQueue, leaveQueue, popTwoIfAvailable, QueuedPlayer } from './queue';
import { startGame } from '../game/gameEngine';
import { isValidCategory } from '../questions/questionRepository';
import { getOrCreateBotUser } from '../users/userRepository';

const BOT_MATCH_TIMEOUT_MS = 15_000;
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

export interface QueueParticipant {
  userId: number;
  socketId: string;
}

export async function handleJoinQueue(io: AppServer, socketId: string, userId: number, category: string): Promise<void> {
  if (!isValidCategory(category)) return;

  const pair = await runSerialized(category, async () => {
    await joinQueue(category, { userId, socketId });
    return popTwoIfAvailable(category);
  });

  if (pair) {
    const [player1, player2] = pair;
    clearWaitingTimer(player1.userId);
    clearWaitingTimer(player2.userId);
    await createMatch(io, category, player1, player2);
    return;
  }

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
      if (!removed) return;
      const bot = await getOrCreateBotUser();
      await createMatch(io, category, { userId, socketId }, { userId: bot.id, socketId: 'bot' }, true);
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
  void runSerialized(category, () => leaveQueue(category, userId));
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
  socket1?.join(gameId);
  if (socket1) socket1.data.gameId = gameId;

  if (player2.socketId !== 'bot') {
    const socket2 = io.sockets.sockets.get(player2.socketId);
    socket2?.join(gameId);
    if (socket2) socket2.data.gameId = gameId;
  }

  io.to(gameId).emit('match_found', { gameId, category });
  await startGame(gameId, category, player1, { ...player2, isBot: player2IsBot });
}
