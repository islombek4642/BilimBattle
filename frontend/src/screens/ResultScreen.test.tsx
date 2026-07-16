// frontend/src/screens/ResultScreen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ResultScreen, calculateStars } from './ResultScreen';
import * as authContext from '../context/AuthContext';
import * as navigationContext from '../context/NavigationContext';
import * as gameSocketContext from '../context/GameSocketContext';
import * as telegram from '../telegram/webApp';
import * as feedback from '../utils/feedback';
import * as achievementsApi from '../api/achievements';

describe('ResultScreen', () => {
  const reset = vi.fn();
  const joinLevelQueue = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    reset.mockClear();
    joinLevelQueue.mockClear();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1, firstName: 'Aziz' } as any, loading: false, error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'result', scores: [], winnerId: null, forfeited: false, knockout: false, level: 5 },
      navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn(), reset,
    });
    vi.spyOn(gameSocketContext, 'useGameSocketContext').mockReturnValue({
      joinLevelQueue,
    } as any);
    vi.spyOn(feedback, 'playResultFeedback').mockImplementation(() => {});
  });

  it('shows a win message and the player\'s own score when they are the winner', () => {
    render(
      <ResultScreen
        scores={[{ userId: 1, score: 550 }, { userId: 2, score: 300 }]}
        winnerId={1}
        forfeited={false}
        knockout={false}
        level={5}
      />
    );

    expect(screen.getByText(/G'alaba qozondingiz/)).toBeInTheDocument();
    expect(screen.getByText(/550/)).toBeInTheDocument();
  });

  it('shows a loss message when the other player won', () => {
    render(
      <ResultScreen
        scores={[{ userId: 1, score: 200 }, { userId: 2, score: 500 }]}
        winnerId={2}
        forfeited={false}
        knockout={true}
        level={5}
      />
    );

    expect(screen.getByText(/Mag'lubiyat/)).toBeInTheDocument();
  });

  it('shows a draw message when winnerId is null', () => {
    render(
      <ResultScreen
        scores={[{ userId: 1, score: 300 }, { userId: 2, score: 300 }]}
        winnerId={null}
        forfeited={false}
        knockout={false}
        level={5}
      />
    );

    expect(screen.getByText(/Durrang/)).toBeInTheDocument();
  });

  it('shows a forfeit note when the match ended by forfeit', () => {
    render(
      <ResultScreen
        scores={[{ userId: 1, score: 100 }, { userId: 2, score: 0 }]}
        winnerId={1}
        forfeited
        knockout={false}
        level={5}
      />
    );

    expect(screen.getByText(/o'yindan chiqib ketdi/)).toBeInTheDocument();
  });

  it('joins the queue and resets navigation to a fresh quick-match search when "Yana o\'ynash" is clicked', () => {
    render(<ResultScreen scores={[]} winnerId={null} forfeited={false} knockout={false} level={5} />);

    fireEvent.click(screen.getByText("Yana o'ynash"));

    expect(joinLevelQueue).toHaveBeenCalledWith(5);
    expect(reset).toHaveBeenCalledWith({ name: 'waiting', level: 5, intent: 'quick' });
  });

  it('resets navigation to home when "Bosh sahifa" is clicked, without joining a queue', () => {
    render(<ResultScreen scores={[]} winnerId={null} forfeited={false} knockout={false} level={5} />);

    fireEvent.click(screen.getByText('Bosh sahifa'));

    expect(reset).toHaveBeenCalledWith({ name: 'home' });
    expect(joinLevelQueue).not.toHaveBeenCalled();
  });

  it('shares the result when "Do\'stga ulashish" is clicked', () => {
    const shareSpy = vi.spyOn(telegram, 'shareInviteLink').mockImplementation(() => {});

    render(
      <ResultScreen
        scores={[{ userId: 1, score: 450 }]}
        winnerId={1}
        forfeited={false}
        knockout={false}
        level={5}
      />
    );
    fireEvent.click(screen.getByText("Do'stga ulashish"));

    expect(shareSpy).toHaveBeenCalledOnce();
    const [, text] = shareSpy.mock.calls[0];
    expect(text).toContain('450');
  });

  it('plays "win" result feedback when the player won', () => {
    render(
      <ResultScreen scores={[{ userId: 1, score: 550 }]} winnerId={1} forfeited={false} knockout={false} level={5} />
    );
    expect(feedback.playResultFeedback).toHaveBeenCalledWith('win');
  });

  it('plays "loss" result feedback when the other player won', () => {
    render(
      <ResultScreen scores={[{ userId: 1, score: 200 }]} winnerId={2} forfeited={false} knockout={false} level={5} />
    );
    expect(feedback.playResultFeedback).toHaveBeenCalledWith('loss');
  });

  it('plays "draw" result feedback when winnerId is null', () => {
    render(
      <ResultScreen scores={[{ userId: 1, score: 300 }]} winnerId={null} forfeited={false} knockout={false} level={5} />
    );
    expect(feedback.playResultFeedback).toHaveBeenCalledWith('draw');
  });

  it('shows 5 stars for a dominant win (opponent nearly at full HP loss)', () => {
    render(
      <ResultScreen
        scores={[{ userId: 1, score: 200 }, { userId: 2, score: 50 }]}
        winnerId={1}
        forfeited={false}
        knockout={true}
        level={5}
      />
    );

    const stars = screen.getByTestId('victory-stars').querySelectorAll('span');
    const filled = Array.from(stars).filter((s) => s.className.includes('text-ios-gold'));
    expect(filled.length).toBe(5);
  });

  it('shows fewer stars for a narrower win', () => {
    render(
      <ResultScreen
        scores={[{ userId: 1, score: 200 }, { userId: 2, score: 420 }]}
        winnerId={1}
        forfeited={false}
        knockout={false}
        level={5}
      />
    );

    const stars = screen.getByTestId('victory-stars').querySelectorAll('span');
    const filled = Array.from(stars).filter((s) => s.className.includes('text-ios-gold'));
    expect(filled.length).toBe(1);
  });

  it('does not show stars when the player lost', () => {
    render(
      <ResultScreen
        scores={[{ userId: 1, score: 200 }, { userId: 2, score: 500 }]}
        winnerId={2}
        forfeited={false}
        knockout={true}
        level={5}
      />
    );
    expect(screen.queryByTestId('victory-stars')).not.toBeInTheDocument();
  });

  it('does not show stars in a draw', () => {
    render(
      <ResultScreen
        scores={[{ userId: 1, score: 300 }, { userId: 2, score: 300 }]}
        winnerId={null}
        forfeited={false}
        knockout={false}
        level={5}
      />
    );
    expect(screen.queryByTestId('victory-stars')).not.toBeInTheDocument();
  });

  it('does not show stars when the win was by forfeit', () => {
    render(
      <ResultScreen
        scores={[{ userId: 1, score: 100 }, { userId: 2, score: 0 }]}
        winnerId={1}
        forfeited
        knockout={false}
        level={5}
      />
    );
    expect(screen.queryByTestId('victory-stars')).not.toBeInTheDocument();
  });

  it('shows a level-complete message with the correct star count when levelStars is present (level mode)', () => {
    render(
      <ResultScreen
        scores={[{ userId: 1, score: 200 }, { userId: 2, score: 150 }]}
        winnerId={1}
        forfeited={false}
        knockout={false}
        level={5}
        levelStars={2}
      />
    );

    expect(screen.getByText(/5-bosqich/)).toBeInTheDocument();
    expect(screen.getByTestId('level-stars')).toBeInTheDocument();
    const filledStars = screen.getByTestId('level-stars').querySelectorAll('.text-ios-gold');
    expect(filledStars.length).toBe(2);
    // The existing HP-margin victory-stars rating must NOT appear alongside
    // the level-mode star rating - they're different concepts and must
    // never be shown together.
    expect(screen.queryByTestId('victory-stars')).not.toBeInTheDocument();
    expect(screen.queryByText("G'alaba qozondingiz!")).not.toBeInTheDocument();
  });

  it('does not show the level-complete branch when levelStars is absent (normal battle result)', () => {
    render(
      <ResultScreen
        scores={[{ userId: 1, score: 200 }]}
        winnerId={1}
        forfeited={false}
        knockout={false}
        level={5}
      />
    );

    expect(screen.queryByTestId('level-stars')).not.toBeInTheDocument();
    expect(screen.getByText("G'alaba qozondingiz!")).toBeInTheDocument();
  });

  it('joins the level queue (not the old category queue) and resets to waiting when "Yana o\'ynash" is clicked', () => {
    render(<ResultScreen scores={[]} winnerId={null} forfeited={false} knockout={false} level={5} />);
    fireEvent.click(screen.getByText("Yana o'ynash"));
    expect(joinLevelQueue).toHaveBeenCalledWith(5);
    expect(reset).toHaveBeenCalledWith({ name: 'waiting', level: 5, intent: 'quick' });
  });

  it('shows a "Yangi nishon!" banner when a newly earned achievement is detected after the match', async () => {
    localStorage.clear();
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [{ key: 'games_1', category: 'games', label: 'Birinchi qadam', description: '...', xpReward: 50 }],
      earned: [{ key: 'games_1', earnedAt: '2026-07-14T00:00:00.000Z' }],
    });

    render(<ResultScreen scores={[]} winnerId={null} forfeited={false} knockout={false} level={5} />);

    await screen.findByText(/Yangi nishon: Birinchi qadam/);
  });

  it('shows the achievement banner in the level-complete branch too', async () => {
    localStorage.clear();
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [{ key: 'level_10', category: 'level', label: 'Bosqichlar ustasi I', description: '...', xpReward: 100 }],
      earned: [{ key: 'level_10', earnedAt: '2026-07-14T00:00:00.000Z' }],
    });

    render(<ResultScreen scores={[]} winnerId={null} forfeited={false} knockout={false} level={10} levelStars={2} />);

    await screen.findByText(/Yangi nishon: Bosqichlar ustasi I/);
  });

  it('does not show a banner when there is nothing newly earned', async () => {
    localStorage.clear();
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({ catalog: [], earned: [] });

    render(<ResultScreen scores={[]} winnerId={null} forfeited={false} knockout={false} level={5} />);

    await waitFor(() => expect(achievementsApi.getAchievements).toHaveBeenCalled());
    expect(screen.queryByText(/Yangi nishon/)).not.toBeInTheDocument();
  });

  it('does not re-show a banner for an achievement already seen on a previous visit', async () => {
    localStorage.setItem('bilimbattle:seenAchievements', JSON.stringify(['games_1']));
    vi.spyOn(achievementsApi, 'getAchievements').mockResolvedValue({
      catalog: [{ key: 'games_1', category: 'games', label: 'Birinchi qadam', description: '...', xpReward: 50 }],
      earned: [{ key: 'games_1', earnedAt: '2026-07-14T00:00:00.000Z' }],
    });

    render(<ResultScreen scores={[]} winnerId={null} forfeited={false} knockout={false} level={5} />);

    await waitFor(() => expect(achievementsApi.getAchievements).toHaveBeenCalled());
    expect(screen.queryByText(/Yangi nishon/)).not.toBeInTheDocument();
  });
});

describe('calculateStars', () => {
  it('returns 5 stars at 80% or more remaining HP', () => {
    expect(calculateStars(50)).toBe(5);
    expect(calculateStars(100)).toBe(5);
  });

  it('returns 4 stars in the 60-79% band', () => {
    expect(calculateStars(200)).toBe(4);
    expect(calculateStars(140)).toBe(4);
  });

  it('returns 3 stars in the 40-59% band', () => {
    expect(calculateStars(300)).toBe(3);
  });

  it('returns 2 stars in the 20-39% band', () => {
    expect(calculateStars(400)).toBe(2);
  });

  it('returns 1 star below 20%, including a loser score at or above 500 (0% or negative, clamped)', () => {
    expect(calculateStars(420)).toBe(1);
    expect(calculateStars(500)).toBe(1);
    expect(calculateStars(600)).toBe(1);
  });
});
