import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MasteryBadge } from './MasteryBadge';

describe('MasteryBadge', () => {
  it('renders the Uzbek label for each mastery rank', () => {
    const { rerender } = render(<MasteryBadge rank="Boshlangich" />);
    expect(screen.getByText("Boshlang'ich")).toBeInTheDocument();

    rerender(<MasteryBadge rank="Professor" />);
    expect(screen.getByText('Professor')).toBeInTheDocument();
  });
});
