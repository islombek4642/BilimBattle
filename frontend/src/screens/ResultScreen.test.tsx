// frontend/src/screens/ResultScreen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResultScreen } from './ResultScreen';
import * as authContext from '../context/AuthContext';
import * as navigationContext from '../context/NavigationContext';
import * as telegram from '../telegram/webApp';

describe('ResultScreen', () => {
  const reset = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    reset.mockClear();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1, firstName: 'Aziz' } as any, loading: false, error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'result', scores: [], winnerId: null, forfeited: false },
      navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn(), reset,
    });
  });

  it('shows a win message and the player\'s own score when they are the winner', () => {
    render(
      <ResultScreen
        scores={[{ userId: 1, score: 550 }, { userId: 2, score: 300 }]}
        winnerId={1}
        forfeited={false}
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
      />
    );

    expect(screen.getByText(/o'yindan chiqib ketdi/)).toBeInTheDocument();
  });

  it('resets navigation to home when "Yana o\'ynash" is clicked', () => {
    render(<ResultScreen scores={[]} winnerId={null} forfeited={false} />);

    fireEvent.click(screen.getByText("Yana o'ynash"));

    expect(reset).toHaveBeenCalledWith({ name: 'home' });
  });

  it('shares the result when "Do\'stga ulashish" is clicked', () => {
    const shareSpy = vi.spyOn(telegram, 'shareInviteLink').mockImplementation(() => {});

    render(
      <ResultScreen scores={[{ userId: 1, score: 450 }]} winnerId={1} forfeited={false} />
    );
    fireEvent.click(screen.getByText("Do'stga ulashish"));

    expect(shareSpy).toHaveBeenCalledOnce();
    const [, text] = shareSpy.mock.calls[0];
    expect(text).toContain('450');
  });
});
