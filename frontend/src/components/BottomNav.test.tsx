// frontend/src/components/BottomNav.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NavigationProvider, useNavigation } from '../context/NavigationContext';
import { BottomNav } from './BottomNav';

function CurrentScreenLabel() {
  const { current } = useNavigation();
  return <div>current: {current.name}</div>;
}

describe('BottomNav', () => {
  it('renders three tabs and navigates (via reset) when clicked', () => {
    render(
      <NavigationProvider>
        <CurrentScreenLabel />
        <BottomNav />
      </NavigationProvider>
    );

    expect(screen.getByRole('button', { name: 'Bosh sahifa' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reyting' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sozlamalar' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reyting' }));
    expect(screen.getByText('current: leaderboard')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sozlamalar' }));
    expect(screen.getByText('current: settings')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Bosh sahifa' }));
    expect(screen.getByText('current: home')).toBeInTheDocument();
  });

  it('marks the active tab with aria-current and distinct styling', () => {
    render(
      <NavigationProvider>
        <BottomNav />
      </NavigationProvider>
    );

    const homeTab = screen.getByRole('button', { name: 'Bosh sahifa' });
    expect(homeTab).toHaveAttribute('aria-current', 'page');
    expect(homeTab).toHaveClass('text-ios-blue');

    const leaderboardTab = screen.getByRole('button', { name: 'Reyting' });
    expect(leaderboardTab).not.toHaveAttribute('aria-current');
    expect(leaderboardTab).toHaveClass('text-ios-secondary-label');
  });
});
