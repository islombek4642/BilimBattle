// frontend/src/components/BattleHeader.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { BattleHeader } from './BattleHeader';
import * as authContext from '../context/AuthContext';

describe('BattleHeader', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1, telegramId: 111, firstName: 'Aziz' } as any, loading: false, error: null,
    });
  });

  it('shows my name and the opponent name', () => {
    render(
      <BattleHeader
        scores={[{ userId: 1, score: 0 }, { userId: 2, score: 0 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={0}
        totalQuestions={7}
      />
    );

    expect(screen.getByText('Aziz')).toBeInTheDocument();
    expect(screen.getByText('Vali')).toBeInTheDocument();
  });

  it('shows a fallback label when opponent is not yet known', () => {
    render(<BattleHeader scores={[]} opponent={null} questionIndex={0} totalQuestions={7} />);
    expect(screen.getByText('Raqib')).toBeInTheDocument();
  });

  it('shows the 1-based question number out of the total', () => {
    render(
      <BattleHeader
        scores={[]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={4}
        totalQuestions={7}
      />
    );

    // questionIndex is 0-based (4 = the 5th question) - displayed as "5/7".
    expect(screen.getByText('5/7')).toBeInTheDocument();
  });

  it('splits the bar 50/50 when scores are tied', () => {
    render(
      <BattleHeader
        scores={[{ userId: 1, score: 300 }, { userId: 2, score: 300 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={0}
        totalQuestions={7}
      />
    );

    expect(screen.getByTestId('tugofwar-blue')).toHaveStyle({ width: '50%' });
    expect(screen.getByTestId('tugofwar-red')).toHaveStyle({ width: '50%' });
  });

  it('shifts the bar toward me when I am ahead', () => {
    render(
      <BattleHeader
        scores={[{ userId: 1, score: 500 }, { userId: 2, score: 250 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={0}
        totalQuestions={7}
      />
    );

    // (500-250)/500*50 = 25 -> 50+25 = 75%
    expect(screen.getByTestId('tugofwar-blue')).toHaveStyle({ width: '75%' });
    expect(screen.getByTestId('tugofwar-red')).toHaveStyle({ width: '25%' });
  });

  it('clamps the bar at 100%/0% for a very large lead', () => {
    render(
      <BattleHeader
        scores={[{ userId: 1, score: 2000 }, { userId: 2, score: 0 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={0}
        totalQuestions={7}
      />
    );

    expect(screen.getByTestId('tugofwar-blue')).toHaveStyle({ width: '100%' });
    expect(screen.getByTestId('tugofwar-red')).toHaveStyle({ width: '0%' });
  });

  it('clamps the bar at 0%/100% for a very large deficit', () => {
    render(
      <BattleHeader
        scores={[{ userId: 1, score: 0 }, { userId: 2, score: 2000 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={0}
        totalQuestions={7}
      />
    );

    expect(screen.getByTestId('tugofwar-blue')).toHaveStyle({ width: '0%' });
    expect(screen.getByTestId('tugofwar-red')).toHaveStyle({ width: '100%' });
  });

  it('shows a damage number on the opponent side when my score increases (I land a hit)', () => {
    const { rerender } = render(
      <BattleHeader
        scores={[{ userId: 1, score: 0 }, { userId: 2, score: 0 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={0}
        totalQuestions={7}
      />
    );

    rerender(
      <BattleHeader
        scores={[{ userId: 1, score: 200 }, { userId: 2, score: 0 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={1}
        totalQuestions={7}
      />
    );

    expect(screen.getByTestId('damage-opponent')).toHaveTextContent('-200');
    expect(screen.queryByTestId('damage-me')).not.toBeInTheDocument();
  });

  it('shows a damage number on my side when the opponent lands a hit on me', () => {
    const { rerender } = render(
      <BattleHeader
        scores={[{ userId: 1, score: 0 }, { userId: 2, score: 0 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={0}
        totalQuestions={7}
      />
    );

    rerender(
      <BattleHeader
        scores={[{ userId: 1, score: 0 }, { userId: 2, score: 150 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={1}
        totalQuestions={7}
      />
    );

    expect(screen.getByTestId('damage-me')).toHaveTextContent('-150');
    expect(screen.queryByTestId('damage-opponent')).not.toBeInTheDocument();
  });

  it('shows both damage numbers when both players score in the same round', () => {
    const { rerender } = render(
      <BattleHeader
        scores={[{ userId: 1, score: 0 }, { userId: 2, score: 0 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={0}
        totalQuestions={7}
      />
    );

    rerender(
      <BattleHeader
        scores={[{ userId: 1, score: 180 }, { userId: 2, score: 120 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={1}
        totalQuestions={7}
      />
    );

    expect(screen.getByTestId('damage-opponent')).toHaveTextContent('-180');
    expect(screen.getByTestId('damage-me')).toHaveTextContent('-120');
  });

  it('does not show a damage number when the score is unchanged from the previous render', () => {
    const { rerender } = render(
      <BattleHeader
        scores={[{ userId: 1, score: 200 }, { userId: 2, score: 0 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={0}
        totalQuestions={7}
      />
    );

    rerender(
      <BattleHeader
        scores={[{ userId: 1, score: 200 }, { userId: 2, score: 0 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={0}
        totalQuestions={7}
      />
    );

    expect(screen.queryByTestId('damage-opponent')).not.toBeInTheDocument();
    expect(screen.queryByTestId('damage-me')).not.toBeInTheDocument();
  });

  it('clears the damage number after it has been shown for a moment', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(
        <BattleHeader
          scores={[{ userId: 1, score: 0 }, { userId: 2, score: 0 }]}
          opponent={{ telegramId: 222, firstName: 'Vali' }}
          questionIndex={0}
          totalQuestions={7}
        />
      );

      rerender(
        <BattleHeader
          scores={[{ userId: 1, score: 200 }, { userId: 2, score: 0 }]}
          opponent={{ telegramId: 222, firstName: 'Vali' }}
          questionIndex={1}
          totalQuestions={7}
        />
      );
      expect(screen.getByTestId('damage-opponent')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(800);
      });

      expect(screen.queryByTestId('damage-opponent')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies a shake animation only when a hit exceeds the shake threshold', () => {
    const { rerender, container } = render(
      <BattleHeader
        scores={[{ userId: 1, score: 0 }, { userId: 2, score: 0 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={0}
        totalQuestions={7}
      />
    );

    rerender(
      <BattleHeader
        scores={[{ userId: 1, score: 100 }, { userId: 2, score: 0 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={1}
        totalQuestions={7}
      />
    );
    expect(container.querySelector('.animate-battle-shake')).not.toBeInTheDocument();

    rerender(
      <BattleHeader
        scores={[{ userId: 1, score: 300 }, { userId: 2, score: 0 }]}
        opponent={{ telegramId: 222, firstName: 'Vali' }}
        questionIndex={2}
        totalQuestions={7}
      />
    );
    expect(container.querySelector('.animate-battle-shake')).toBeInTheDocument();
  });
});
