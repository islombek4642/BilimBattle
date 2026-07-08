// frontend/src/components/ScoreBar.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScoreBar } from './ScoreBar';
import * as authContext from '../context/AuthContext';

describe('ScoreBar', () => {
  it('shows "Siz" for the score entry matching the logged-in user and "Raqib" for the other', () => {
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1 } as any, loading: false, error: null,
    });

    render(
      <ScoreBar
        scores={[
          { userId: 1, score: 450 },
          { userId: 2, score: 300 },
        ]}
      />
    );

    expect(screen.getByText(/Siz: 450/)).toBeInTheDocument();
    expect(screen.getByText(/Raqib: 300/)).toBeInTheDocument();
  });

  it('renders zeros when scores is empty', () => {
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1 } as any, loading: false, error: null,
    });

    render(<ScoreBar scores={[]} />);

    expect(screen.getByText(/Siz: 0/)).toBeInTheDocument();
    expect(screen.getByText(/Raqib: 0/)).toBeInTheDocument();
  });
});
