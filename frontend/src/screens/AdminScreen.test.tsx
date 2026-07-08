// frontend/src/screens/AdminScreen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AdminScreen } from './AdminScreen';
import * as authContext from '../context/AuthContext';
import * as adminApi from '../api/admin';

describe('AdminScreen', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1, telegramId: 9999 } as any, loading: false, error: null,
    });
  });

  it('shows a loading state while stats are being fetched', () => {
    vi.spyOn(adminApi, 'getAdminStats').mockReturnValue(new Promise(() => {}));
    render(<AdminScreen />);
    expect(screen.getByText(/Yuklanmoqda/)).toBeInTheDocument();
  });

  it('renders summary cards and the daily table once stats load', async () => {
    vi.spyOn(adminApi, 'getAdminStats').mockResolvedValue({
      summary: { totalUsers: 42, invitedUsers: 10, totalHumanMatches: 30, totalBotMatches: 5, returningUsers: 8 },
      daily: [
        { date: '2026-07-09', newUsers: 3, activeUsers: 12, humanMatches: 6, botMatches: 1 },
      ],
    });

    render(<AdminScreen />);

    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());
    expect(screen.getByText('Jami foydalanuvchilar')).toBeInTheDocument();
    expect(screen.getByText('10 (24%)')).toBeInTheDocument();
    expect(screen.getByText('8 (19%)')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('2026-07-09')).toBeInTheDocument();
  });

  it("shows an error message when stats fail to load", async () => {
    vi.spyOn(adminApi, 'getAdminStats').mockRejectedValue(new Error('forbidden'));

    render(<AdminScreen />);

    await waitFor(() => expect(screen.getByText(/Statistikani yuklab bo'lmadi/)).toBeInTheDocument());
  });
});
