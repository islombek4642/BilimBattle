import { redis, closeRedis } from '../../src/config/redis';
import { getAvatarBuffer } from '../../src/users/avatarService';

describe('avatarService', () => {
  const telegramId = 555001;

  afterEach(async () => {
    await redis.del(`avatar:${telegramId}`);
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await closeRedis();
  });

  it('fetches and caches a photo from the Telegram API on a cold cache', async () => {
    const fakeImageBytes = Buffer.from('fake-jpeg-bytes');
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            result: {
              total_count: 1,
              photos: [[
                { file_id: 'small', width: 100, height: 100 },
                { file_id: 'big', width: 400, height: 400 },
              ]],
            },
          }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: { file_id: 'big', file_path: 'photos/file_1.jpg' } }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(fakeImageBytes.buffer.slice(fakeImageBytes.byteOffset, fakeImageBytes.byteOffset + fakeImageBytes.byteLength)),
      } as any);

    const result = await getAvatarBuffer(telegramId);

    expect(result).toEqual(fakeImageBytes);
    expect(global.fetch).toHaveBeenCalledTimes(3);

    const cached = await redis.getBuffer(`avatar:${telegramId}`);
    expect(cached).toEqual(fakeImageBytes);
  });

  it('returns the cached buffer on a second call without calling fetch again', async () => {
    const fakeImageBytes = Buffer.from('cached-bytes');
    await redis.set(`avatar:${telegramId}`, fakeImageBytes, 'EX', 3600);
    const fetchSpy = jest.spyOn(global, 'fetch');

    const result = await getAvatarBuffer(telegramId);

    expect(result).toEqual(fakeImageBytes);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null and negative-caches when the user has no profile photos', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true, result: { total_count: 0, photos: [] } }),
    } as any);

    const result = await getAvatarBuffer(telegramId);
    expect(result).toBeNull();

    const cached = await redis.getBuffer(`avatar:${telegramId}`);
    expect(cached).toEqual(Buffer.alloc(0));
  });

  it('returns null on a second call for a negatively-cached user without calling fetch again', async () => {
    await redis.set(`avatar:${telegramId}`, Buffer.alloc(0), 'EX', 3600);
    const fetchSpy = jest.spyOn(global, 'fetch');

    const result = await getAvatarBuffer(telegramId);

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null without throwing when the Telegram API call fails', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network down'));

    const result = await getAvatarBuffer(telegramId);
    expect(result).toBeNull();

    const cached = await redis.getBuffer(`avatar:${telegramId}`);
    expect(cached).toBeNull();
  });
});
