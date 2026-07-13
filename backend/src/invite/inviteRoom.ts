import { redis } from '../config/redis';

export interface PendingInvite {
  category: string;
  socketId: string;
  userId: number;
  level?: number;
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

// GET-then-DEL would be a real, unbounded double-booking race: N concurrent
// join_invite calls for the same inviterTelegramId (shared link opened by
// multiple people, or a client retry) could ALL read the same non-null value
// before any DEL runs - unlike queue.ts's LPOP (destructive per-call, so at
// most 2 concurrent pops can succeed), a plain GET is non-destructive and has
// no such bound; all callers would go on to createMatch against the same
// inviter. Fixed by making the read+delete atomic.
//
// GETDEL (atomic, single round-trip) needs Redis >= 6.2. Checked the actual
// server this backend talks to via `INFO server` - it reports
// `redis_version:3.0.504`, and calling GETDEL against it empirically fails
// with "ERR unknown command 'getdel'" even though ioredis's client exposes a
// `getdel` method (that only proves the client library supports the command,
// not that the server does). So GETDEL is unavailable here - use a Lua
// script instead, which Redis has supported via EVAL since 2.6 and executes
// atomically (single-threaded, no interleaving between the GET and the DEL).
const CONSUME_SCRIPT = `
  local value = redis.call('GET', KEYS[1])
  if value then redis.call('DEL', KEYS[1]) end
  return value
`;

export async function consumeInvite(inviterTelegramId: number): Promise<PendingInvite | null> {
  const key = inviteKey(inviterTelegramId);
  const raw = (await redis.eval(CONSUME_SCRIPT, 1, key)) as string | null;
  return raw ? parseInvite(raw) : null;
}
