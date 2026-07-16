// frontend/src/screens/HomeScreen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HomeScreen } from './HomeScreen';
import * as authContext from '../context/AuthContext';
import * as navigationContext from '../context/NavigationContext';
import * as gameSocketContext from '../context/GameSocketContext';
import * as statsApi from '../api/stats';
import * as achievementsApi from '../api/achievements';
import * as levelProgressApi from '../api/levelProgress';
import * as leaderboardApi from '../api/leaderboard';
import * as profileApi from '../api/profile';
import * as leagueApi from '../api/league';

describe('HomeScreen', () => {
  const navigate = vi.fn();
  const joinLevelQueue = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    navigate.mockClear();
    joinLevelQueue.mockClear();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1, telegramId: 555, firstName: 'Aziz' } as any, loading: false, error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'home' },
      navigate, goBack: vi.fn(), replace: vi.fn(), reset: vi.fn(),
    });
    vi.spyOn(gameSocketContext, 'useGameSocketContext').mockReturnValue({
      joinLevelQueue,
    } as any);
    vi.spyOn(statsApi, 'getMyStats').mockResolvedValue({
      gamesPlayed: 5, gamesWon: 3, winRate: 60, currentStreak: 2, bestStreak: 4, rating: 1100,
    });
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({ catalog: [], earned: [] });
    vi.spyOn(levelProgressApi, 'getLevelProgress').mockResolvedValue({
      progress: [], maxAvailableLevel: 0, tierBoundaries: [],
    });
    vi.spyOn(leaderboardApi, 'getGlobalLeaderboard').mockResolvedValue({ leaderboard: [] });
    vi.spyOn(profileApi, 'getProfile').mockResolvedValue({
      xp: 0, masteryPoints: 0, masteryRank: 'Boshlangich', category: 'ingliz_tili',
      dailyQuests: [], streak: { current: 0, best: 0, freezeAvailable: true },
    });
    vi.spyOn(leagueApi, 'getMyLeague').mockResolvedValue({
      tier: 'Bronza', weeklyXp: 0, bracket: [],
    });
  });

  it('renders nothing while the user is not yet loaded', () => {
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: null, user: null, loading: false, error: null,
    });
    const { container } = render(<HomeScreen />);
    expect(container).toBeEmptyDOMElement();
  });

  it('navigates to levelSelect with intent quick when "Tezkor o\'yin" is clicked', () => {
    render(<HomeScreen />);
    fireEvent.click(screen.getByText("Tezkor o'yin"));
    expect(navigate).toHaveBeenCalledWith({ name: 'levelSelect', intent: 'quick' });
  });

  it('navigates to levelSelect with intent invite when "Do\'stni chaqirish" is clicked', () => {
    render(<HomeScreen />);
    fireEvent.click(screen.getByText("Do'stni chaqirish"));
    expect(navigate).toHaveBeenCalledWith({ name: 'levelSelect', intent: 'invite' });
  });

  it('shows the current streak and rating once stats load', async () => {
    render(<HomeScreen />);
    await screen.findByText('2'); // currentStreak
    expect(screen.getByText('1100')).toBeInTheDocument(); // rating
  });

  it('shows the league-tier avatar border and mastery title once profile and league load', async () => {
    vi.spyOn(profileApi, 'getProfile').mockResolvedValue({
      xp: 0, masteryPoints: 0, masteryRank: 'Usta', category: 'ingliz_tili',
      dailyQuests: [], streak: { current: 0, best: 0, freezeAvailable: true },
    });
    vi.spyOn(leagueApi, 'getMyLeague').mockResolvedValue({
      tier: 'Oltin', weeklyXp: 0, bracket: [],
    });

    render(<HomeScreen />);

    await screen.findByText('Usta');
    expect(screen.getByAltText('Foydalanuvchi rasmi')).toHaveClass('border-ios-gold');
  });

  it('shows a badge row with recently earned achievements and navigates to the achievements screen when clicked', async () => {
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [{ key: 'games_1', category: 'games', label: 'Birinchi qadam', description: "1 ta o'yin o'ynang", xpReward: 50 }],
      earned: [{ key: 'games_1', earnedAt: '2026-07-14T00:00:00.000Z' }],
    });

    render(<HomeScreen />);
    await screen.findByText('Birinchi qadam');
    fireEvent.click(screen.getByText('Birinchi qadam'));
    expect(navigate).toHaveBeenCalledWith({ name: 'achievements' });
  });

  it('does not show the achievements badge row when nothing is earned yet', async () => {
    render(<HomeScreen />);
    await screen.findByText('2'); // wait for the stats-driven render to settle
    expect(screen.queryByText('Hammasi')).not.toBeInTheDocument();
  });

  it('shows a "Davom etish" shortcut that immediately joins the queue and starts the shown level', async () => {
    vi.spyOn(levelProgressApi, 'getLevelProgress').mockResolvedValue({
      progress: [{ levelNumber: 1, stars: 3 }], maxAvailableLevel: 5, tierBoundaries: [],
    });

    render(<HomeScreen />);
    await screen.findByText('Davom etish: 2-bosqich');
    fireEvent.click(screen.getByText('Davom etish: 2-bosqich'));
    expect(joinLevelQueue).toHaveBeenCalledWith(2);
    expect(navigate).toHaveBeenCalledWith({ name: 'waiting', level: 2, intent: 'quick' });
  });

  it('does not show the continue shortcut when there is no progress data yet', async () => {
    render(<HomeScreen />);
    await screen.findByText('2');
    expect(screen.queryByText(/Davom etish/)).not.toBeInTheDocument();
  });

  it('shows a top-3 leaderboard preview and navigates to the full leaderboard when clicked', async () => {
    vi.spyOn(leaderboardApi, 'getGlobalLeaderboard').mockResolvedValue({
      leaderboard: [
        { telegramId: 1, firstName: 'Vali', username: null, rating: 2000, gamesWon: 10 },
        { telegramId: 2, firstName: 'Nodira', username: null, rating: 1800, gamesWon: 8 },
        { telegramId: 3, firstName: 'Sardor', username: null, rating: 1600, gamesWon: 6 },
      ],
    });

    render(<HomeScreen />);
    await screen.findByText('Top reyting');
    expect(screen.getByText('Vali')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Top reyting'));
    expect(navigate).toHaveBeenCalledWith({ name: 'leaderboard' });
  });

  it("shows the player's own rank separately when they're outside the top 3", async () => {
    vi.spyOn(leaderboardApi, 'getGlobalLeaderboard').mockResolvedValue({
      leaderboard: [
        { telegramId: 1, firstName: 'Vali', username: null, rating: 2000, gamesWon: 10 },
        { telegramId: 2, firstName: 'Nodira', username: null, rating: 1800, gamesWon: 8 },
        { telegramId: 3, firstName: 'Sardor', username: null, rating: 1600, gamesWon: 6 },
        { telegramId: 555, firstName: 'Aziz', username: null, rating: 1100, gamesWon: 3 },
      ],
    });

    render(<HomeScreen />);
    await screen.findByText('Top reyting');
    // "Aziz" (telegramId 555, rank 4) is outside the top 3 podium, so should
    // appear exactly once, in the separate own-rank row.
    expect(screen.getAllByText('Aziz').length).toBe(1);
  });

  it('does not show the leaderboard preview when the leaderboard is empty', async () => {
    render(<HomeScreen />);
    await screen.findByText('2');
    expect(screen.queryByText('Top reyting')).not.toBeInTheDocument();
  });

  it('shows the league tier next to the leaderboard preview heading once loaded', async () => {
    vi.spyOn(leaderboardApi, 'getGlobalLeaderboard').mockResolvedValue({
      leaderboard: [{ telegramId: 1, firstName: 'Vali', username: null, rating: 2000, gamesWon: 10 }],
    });
    vi.spyOn(leagueApi, 'getMyLeague').mockResolvedValue({
      tier: 'Oltin', weeklyXp: 120, bracket: [],
    });

    render(<HomeScreen />);

    await screen.findByText('Top reyting');
    expect(screen.getByText(/Oltin ligasi/)).toBeInTheDocument();
  });

  it('shows the Daily Quest card with progress and the daily activity streak once the profile loads', async () => {
    vi.spyOn(profileApi, 'getProfile').mockResolvedValue({
      xp: 120, masteryPoints: 40, masteryRank: 'Boshlangich', category: 'ingliz_tili',
      dailyQuests: [
        { key: 'matches_3', label: "Bugun 3 ta jang o'ynang", progress: 1, target: 3, completed: false },
      ],
      streak: { current: 5, best: 9, freezeAvailable: true },
    });

    render(<HomeScreen />);

    await screen.findByText("Bugun 3 ta jang o'ynang");
    expect(screen.getByText('1/3')).toBeInTheDocument();
    expect(screen.getByText(/Kunlik faollik: 5 kun/)).toBeInTheDocument();
  });
});
