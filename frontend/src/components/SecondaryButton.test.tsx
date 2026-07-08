// frontend/src/components/SecondaryButton.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SecondaryButton } from './SecondaryButton';

describe('SecondaryButton', () => {
  it('renders its children and responds to a click', async () => {
    const onClick = vi.fn();
    render(<SecondaryButton onClick={onClick}>Do'stni chaqirish</SecondaryButton>);

    const button = screen.getByRole('button', { name: "Do'stni chaqirish" });
    await userEvent.click(button);

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('respects the disabled prop', () => {
    render(<SecondaryButton disabled>Band</SecondaryButton>);
    expect(screen.getByRole('button', { name: 'Band' })).toBeDisabled();
  });

  it('appends a caller-provided className to the default classes', () => {
    render(<SecondaryButton className="mt-4">Test</SecondaryButton>);
    expect(screen.getByRole('button', { name: 'Test' })).toHaveClass('mt-4', 'bg-gray-200');
  });
});
