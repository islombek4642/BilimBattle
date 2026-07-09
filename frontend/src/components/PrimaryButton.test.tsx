// frontend/src/components/PrimaryButton.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PrimaryButton } from './PrimaryButton';

describe('PrimaryButton', () => {
  it('renders its children and responds to a click', async () => {
    const onClick = vi.fn();
    render(<PrimaryButton onClick={onClick}>Tezkor o'yin</PrimaryButton>);

    const button = screen.getByRole('button', { name: "Tezkor o'yin" });
    await userEvent.click(button);

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('respects the disabled prop', () => {
    render(<PrimaryButton disabled>Band</PrimaryButton>);
    expect(screen.getByRole('button', { name: 'Band' })).toBeDisabled();
  });

  it('appends a caller-provided className to the default classes', () => {
    render(<PrimaryButton className="mt-4">Test</PrimaryButton>);
    expect(screen.getByRole('button', { name: 'Test' })).toHaveClass('mt-4', 'bg-ios-blue');
  });

  it('adds the shine animation when shiny is set', () => {
    render(<PrimaryButton shiny>Test</PrimaryButton>);
    expect(screen.getByRole('button', { name: 'Test' })).toHaveClass('animate-shine');
  });

  it('does not shine by default', () => {
    render(<PrimaryButton>Test</PrimaryButton>);
    expect(screen.getByRole('button', { name: 'Test' })).not.toHaveClass('animate-shine');
  });

  it('suppresses the shine animation when disabled, even if shiny is set', () => {
    render(
      <PrimaryButton shiny disabled>
        Test
      </PrimaryButton>
    );
    expect(screen.getByRole('button', { name: 'Test' })).not.toHaveClass('animate-shine');
  });
});
