// frontend/src/api/client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiGet, apiPost, ApiError } from './client';

describe('api/client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('apiGet resolves with the parsed JSON body on success', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ hello: 'world' }),
    });

    const result = await apiGet<{ hello: string }>('/ping');

    expect(result).toEqual({ hello: 'world' });
  });

  it('apiGet sends an Authorization header when a token is provided', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

    await apiGet('/protected', 'my-token');

    const [, options] = (fetch as any).mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer my-token');
  });

  it('apiPost sends the JSON body and correct method', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });

    await apiPost('/thing', { a: 1 });

    const [, options] = (fetch as any).mock.calls[0];
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ a: 1 });
  });

  it('throws an ApiError with the response status and server error message on failure', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'initData yuborilmadi' }),
    });

    await expect(apiPost('/auth/login', {})).rejects.toMatchObject({
      status: 400,
      message: 'initData yuborilmadi',
    });
  });

  it('throws a generic ApiError when the failed response has no error body', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('not json')),
    });

    const error = await apiGet('/broken').catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(500);
  });

  it('wraps a network failure (fetch rejecting) into an ApiError with status 0', async () => {
    (fetch as any).mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await apiGet('/anything').catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
  });
});
