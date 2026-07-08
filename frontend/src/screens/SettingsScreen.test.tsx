// frontend/src/screens/SettingsScreen.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsScreen } from './SettingsScreen';
import * as authContext from '../context/AuthContext';
import * as statsApi from '../api/stats';

describe('SettingsScreen', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1 } as any, loading: false, error: null,
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('loads and displays stats', async () => {
    vi.spyOn(statsApi, 'getMyStats').mockResolvedValue({
      gamesPlayed: 10, gamesWon: 6, winRate: 60, currentStreak: 2, bestStreak: 4, rating: 1080,
    });

    render(<SettingsScreen />);

    await waitFor(() => expect(screen.getByText(/O'ynagan o'yinlar: 10/)).toBeInTheDocument());
    expect(screen.getByText(/G'alaba foizi: 60%/)).toBeInTheDocument();
    expect(screen.getByText(/Joriy seriya: 2/)).toBeInTheDocument();
    expect(screen.getByText(/Eng uzun seriya: 4/)).toBeInTheDocument();
    expect(screen.getByText(/Reyting: 1080/)).toBeInTheDocument();
  });

  it('defaults sound to enabled and toggles it, persisting to localStorage', async () => {
    vi.spyOn(statsApi, 'getMyStats').mockResolvedValue({
      gamesPlayed: 0, gamesWon: 0, winRate: 0, currentStreak: 0, bestStreak: 0, rating: 1000,
    });

    render(<SettingsScreen />);

    expect(screen.getByText('Yoqilgan')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Yoqilgan'));

    expect(screen.getByText("O'chirilgan")).toBeInTheDocument();
    expect(localStorage.getItem('bilimbattle:soundEnabled')).toBe('false');
  });

  it('reads a previously-persisted sound-off preference on mount', () => {
    localStorage.setItem('bilimbattle:soundEnabled', 'false');
    vi.spyOn(statsApi, 'getMyStats').mockResolvedValue({
      gamesPlayed: 0, gamesWon: 0, winRate: 0, currentStreak: 0, bestStreak: 0, rating: 1000,
    });

    render(<SettingsScreen />);

    expect(screen.getByText("O'chirilgan")).toBeInTheDocument();
  });

  it('shows a loading state while stats are being fetched', async () => {
    let resolveStats: (value: any) => void;
    vi.spyOn(statsApi, 'getMyStats').mockReturnValue(
      new Promise((resolve) => { resolveStats = resolve; })
    );

    render(<SettingsScreen />);

    expect(screen.getByText(/Yuklanmoqda/)).toBeInTheDocument();

    resolveStats!({
      gamesPlayed: 0, gamesWon: 0, winRate: 0, currentStreak: 0, bestStreak: 0, rating: 1000,
    });
    await waitFor(() => expect(screen.queryByText(/Yuklanmoqda/)).not.toBeInTheDocument());
  });

  it('shows an error message when stats fail to load', async () => {
    vi.spyOn(statsApi, 'getMyStats').mockRejectedValue(new Error('network down'));

    render(<SettingsScreen />);

    await waitFor(() => expect(screen.getByText(/Statistikani yuklab bo'lmadi/)).toBeInTheDocument());
  });
});
