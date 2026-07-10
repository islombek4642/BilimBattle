// frontend/src/screens/AdminScreen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AdminScreen } from './AdminScreen';
import * as authContext from '../context/AuthContext';
import * as adminApi from '../api/admin';
import * as telegram from '../telegram/webApp';
import * as questionsApi from '../api/questions';

describe('AdminScreen', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1, telegramId: 9999 } as any, loading: false, error: null,
    });
    vi.spyOn(questionsApi, 'getCategories').mockResolvedValue({ categories: [] });
  });

  it('shows a loading state while stats are being fetched', () => {
    vi.spyOn(adminApi, 'getAdminStats').mockReturnValue(new Promise(() => {}));
    render(<AdminScreen />);
    expect(screen.getByText(/Yuklanmoqda/)).toBeInTheDocument();
  });

  it('still renders the question import form while stats are loading', () => {
    vi.spyOn(adminApi, 'getAdminStats').mockReturnValue(new Promise(() => {}));
    render(<AdminScreen />);
    expect(screen.getByText("Savol qo'shish")).toBeInTheDocument();
  });

  it('renders summary cards and the daily table once stats load', async () => {
    vi.spyOn(adminApi, 'getAdminStats').mockResolvedValue({
      summary: { totalUsers: 42, invitedUsers: 10, totalHumanMatches: 30, totalBotMatches: 5, returningUsers: 8 },
      daily: [
        { date: '2026-07-09', newUsers: 3, activeUsers: 12, humanMatches: 6, botMatches: 1 },
      ],
      users: [],
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

  it('opens the Telegram profile when clicking a user row with a username', async () => {
    const openProfileSpy = vi.spyOn(telegram, 'openTelegramProfile').mockImplementation(() => {});
    vi.spyOn(adminApi, 'getAdminStats').mockResolvedValue({
      summary: { totalUsers: 1, invitedUsers: 0, totalHumanMatches: 0, totalBotMatches: 0, returningUsers: 0 },
      daily: [],
      users: [
        { telegramId: 555, username: 'aziz_handle', firstName: 'Aziz', rating: 1000, gamesPlayed: 3, gamesWon: 1, createdAt: '2026-07-09' },
      ],
    });

    render(<AdminScreen />);

    const row = await screen.findByRole('button', { name: /Aziz/ });
    row.click();

    expect(openProfileSpy).toHaveBeenCalledWith('aziz_handle');
  });

  it('does not attempt to open a profile for a user with no username', async () => {
    const openProfileSpy = vi.spyOn(telegram, 'openTelegramProfile').mockImplementation(() => {});
    vi.spyOn(adminApi, 'getAdminStats').mockResolvedValue({
      summary: { totalUsers: 1, invitedUsers: 0, totalHumanMatches: 0, totalBotMatches: 0, returningUsers: 0 },
      daily: [],
      users: [
        { telegramId: 556, username: null, firstName: 'Vali', rating: 1000, gamesPlayed: 0, gamesWon: 0, createdAt: '2026-07-09' },
      ],
    });

    render(<AdminScreen />);

    const row = await screen.findByRole('button', { name: /Vali/ });
    expect(row).toBeDisabled();
    row.click();

    expect(openProfileSpy).not.toHaveBeenCalled();
  });

  it("shows an error message when stats fail to load", async () => {
    vi.spyOn(adminApi, 'getAdminStats').mockRejectedValue(new Error('forbidden'));

    render(<AdminScreen />);

    await waitFor(() => expect(screen.getByText(/Statistikani yuklab bo'lmadi/)).toBeInTheDocument());
  });

  it('still renders the question import form when stats fail to load', async () => {
    vi.spyOn(adminApi, 'getAdminStats').mockRejectedValue(new Error('forbidden'));

    render(<AdminScreen />);

    await waitFor(() => expect(screen.getByText(/Statistikani yuklab bo'lmadi/)).toBeInTheDocument());
    expect(screen.getByText("Savol qo'shish")).toBeInTheDocument();
  });
});
