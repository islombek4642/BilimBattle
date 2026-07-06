import { redis } from '../config/redis';

function queueKey(category: string): string {
  return `queue:${category}`;
}

export interface QueuedPlayer {
  userId: number;
  socketId: string;
}

function parsePlayer(raw: string): QueuedPlayer {
  return JSON.parse(raw) as QueuedPlayer;
}

export async function joinQueue(category: string, player: QueuedPlayer): Promise<void> {
  await redis.rpush(queueKey(category), JSON.stringify(player));
}

export async function leaveQueue(category: string, userId: number): Promise<void> {
  const items = await redis.lrange(queueKey(category), 0, -1);
  const match = items.find((item) => parsePlayer(item).userId === userId);
  if (match) {
    await redis.lrem(queueKey(category), 1, match);
  }
}

// NOT ATOMIC: LLEN + two LPOPs are three separate Redis round-trips.
// A concurrent call for the same category (e.g., another player joining
// mid-check) can interleave and cause double-pairing or a stranded pop.
// Safe for the current single-instance MVP given small expected queue
// sizes, but the caller (matchmaker.ts) must either serialize calls per
// category or this should become a Lua script if concurrency guarantees
// are ever needed.
export async function popTwoIfAvailable(category: string): Promise<[QueuedPlayer, QueuedPlayer] | null> {
  const length = await redis.llen(queueKey(category));
  if (length < 2) return null;
  const first = await redis.lpop(queueKey(category));
  const second = await redis.lpop(queueKey(category));
  if (!first || !second) return null;
  return [parsePlayer(first), parsePlayer(second)];
}
