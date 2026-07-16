// frontend/src/screens/SettingsScreen.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsScreen } from './SettingsScreen';
import * as authContext from '../context/AuthContext';
import * as navigationContext from '../context/NavigationContext';
import * as statsApi from '../api/stats';
import * as profileApi from '../api/profile';
import * as leagueApi from '../api/league';

describe('SettingsScreen', () => {
  const navigate = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    navigate.mockClear();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok',
      user: { id: 1, telegramId: 111, firstName: 'Aziz', username: 'aziz_handle' } as any,
      loading: false,
      error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'settings' },
      navigate, goBack: vi.fn(), replace: vi.fn(), reset: vi.fn(),
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('shows a "Mening profilim" entry point and navigates to the profile screen when clicked', async () => {
    vi.spyOn(statsApi, 'getMyStats').mockResolvedValue({
      gamesPlayed: 10, gamesWon: 6, winRate: 60, currentStreak: 2, bestStreak: 4, rating: 1080,
    });

    render(<SettingsScreen />);

    const button = await screen.findByText('Mening profilim');
    fireEvent.click(button);

    expect(navigate).toHaveBeenCalledWith({ name: 'profile' });
  });

  it('shows the league-tier avatar border and mastery title on the "Mening profilim" entry point once loaded', async () => {
    vi.spyOn(statsApi, 'getMyStats').mockResolvedValue({
      gamesPlayed: 10, gamesWon: 6, winRate: 60, currentStreak: 2, bestStreak: 4, rating: 1080,
    });
    vi.spyOn(profileApi, 'getProfile').mockResolvedValue({
      xp: 0, masteryPoints: 0, masteryRank: 'Yuqori', category: 'ingliz_tili',
      dailyQuests: [], streak: { current: 0, best: 0, freezeAvailable: true },
    });
    vi.spyOn(leagueApi, 'getMyLeague').mockResolvedValue({
      tier: 'Olmos', weeklyXp: 0, bracket: [],
    });

    render(<SettingsScreen />);

    await screen.findByText('Yuqori');
    expect(screen.getByAltText('Foydalanuvchi rasmi')).toHaveClass('border-league-diamond');
  });

  it('still shows the "Mening profilim" entry point normally when the profile/league fetches fail', async () => {
    vi.spyOn(statsApi, 'getMyStats').mockResolvedValue({
      gamesPlayed: 10, gamesWon: 6, winRate: 60, currentStreak: 2, bestStreak: 4, rating: 1080,
    });
    vi.spyOn(profileApi, 'getProfile').mockRejectedValue(new Error('network down'));
    vi.spyOn(leagueApi, 'getMyLeague').mockRejectedValue(new Error('network down'));

    render(<SettingsScreen />);

    expect(await screen.findByText('Mening profilim')).toBeInTheDocument();
  });

  it('loads and displays the detailed stat rows', async () => {
    vi.spyOn(statsApi, 'getMyStats').mockResolvedValue({
      gamesPlayed: 10, gamesWon: 6, winRate: 60, currentStreak: 2, bestStreak: 4, rating: 1080,
    });

    render(<SettingsScreen />);

    await waitFor(() => expect(screen.getByText("G'alaba foizi")).toBeInTheDocument());
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getByText('Joriy seriya')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Eng uzun seriya')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('defaults sound to enabled and toggles it, persisting to localStorage', async () => {
    vi.spyOn(statsApi, 'getMyStats').mockResolvedValue({
      gamesPlayed: 0, gamesWon: 0, winRate: 0, currentStreak: 0, bestStreak: 0, rating: 1000,
    });

    render(<SettingsScreen />);

    const toggle = await screen.findByRole('switch', { name: 'Ovoz/Vibratsiya' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(localStorage.getItem('bilimbattle:soundEnabled')).toBe('false');
  });

  it('anchors the toggle thumb with an explicit left-0 so its position does not rely on browser-computed static positioning', async () => {
    // Regression: the thumb previously had no explicit `left` value and
    // relied on the browser's static-position fallback for an absolutely
    // positioned element inside a <button> - inconsistent across browser
    // engines and reported as a visibly misplaced thumb on a real device.
    vi.spyOn(statsApi, 'getMyStats').mockResolvedValue({
      gamesPlayed: 0, gamesWon: 0, winRate: 0, currentStreak: 0, bestStreak: 0, rating: 1000,
    });

    render(<SettingsScreen />);
    const toggle = await screen.findByRole('switch', { name: 'Ovoz/Vibratsiya' });
    const thumb = toggle.querySelector('span')!;

    expect(thumb).toHaveClass('left-0');
    expect(thumb).toHaveClass('translate-x-[25px]');

    fireEvent.click(toggle);

    expect(thumb).toHaveClass('left-0');
    expect(thumb).toHaveClass('translate-x-[3px]');
  });

  it('reads a previously-persisted sound-off preference on mount', async () => {
    localStorage.setItem('bilimbattle:soundEnabled', 'false');
    vi.spyOn(statsApi, 'getMyStats').mockResolvedValue({
      gamesPlayed: 0, gamesWon: 0, winRate: 0, currentStreak: 0, bestStreak: 0, rating: 1000,
    });

    render(<SettingsScreen />);

    expect(await screen.findByRole('switch', { name: 'Ovoz/Vibratsiya' })).toHaveAttribute('aria-checked', 'false');
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

  it('does not show the admin entry point for a non-admin user', async () => {
    vi.stubEnv('VITE_ADMIN_TELEGRAM_ID', '999');
    vi.spyOn(statsApi, 'getMyStats').mockResolvedValue({
      gamesPlayed: 0, gamesWon: 0, winRate: 0, currentStreak: 0, bestStreak: 0, rating: 1000,
    });

    render(<SettingsScreen />); // mocked user.telegramId is 111, not 999

    expect(screen.queryByText('Admin statistikasi')).not.toBeInTheDocument();
  });

  it("shows the admin entry point and navigates to 'admin' when the logged-in user's telegramId matches VITE_ADMIN_TELEGRAM_ID", async () => {
    vi.stubEnv('VITE_ADMIN_TELEGRAM_ID', '111');
    vi.spyOn(statsApi, 'getMyStats').mockResolvedValue({
      gamesPlayed: 0, gamesWon: 0, winRate: 0, currentStreak: 0, bestStreak: 0, rating: 1000,
    });

    render(<SettingsScreen />); // mocked user.telegramId is 111, matches

    const button = await screen.findByText('Admin statistikasi');
    fireEvent.click(button);

    expect(navigate).toHaveBeenCalledWith({ name: 'admin' });
  });
});
