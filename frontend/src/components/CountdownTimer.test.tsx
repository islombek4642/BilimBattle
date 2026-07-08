// frontend/src/components/CountdownTimer.test.tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { CountdownTimer } from './CountdownTimer';

describe('CountdownTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the full duration in seconds immediately on mount', () => {
    render(<CountdownTimer timeLimitMs={10000} />);
    expect(screen.getByTestId('countdown-timer')).toHaveTextContent('10s');
  });

  it('counts down as time passes', () => {
    render(<CountdownTimer timeLimitMs={10000} />);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByTestId('countdown-timer')).toHaveTextContent('7s');
  });

  it('never displays a negative number once the limit is exceeded', () => {
    render(<CountdownTimer timeLimitMs={1000} />);

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByTestId('countdown-timer')).toHaveTextContent('0s');
  });

  it('resets when timeLimitMs changes (a new question starts)', () => {
    const { rerender } = render(<CountdownTimer key="q0" timeLimitMs={10000} />);

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.getByTestId('countdown-timer')).toHaveTextContent('2s');

    rerender(<CountdownTimer key="q1" timeLimitMs={10000} />);
    expect(screen.getByTestId('countdown-timer')).toHaveTextContent('10s');
  });
});
