import { redis, closeRedis } from '../../src/config/redis';
import { joinQueue, leaveQueue, popTwoIfAvailable } from '../../src/matchmaking/queue';

describe('matchmaking queue', () => {
  const category = 'test_category';

  afterEach(async () => {
    await redis.del(`queue:${category}`);
  });

  afterAll(async () => {
    await closeRedis();
  });

  it('returns null when fewer than two players are queued', async () => {
    await joinQueue(category, { userId: 1, socketId: 'a' });
    const result = await popTwoIfAvailable(category);
    expect(result).toBeNull();
  });

  it('pairs the first two players in FIFO order', async () => {
    await joinQueue(category, { userId: 1, socketId: 'a' });
    await joinQueue(category, { userId: 2, socketId: 'b' });
    await joinQueue(category, { userId: 3, socketId: 'c' });

    const pair = await popTwoIfAvailable(category);
    expect(pair).toEqual([
      { userId: 1, socketId: 'a' },
      { userId: 2, socketId: 'b' },
    ]);

    const remaining = await redis.llen(`queue:${category}`);
    expect(remaining).toBe(1);
  });

  it('removes a specific player from the queue', async () => {
    await joinQueue(category, { userId: 1, socketId: 'a' });
    await joinQueue(category, { userId: 2, socketId: 'b' });
    await leaveQueue(category, 1);

    const remaining = await redis.lrange(`queue:${category}`, 0, -1);
    expect(remaining.map((r) => JSON.parse(r).userId)).toEqual([2]);
  });
});
