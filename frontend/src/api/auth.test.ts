// frontend/src/api/auth.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as client from './client';
import { login } from './auth';

describe('api/auth', () => {
  it('calls apiPost with /auth/login and the given initData/startParam', async () => {
    const apiPostSpy = vi
      .spyOn(client, 'apiPost')
      .mockResolvedValue({ token: 'abc', user: { id: 1 } } as any);

    const result = await login('raw-init-data', 'invite_555');

    expect(apiPostSpy).toHaveBeenCalledWith('/auth/login', {
      initData: 'raw-init-data',
      startParam: 'invite_555',
    });
    expect(result).toEqual({ token: 'abc', user: { id: 1 } });
  });

  it('omits startParam from the payload key value when not provided (still calls with undefined)', async () => {
    const apiPostSpy = vi.spyOn(client, 'apiPost').mockResolvedValue({ token: 'x', user: {} } as any);

    await login('raw-init-data');

    expect(apiPostSpy).toHaveBeenCalledWith('/auth/login', {
      initData: 'raw-init-data',
      startParam: undefined,
    });
  });
});
