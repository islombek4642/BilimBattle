import Redis from 'ioredis';
import { env } from './env';

export const redis = new Redis(env.redisUrl);

redis.on('error', (err) => {
  console.error('Unexpected Redis client error:', err);
});
