import { redis } from '../config/redis';

function queueKey(category: string): string {
  return `queue:${category}`;
}

export interface QueuedPlayer {
  userId: number;
  socketId: string;
}

export async function joinQueue(category: string, player: QueuedPlayer): Promise<void> {
  await redis.rpush(queueKey(category), JSON.stringify(player));
}

export async function leaveQueue(category: string, userId: number): Promise<void> {
  const items = await redis.lrange(queueKey(category), 0, -1);
  const match = items.find((item) => JSON.parse(item).userId === userId);
  if (match) {
    await redis.lrem(queueKey(category), 1, match);
  }
}

export async function popTwoIfAvailable(category: string): Promise<[QueuedPlayer, QueuedPlayer] | null> {
  const length = await redis.llen(queueKey(category));
  if (length < 2) return null;
  const first = await redis.lpop(queueKey(category));
  const second = await redis.lpop(queueKey(category));
  if (!first || !second) return null;
  return [JSON.parse(first), JSON.parse(second)];
}
