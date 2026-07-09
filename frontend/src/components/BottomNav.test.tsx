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
    // The colored "chip" highlight lives on an inner span (sized to its own
    // content), not the outer flex-1 button (which stays full-width for a
    // large touch target) - see BottomNav.tsx's comment for why.
    const homeChip = homeTab.querySelector('span')!;
    expect(homeChip).toHaveClass('text-ios-blue');
    expect(homeChip).toHaveClass('bg-ios-blue/10');

    const leaderboardTab = screen.getByRole('button', { name: 'Reyting' });
    expect(leaderboardTab).not.toHaveAttribute('aria-current');
    const leaderboardChip = leaderboardTab.querySelector('span')!;
    expect(leaderboardChip).toHaveClass('text-ios-secondary-label');
    expect(leaderboardChip).not.toHaveClass('bg-ios-blue/10');
  });
});
