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

    expect(screen.getByText('Bosh sahifa')).toBeInTheDocument();
    expect(screen.getByText('Reyting')).toBeInTheDocument();
    expect(screen.getByText('Sozlamalar')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Reyting'));
    expect(screen.getByText('current: leaderboard')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Sozlamalar'));
    expect(screen.getByText('current: settings')).toBeInTheDocument();
  });
});
