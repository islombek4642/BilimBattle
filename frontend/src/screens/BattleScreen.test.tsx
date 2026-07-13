// frontend/src/screens/BattleScreen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { BattleScreen } from './BattleScreen';
import * as navigationContext from '../context/NavigationContext';
import * as gameSocketContext from '../context/GameSocketContext';
import * as authContext from '../context/AuthContext';
import * as feedback from '../utils/feedback';

describe('BattleScreen', () => {
  const replace = vi.fn();
  const submitAnswer = vi.fn();
  const clearGameOver = vi.fn();
  const clearQuestionResult = vi.fn();
  const clearQuestion = vi.fn();
  const clearOpponent = vi.fn();
  const reconnectGame = vi.fn().mockResolvedValue({ found: true });

  function mockSocket(overrides: Record<string, unknown> = {}) {
    vi.spyOn(gameSocketContext, 'useGameSocketContext').mockReturnValue({
      question: null,
      questionResult: null,
      gameOver: null,
      connected: true,
      opponent: null,
      submitAnswer,
      clearGameOver,
      clearQuestionResult,
      clearQuestion,
      clearOpponent,
      reconnectGame,
      ...overrides,
    } as any);
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    replace.mockClear();
    submitAnswer.mockClear();
    clearGameOver.mockClear();
    clearQuestionResult.mockClear();
    clearQuestion.mockClear();
    clearOpponent.mockClear();
    reconnectGame.mockClear().mockResolvedValue({ found: true });

    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'battle', gameId: 'g1', level: 5 },
      navigate: vi.fn(), goBack: vi.fn(), replace, reset: vi.fn(),
    });
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1 } as any, loading: false, error: null,
    });
    vi.spyOn(feedback, 'playSelectFeedback').mockImplementation(() => {});
    vi.spyOn(feedback, 'playCorrectFeedback').mockImplementation(() => {});
    vi.spyOn(feedback, 'playIncorrectFeedback').mockImplementation(() => {});
  });

  it('shows a waiting message when no question has arrived yet', () => {
    mockSocket();
    render(<BattleScreen gameId="g1" level={5} />);
    expect(screen.getByText(/Keyingi savol kutilmoqda/)).toBeInTheDocument();
  });

  it('renders the question text and options', () => {
    mockSocket({
      question: { index: 0, total: 7, text: 'Poytaxt qaysi?', options: ['Toshkent', 'Samarqand'], timeLimitMs: 10000 },
    });
    render(<BattleScreen gameId="g1" level={5} />);

    expect(screen.getByText('Poytaxt qaysi?')).toBeInTheDocument();
    expect(screen.getByText('Toshkent')).toBeInTheDocument();
    expect(screen.getByText('Samarqand')).toBeInTheDocument();
  });

  it('shrinks the option text for long dictionary-style definitions, but keeps short answers at normal size', () => {
    const longDefinition =
      'Rheological is an adjective relating to rheology, which is the study of the flow of matter, particularly in a liquid state, but also as soft solids or solids under conditions in which they respond with plastic flow rather than deforming elastically.';
    mockSocket({
      question: {
        index: 0,
        total: 7,
        text: 'Rheological',
        options: ['Toshkent', longDefinition],
        timeLimitMs: 10000,
      },
    });
    render(<BattleScreen gameId="g1" level={5} />);

    expect(screen.getByText('Toshkent').className).toContain('text-base');
    expect(screen.getByText(longDefinition).className).toContain('text-xs');
  });

  it('submits the selected answer and disables further selection', () => {
    mockSocket({
      question: { index: 2, total: 7, text: 'Q?', options: ['A', 'B'], timeLimitMs: 10000 },
    });
    render(<BattleScreen gameId="g1" level={5} />);

    fireEvent.click(screen.getByRole('button', { name: 'A' }));

    expect(submitAnswer).toHaveBeenCalledWith('g1', 2, 0);
    expect(screen.getByRole('button', { name: 'A' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'B' })).toBeDisabled();
  });

  it('ignores a second click after an answer has already been selected', () => {
    mockSocket({
      question: { index: 0, total: 7, text: 'Q?', options: ['A', 'B'], timeLimitMs: 10000 },
    });
    render(<BattleScreen gameId="g1" level={5} />);

    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: 'B' }));

    expect(submitAnswer).toHaveBeenCalledOnce();
  });

  it('highlights the correct answer once questionResult arrives for the current question', () => {
    mockSocket({
      question: { index: 0, total: 7, text: 'Q?', options: ['A', 'B'], timeLimitMs: 10000 },
      questionResult: { index: 0, correctIndex: 1, scores: [] },
    });
    render(<BattleScreen gameId="g1" level={5} />);

    expect(screen.getByRole('button', { name: 'B' })).toHaveClass('bg-ios-green');
  });

  it('navigates to the result screen (via replace) when gameOver arrives', async () => {
    mockSocket({
      gameOver: { scores: [{ userId: 1, score: 400 }], winnerId: 1, forfeited: false },
    });
    render(<BattleScreen gameId="g1" level={5} />);

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({
        name: 'result', scores: [{ userId: 1, score: 400 }], winnerId: 1, forfeited: false, knockout: false, level: 5, levelStars: undefined,
      })
    );
    expect(clearGameOver).toHaveBeenCalledOnce();
  });

  it('shows a "K.O.!" overlay before navigating to the result screen when the match ends by knockout', async () => {
    vi.useFakeTimers();
    try {
      mockSocket({
        gameOver: {
          scores: [{ userId: 1, score: 500 }, { userId: 2, score: 200 }],
          winnerId: 1,
          forfeited: false,
          knockout: true,
        },
      });
      render(<BattleScreen gameId="g1" level={5} />);

      expect(screen.getByText('K.O.!')).toBeInTheDocument();
      expect(replace).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(1200);
      });

      expect(replace).toHaveBeenCalledWith({
        name: 'result',
        scores: [{ userId: 1, score: 500 }, { userId: 2, score: 200 }],
        winnerId: 1,
        forfeited: false,
        knockout: true,
        level: 5,
        levelStars: undefined,
      });
      expect(clearGameOver).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('calls reconnectGame when the socket is connected', () => {
    mockSocket();
    render(<BattleScreen gameId="g1" level={5} />);
    expect(reconnectGame).toHaveBeenCalledWith('g1');
  });

  it('plays select feedback when an option is tapped', () => {
    mockSocket({
      question: { index: 0, total: 7, text: 'Q?', options: ['A', 'B'], timeLimitMs: 10000 },
    });
    render(<BattleScreen gameId="g1" level={5} />);

    fireEvent.click(screen.getByRole('button', { name: 'A' }));

    expect(feedback.playSelectFeedback).toHaveBeenCalledOnce();
  });

  it('plays correct feedback when the chosen option matches the revealed correct answer', () => {
    mockSocket({
      question: { index: 0, total: 7, text: 'Q?', options: ['A', 'B'], timeLimitMs: 10000 },
    });
    const { rerender } = render(<BattleScreen gameId="g1" level={5} />);

    fireEvent.click(screen.getByRole('button', { name: 'A' }));

    mockSocket({
      question: { index: 0, total: 7, text: 'Q?', options: ['A', 'B'], timeLimitMs: 10000 },
      questionResult: { index: 0, correctIndex: 0, scores: [] },
    });
    rerender(<BattleScreen gameId="g1" level={5} />);

    expect(feedback.playCorrectFeedback).toHaveBeenCalledOnce();
    expect(feedback.playIncorrectFeedback).not.toHaveBeenCalled();
  });

  it('plays incorrect feedback when the chosen option does not match the revealed correct answer', () => {
    mockSocket({
      question: { index: 0, total: 7, text: 'Q?', options: ['A', 'B'], timeLimitMs: 10000 },
    });
    const { rerender } = render(<BattleScreen gameId="g1" level={5} />);

    fireEvent.click(screen.getByRole('button', { name: 'A' }));

    mockSocket({
      question: { index: 0, total: 7, text: 'Q?', options: ['A', 'B'], timeLimitMs: 10000 },
      questionResult: { index: 0, correctIndex: 1, scores: [] },
    });
    rerender(<BattleScreen gameId="g1" level={5} />);

    expect(feedback.playIncorrectFeedback).toHaveBeenCalledOnce();
    expect(feedback.playCorrectFeedback).not.toHaveBeenCalled();
  });

  it('renders the opponent name from context inside the header', () => {
    mockSocket({
      question: { index: 0, total: 7, text: 'Q?', options: ['A', 'B'], timeLimitMs: 10000 },
      opponent: { telegramId: 222, firstName: 'Vali' },
    });
    render(<BattleScreen gameId="g1" level={5} />);

    expect(screen.getByText('Vali')).toBeInTheDocument();
  });

  it('keeps showing the latest real scores in the header after questionResult resets to null for the next question', () => {
    // Regression test: restoredScores previously only ever got ONE snapshot
    // (from the reconnect ack, taken near the very start of the match) and
    // was never updated again. useGameSocket resets questionResult to null
    // the instant the next `question` event arrives, so for the whole time
    // a question is being answered, the header fell back to that stale
    // near-zero snapshot instead of the actual running score - the
    // tug-of-war bar looked permanently stuck near 50/50 except for a brief
    // flash right after each question resolved.
    mockSocket({
      question: { index: 0, total: 7, text: 'Q1?', options: ['A', 'B'], timeLimitMs: 10000 },
    });
    const { rerender } = render(<BattleScreen gameId="g1" level={5} />);

    // Question 0 resolves with a real, lopsided score.
    mockSocket({
      question: { index: 0, total: 7, text: 'Q1?', options: ['A', 'B'], timeLimitMs: 10000 },
      questionResult: { index: 0, correctIndex: 0, scores: [{ userId: 1, score: 300 }, { userId: 2, score: 0 }] },
    });
    rerender(<BattleScreen gameId="g1" level={5} />);
    expect(screen.getByTestId('tugofwar-blue')).toHaveStyle({ width: '80%' });

    // Question 1 starts - questionResult resets to null (useGameSocket's
    // real behavior), the way it would just before the next question is
    // answered. The header must keep reflecting the 300-0 score, not revert
    // to a 0-0 tie.
    mockSocket({
      question: { index: 1, total: 7, text: 'Q2?', options: ['A', 'B'], timeLimitMs: 10000 },
      questionResult: null,
    });
    rerender(<BattleScreen gameId="g1" level={5} />);

    expect(screen.getByTestId('tugofwar-blue')).toHaveStyle({ width: '80%' });
  });

  it('shows a "see more definitions" toggle when the resolved question has extraDefinitions', () => {
    mockSocket({
      question: { index: 0, total: 7, text: 'Negative', options: ['a', 'b', 'c', 'd'], timeLimitMs: 10000 },
      questionResult: { index: 0, correctIndex: 0, scores: [], extraDefinitions: ['A pessimistic attitude.', 'An underexposed photo image.'] },
    });
    render(<BattleScreen gameId="g1" level={5} />);

    expect(screen.queryByText('A pessimistic attitude.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Yana ko'rsatish"));
    expect(screen.getByText('A pessimistic attitude.')).toBeInTheDocument();
    expect(screen.getByText('An underexposed photo image.')).toBeInTheDocument();
  });

  it('does not show the "see more definitions" toggle for a category with no extraDefinitions', () => {
    mockSocket({
      question: { index: 0, total: 7, text: 'Poytaxt qaysi?', options: ['Toshkent', 'Samarqand'], timeLimitMs: 10000 },
      questionResult: { index: 0, correctIndex: 0, scores: [] },
    });
    render(<BattleScreen gameId="g1" level={5} />);

    expect(screen.queryByText("Yana ko'rsatish")).not.toBeInTheDocument();
  });

  it('collapses the "see more definitions" toggle back to its default closed state when the next question arrives', () => {
    mockSocket({
      question: { index: 0, total: 7, text: 'Negative', options: ['a', 'b', 'c', 'd'], timeLimitMs: 10000 },
      questionResult: { index: 0, correctIndex: 0, scores: [], extraDefinitions: ['A pessimistic attitude.', 'An underexposed photo image.'] },
    });
    const { rerender } = render(<BattleScreen gameId="g1" level={5} />);

    fireEvent.click(screen.getByText("Yana ko'rsatish"));
    expect(screen.getByText('A pessimistic attitude.')).toBeInTheDocument();

    // A new question arrives (higher index) with its own fresh questionResult
    // that ALSO has extraDefinitions - this proves the toggle collapses back
    // to closed because of the question change itself, not merely because
    // "this question happens to have no extraDefinitions".
    mockSocket({
      question: { index: 1, total: 7, text: 'Optimistic', options: ['e', 'f', 'g', 'h'], timeLimitMs: 10000 },
      questionResult: { index: 1, correctIndex: 1, scores: [], extraDefinitions: ['Hopeful about the future.'] },
    });
    rerender(<BattleScreen gameId="g1" level={5} />);

    expect(screen.queryByText('A pessimistic attitude.')).not.toBeInTheDocument();
    expect(screen.queryByText('Hopeful about the future.')).not.toBeInTheDocument();
    expect(screen.getByText("Yana ko'rsatish")).toBeInTheDocument();
    expect(screen.queryByText('Yashirish')).not.toBeInTheDocument();
  });

  it('clears opponent on unmount', () => {
    mockSocket({
      question: { index: 0, total: 7, text: 'Q?', options: ['A', 'B'], timeLimitMs: 10000 },
    });
    const { unmount } = render(<BattleScreen gameId="g1" level={5} />);

    unmount();

    expect(clearOpponent).toHaveBeenCalledOnce();
  });
});
