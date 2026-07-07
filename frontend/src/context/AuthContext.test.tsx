// frontend/src/context/AuthContext.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import * as authApi from '../api/auth';
import * as telegram from '../telegram/webApp';

function Consumer() {
  const { loading, error, token, user } = useAuth();
  if (loading) return <div>loading</div>;
  if (error) return <div>error: {error}</div>;
  return <div>user: {user?.firstName}, token: {token}</div>;
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows an error when no Telegram initData is available', async () => {
    vi.spyOn(telegram, 'getInitData').mockReturnValue('');
    vi.spyOn(telegram, 'getStartParam').mockReturnValue(undefined);

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText(/error:/)).toBeInTheDocument());
  });

  it('logs in with the Telegram initData and exposes the resulting token/user', async () => {
    vi.spyOn(telegram, 'getInitData').mockReturnValue('raw-init-data');
    vi.spyOn(telegram, 'getStartParam').mockReturnValue('invite_555');
    vi.spyOn(authApi, 'login').mockResolvedValue({
      token: 'jwt-token',
      user: { id: 1, firstName: 'Aziz' } as any,
    });

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    expect(screen.getByText('loading')).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByText('user: Aziz, token: jwt-token')).toBeInTheDocument()
    );

    expect(authApi.login).toHaveBeenCalledWith('raw-init-data', 'invite_555');
  });

  it('shows an error when the login API call fails', async () => {
    vi.spyOn(telegram, 'getInitData').mockReturnValue('raw-init-data');
    vi.spyOn(telegram, 'getStartParam').mockReturnValue(undefined);
    vi.spyOn(authApi, 'login').mockRejectedValue(new Error('network down'));

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText(/error:/)).toBeInTheDocument());
  });
});
