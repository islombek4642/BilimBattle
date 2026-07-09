import { redis } from '../config/redis';
import { env } from '../config/env';

const AVATAR_CACHE_TTL_SECONDS = 60 * 60 * 24;
// A confirmed "this user has no profile photo" is cached as an empty
// buffer (distinct from "we've never checked", which is a cache miss - i.e.
// redis.getBuffer returns null). Without this, every avatar request for a
// user with no photo would re-hit the Telegram API's two lookup calls on
// every single request (every match, both players) - real latency and
// unnecessary load for something that rarely changes.
const NO_PHOTO_SENTINEL = Buffer.alloc(0);

function avatarCacheKey(telegramId: number): string {
  return `avatar:${telegramId}`;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
}

interface TelegramPhotoSize {
  file_id: string;
  width: number;
  height: number;
}

interface TelegramUserProfilePhotos {
  total_count: number;
  photos: TelegramPhotoSize[][];
}

interface TelegramFile {
  file_id: string;
  file_path?: string;
}

export async function getAvatarBuffer(telegramId: number): Promise<Buffer | null> {
  // telegramId <= 0 is not a real Telegram account (e.g. BOT_TELEGRAM_ID = 0,
  // the sentinel used for bot-fallback matches in userRepository.ts) and can
  // never have a profile photo - this is a permanent fact, not a value that
  // could change, so skip Redis and the Telegram API entirely. Nothing to
  // cache since there's nothing that could ever be looked up.
  if (telegramId <= 0) return null;

  const cached = await redis.getBuffer(avatarCacheKey(telegramId));
  if (cached !== null) {
    return cached.length === 0 ? null : cached;
  }

  try {
    const buffer = await fetchAvatarFromTelegram(telegramId);
    await redis.set(avatarCacheKey(telegramId), buffer ?? NO_PHOTO_SENTINEL, 'EX', AVATAR_CACHE_TTL_SECONDS);
    return buffer;
  } catch (err) {
    console.error(`avatarService: failed to fetch avatar for telegramId ${telegramId}`, err);
    return null; // Not cached - a transient failure should not look like a confirmed "no photo" for 24h.
  }
}

// Returns null ONLY for a confirmed "no photo" response from Telegram (the
// caller negative-caches that). Any other problem (API error, failed
// download, network error, malformed response) THROWS instead, so
// getAvatarBuffer's catch above can treat it as transient and skip caching.
async function fetchAvatarFromTelegram(telegramId: number): Promise<Buffer | null> {
  const photosRes = await fetch(
    `https://api.telegram.org/bot${env.telegramBotToken}/getUserProfilePhotos?user_id=${telegramId}&limit=1`
  );
  const photosBody = (await photosRes.json()) as TelegramApiResponse<TelegramUserProfilePhotos>;
  if (!photosBody.ok || !photosBody.result) {
    throw new Error(`getUserProfilePhotos failed for telegramId ${telegramId}`);
  }
  if (photosBody.result.photos.length === 0) return null;

  const sizes = photosBody.result.photos[0];
  const largest = sizes[sizes.length - 1];

  const fileRes = await fetch(
    `https://api.telegram.org/bot${env.telegramBotToken}/getFile?file_id=${largest.file_id}`
  );
  const fileBody = (await fileRes.json()) as TelegramApiResponse<TelegramFile>;
  if (!fileBody.ok || !fileBody.result?.file_path) {
    throw new Error(`getFile failed for telegramId ${telegramId}`);
  }

  // Deliberately fetched server-side and returned as raw bytes below -
  // this URL embeds our bot token, so it must never reach the client (no
  // redirecting the browser here).
  const downloadRes = await fetch(
    `https://api.telegram.org/file/bot${env.telegramBotToken}/${fileBody.result.file_path}`
  );
  if (!downloadRes.ok) {
    throw new Error(`Telegram file download failed with status ${downloadRes.status} for telegramId ${telegramId}`);
  }

  const arrayBuffer = await downloadRes.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
