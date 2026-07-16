// frontend/src/screens/AchievementsScreen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AchievementsScreen } from './AchievementsScreen';
import * as authContext from '../context/AuthContext';
import * as achievementsApi from '../api/achievements';

describe('AchievementsScreen', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1 } as any, loading: false, error: null,
    });
  });

  it('shows a loading state, then renders catalog entries once loaded', async () => {
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [{ key: 'games_1', category: 'games', label: 'Birinchi qadam', description: "1 ta o'yin o'ynang", xpReward: 50 }],
      earned: [],
    });

    render(<AchievementsScreen />);
    expect(screen.getByText(/Yuklanmoqda/)).toBeInTheDocument();

    await screen.findByText('Birinchi qadam');
  });

  it('shows an earned achievement as unlocked and an unearned one as locked', async () => {
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [
        { key: 'games_1', category: 'games', label: 'Birinchi qadam', description: "1 ta o'yin o'ynang", xpReward: 50 },
        { key: 'games_10', category: 'games', label: "Faol o'yinchi", description: "10 ta o'yin o'ynang", xpReward: 100 },
      ],
      earned: [{ key: 'games_1', earnedAt: '2026-07-14T00:00:00.000Z' }],
    });

    render(<AchievementsScreen />);
    await screen.findByText('Birinchi qadam');

    const earnedCard = screen.getByText('Birinchi qadam').closest('div');
    const lockedCard = screen.getByText("Faol o'yinchi").closest('div');
    expect(earnedCard).not.toHaveClass('opacity-50');
    expect(lockedCard).toHaveClass('opacity-50');
  });

  it('groups achievements by category with a visible category heading', async () => {
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [
        { key: 'games_1', category: 'games', label: 'Birinchi qadam', description: '...', xpReward: 50 },
        { key: 'streak_3', category: 'streak', label: 'Olov', description: '...', xpReward: 50 },
      ],
      earned: [],
    });

    render(<AchievementsScreen />);
    await screen.findByText('Faollik');
    expect(screen.getAllByText('Olov').length).toBeGreaterThan(0);
  });

  it('shows the XP reward on each achievement card', async () => {
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [
        { key: 'games_1', category: 'games', label: 'Birinchi qadam', description: "1 ta o'yin o'ynang", xpReward: 50 },
      ],
      earned: [],
    });

    render(<AchievementsScreen />);
    await screen.findByText('Birinchi qadam');

    expect(screen.getByText('+50 XP')).toBeInTheDocument();
  });

  it('shows an error message if loading fails', async () => {
    vi.spyOn(achievementsApi, 'getAchievements').mockRejectedValue(new Error('network'));

    render(<AchievementsScreen />);
    await waitFor(() => expect(screen.getByText(/yuklab bo'lmadi/i)).toBeInTheDocument());
  });
});
