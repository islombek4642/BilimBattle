import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProfileScreen } from './ProfileScreen';
import * as authContext from '../context/AuthContext';
import * as navigationContext from '../context/NavigationContext';
import * as profileApi from '../api/profile';
import * as statsApi from '../api/stats';
import * as achievementsApi from '../api/achievements';

describe('ProfileScreen', () => {
  const navigate = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    navigate.mockClear();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1, telegramId: 555, firstName: 'Aziz' } as any, loading: false, error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'profile' },
      navigate, goBack: vi.fn(), replace: vi.fn(), reset: vi.fn(),
    });
    vi.spyOn(profileApi, 'getProfile').mockResolvedValue({
      xp: 340,
      masteryPoints: 90,
      masteryRank: 'Boshlangich',
      category: 'ingliz_tili',
      dailyQuests: [],
      streak: { current: 4, best: 9, freezeAvailable: true },
    });
    vi.spyOn(statsApi, 'getMyStats').mockResolvedValue({
      gamesPlayed: 12, gamesWon: 7, winRate: 58, currentStreak: 2, bestStreak: 5, rating: 1120,
    });
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({ catalog: [], earned: [] });
  });

  it('renders nothing while the user is not yet loaded', () => {
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: null, user: null, loading: false, error: null,
    });
    const { container } = render(<ProfileScreen />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the user's XP, mastery rank and daily streak once the profile loads", async () => {
    render(<ProfileScreen />);
    await screen.findByText('340');
    expect(screen.getByText("Boshlang'ich")).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it("shows the user's overall stats once loaded", async () => {
    render(<ProfileScreen />);
    await screen.findByText('1120');
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('shows recently earned achievements and navigates to the full list when clicked', async () => {
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [{ key: 'games_1', category: 'games', label: 'Birinchi qadam', description: "1 ta o'yin o'ynang", xpReward: 50 }],
      earned: [{ key: 'games_1', earnedAt: '2026-07-14T00:00:00.000Z' }],
    });

    render(<ProfileScreen />);
    await screen.findByText('Birinchi qadam');
    fireEvent.click(screen.getByText("Barcha yutuqlarni ko'rish"));
    expect(navigate).toHaveBeenCalledWith({ name: 'achievements' });
  });

  it('shows an error message when the profile fetch fails', async () => {
    vi.spyOn(profileApi, 'getProfile').mockRejectedValue(new Error('network down'));

    render(<ProfileScreen />);

    await waitFor(() => expect(screen.getByText("Progressni yuklab bo'lmadi.")).toBeInTheDocument());
  });
});
