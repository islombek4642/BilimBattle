// frontend/src/screens/BattleScreen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
      current: { name: 'battle', gameId: 'g1' },
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
    render(<BattleScreen gameId="g1" />);
    expect(screen.getByText(/Keyingi savol kutilmoqda/)).toBeInTheDocument();
  });

  it('renders the question text and options', () => {
    mockSocket({
      question: { index: 0, total: 7, text: 'Poytaxt qaysi?', options: ['Toshkent', 'Samarqand'], timeLimitMs: 10000 },
    });
    render(<BattleScreen gameId="g1" />);

    expect(screen.getByText('Poytaxt qaysi?')).toBeInTheDocument();
    expect(screen.getByText('Toshkent')).toBeInTheDocument();
    expect(screen.getByText('Samarqand')).toBeInTheDocument();
  });

  it('submits the selected answer and disables further selection', () => {
    mockSocket({
      question: { index: 2, total: 7, text: 'Q?', options: ['A', 'B'], timeLimitMs: 10000 },
    });
    render(<BattleScreen gameId="g1" />);

    fireEvent.click(screen.getByRole('button', { name: 'A' }));

    expect(submitAnswer).toHaveBeenCalledWith('g1', 2, 0);
    expect(screen.getByRole('button', { name: 'A' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'B' })).toBeDisabled();
  });

  it('ignores a second click after an answer has already been selected', () => {
    mockSocket({
      question: { index: 0, total: 7, text: 'Q?', options: ['A', 'B'], timeLimitMs: 10000 },
    });
    render(<BattleScreen gameId="g1" />);

    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: 'B' }));

    expect(submitAnswer).toHaveBeenCalledOnce();
  });

  it('highlights the correct answer once questionResult arrives for the current question', () => {
    mockSocket({
      question: { index: 0, total: 7, text: 'Q?', options: ['A', 'B'], timeLimitMs: 10000 },
      questionResult: { index: 0, correctIndex: 1, scores: [] },
    });
    render(<BattleScreen gameId="g1" />);

    expect(screen.getByRole('button', { name: 'B' })).toHaveClass('bg-ios-green');
  });

  it('navigates to the result screen (via replace) when gameOver arrives', async () => {
    mockSocket({
      gameOver: { scores: [{ userId: 1, score: 400 }], winnerId: 1, forfeited: false },
    });
    render(<BattleScreen gameId="g1" />);

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({
        name: 'result', scores: [{ userId: 1, score: 400 }], winnerId: 1, forfeited: false,
      })
    );
    expect(clearGameOver).toHaveBeenCalledOnce();
  });

  it('calls reconnectGame when the socket is connected', () => {
    mockSocket();
    render(<BattleScreen gameId="g1" />);
    expect(reconnectGame).toHaveBeenCalledWith('g1');
  });

  it('plays select feedback when an option is tapped', () => {
    mockSocket({
      question: { index: 0, total: 7, text: 'Q?', options: ['A', 'B'], timeLimitMs: 10000 },
    });
    render(<BattleScreen gameId="g1" />);

    fireEvent.click(screen.getByRole('button', { name: 'A' }));

    expect(feedback.playSelectFeedback).toHaveBeenCalledOnce();
  });

  it('plays correct feedback when the chosen option matches the revealed correct answer', () => {
    mockSocket({
      question: { index: 0, total: 7, text: 'Q?', options: ['A', 'B'], timeLimitMs: 10000 },
    });
    const { rerender } = render(<BattleScreen gameId="g1" />);

    fireEvent.click(screen.getByRole('button', { name: 'A' }));

    mockSocket({
      question: { index: 0, total: 7, text: 'Q?', options: ['A', 'B'], timeLimitMs: 10000 },
      questionResult: { index: 0, correctIndex: 0, scores: [] },
    });
    rerender(<BattleScreen gameId="g1" />);

    expect(feedback.playCorrectFeedback).toHaveBeenCalledOnce();
    expect(feedback.playIncorrectFeedback).not.toHaveBeenCalled();
  });

  it('plays incorrect feedback when the chosen option does not match the revealed correct answer', () => {
    mockSocket({
      question: { index: 0, total: 7, text: 'Q?', options: ['A', 'B'], timeLimitMs: 10000 },
    });
    const { rerender } = render(<BattleScreen gameId="g1" />);

    fireEvent.click(screen.getByRole('button', { name: 'A' }));

    mockSocket({
      question: { index: 0, total: 7, text: 'Q?', options: ['A', 'B'], timeLimitMs: 10000 },
      questionResult: { index: 0, correctIndex: 1, scores: [] },
    });
    rerender(<BattleScreen gameId="g1" />);

    expect(feedback.playIncorrectFeedback).toHaveBeenCalledOnce();
    expect(feedback.playCorrectFeedback).not.toHaveBeenCalled();
  });

  it('renders the opponent name from context inside the header', () => {
    mockSocket({
      question: { index: 0, total: 7, text: 'Q?', options: ['A', 'B'], timeLimitMs: 10000 },
      opponent: { telegramId: 222, firstName: 'Vali' },
    });
    render(<BattleScreen gameId="g1" />);

    expect(screen.getByText('Vali')).toBeInTheDocument();
  });

  it('clears opponent on unmount', () => {
    mockSocket({
      question: { index: 0, total: 7, text: 'Q?', options: ['A', 'B'], timeLimitMs: 10000 },
    });
    const { unmount } = render(<BattleScreen gameId="g1" />);

    unmount();

    expect(clearOpponent).toHaveBeenCalledOnce();
  });
});
