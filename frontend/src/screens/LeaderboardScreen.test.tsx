// frontend/src/screens/LeaderboardScreen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LeaderboardScreen } from './LeaderboardScreen';
import * as authContext from '../context/AuthContext';
import * as leaderboardApi from '../api/leaderboard';

describe('LeaderboardScreen', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1, telegramId: 111 } as any, loading: false, error: null,
    });
  });

  it('loads and displays the global leaderboard by default', async () => {
    vi.spyOn(leaderboardApi, 'getGlobalLeaderboard').mockResolvedValue({
      leaderboard: [
        { telegramId: 111, firstName: 'Aziz', username: null, rating: 1200, gamesWon: 4 },
        { telegramId: 222, firstName: 'Vali', username: null, rating: 1100, gamesWon: 2 },
      ],
    });

    render(<LeaderboardScreen />);

    await waitFor(() => expect(screen.getByText(/Aziz/)).toBeInTheDocument());
    expect(screen.getByText(/Vali/)).toBeInTheDocument();
    expect(screen.getByText(/Sizning o'rningiz: 1/)).toBeInTheDocument();
  });

  it('switches to the friends leaderboard when the "Do\'stlar" tab is clicked', async () => {
    vi.spyOn(leaderboardApi, 'getGlobalLeaderboard').mockResolvedValue({ leaderboard: [] });
    const friendsSpy = vi.spyOn(leaderboardApi, 'getFriendsLeaderboard').mockResolvedValue({
      leaderboard: [{ telegramId: 111, firstName: 'Aziz', username: null, rating: 1200, gamesWon: 4 }],
    });

    render(<LeaderboardScreen />);
    await waitFor(() => expect(leaderboardApi.getGlobalLeaderboard).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByText("Do'stlar"));

    await waitFor(() => expect(friendsSpy).toHaveBeenCalledWith('tok'));
  });

  it('does not show a rank line when the user is not present in the fetched list', async () => {
    vi.spyOn(leaderboardApi, 'getGlobalLeaderboard').mockResolvedValue({
      leaderboard: [{ telegramId: 999, firstName: 'Other', username: null, rating: 900, gamesWon: 0 }],
    });

    render(<LeaderboardScreen />);

    await waitFor(() => expect(screen.getByText(/Other/)).toBeInTheDocument());
    expect(screen.queryByText(/Sizning o'rningiz/)).not.toBeInTheDocument();
  });
});
