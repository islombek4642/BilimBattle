import Redis from 'ioredis';
import { env } from './env';

let shuttingDown = false;

export const redis = new Redis(env.redisUrl);

redis.on('error', (err) => {
  if (shuttingDown) return;
  console.error('Unexpected Redis client error:', err);
});

export async function closeRedis(): Promise<void> {
  shuttingDown = true;
  await redis.quit();
}
