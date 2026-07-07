import { redis } from '../config/redis';

export interface PendingInvite {
  category: string;
  socketId: string;
  userId: number;
}

const INVITE_TTL_SECONDS = 5 * 60;

function inviteKey(inviterTelegramId: number): string {
  return `invite:${inviterTelegramId}`;
}

function parseInvite(raw: string): PendingInvite {
  return JSON.parse(raw) as PendingInvite;
}

export async function createInvite(inviterTelegramId: number, invite: PendingInvite): Promise<void> {
  await redis.set(inviteKey(inviterTelegramId), JSON.stringify(invite), 'EX', INVITE_TTL_SECONDS);
}

export async function consumeInvite(inviterTelegramId: number): Promise<PendingInvite | null> {
  const key = inviteKey(inviterTelegramId);
  const raw = await redis.get(key);
  if (!raw) return null;
  await redis.del(key);
  return parseInvite(raw);
}
