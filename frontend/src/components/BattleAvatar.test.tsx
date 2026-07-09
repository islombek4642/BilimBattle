// frontend/src/components/BattleAvatar.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BattleAvatar } from './BattleAvatar';
import * as client from '../api/client';

describe('BattleAvatar', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders an img pointed at the avatar URL when a telegramId is given', () => {
    vi.spyOn(client, 'getAvatarUrl').mockReturnValue('https://api.example.com/users/123/avatar');

    render(<BattleAvatar telegramId={123} />);

    const img = screen.getByAltText('Foydalanuvchi rasmi') as HTMLImageElement;
    expect(img.src).toBe('https://api.example.com/users/123/avatar');
  });

  it('falls back to a generic icon when the image fails to load', () => {
    vi.spyOn(client, 'getAvatarUrl').mockReturnValue('https://api.example.com/users/123/avatar');

    render(<BattleAvatar telegramId={123} />);

    const img = screen.getByAltText('Foydalanuvchi rasmi');
    fireEvent.error(img);

    expect(screen.queryByAltText('Foydalanuvchi rasmi')).not.toBeInTheDocument();
    expect(screen.getByTestId('battle-avatar-fallback')).toBeInTheDocument();
  });

  it('shows the generic icon immediately when telegramId is null (no fetch attempted)', () => {
    const spy = vi.spyOn(client, 'getAvatarUrl');

    render(<BattleAvatar telegramId={null} />);

    expect(screen.getByTestId('battle-avatar-fallback')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('applies the given border color class', () => {
    vi.spyOn(client, 'getAvatarUrl').mockReturnValue('https://api.example.com/users/123/avatar');

    render(<BattleAvatar telegramId={123} borderColorClass="border-ios-blue" />);

    expect(screen.getByAltText('Foydalanuvchi rasmi')).toHaveClass('border-ios-blue');
  });
});
