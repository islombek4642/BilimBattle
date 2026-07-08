// frontend/src/context/NavigationContext.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NavigationProvider, useNavigation } from './NavigationContext';
import * as telegram from '../telegram/webApp';

function Consumer() {
  const { current, navigate, goBack, replace, reset } = useNavigation();
  return (
    <div>
      <div>current: {current.name}</div>
      <button onClick={() => navigate({ name: 'leaderboard' })}>go-leaderboard</button>
      <button onClick={() => replace({ name: 'settings' })}>replace-settings</button>
      <button onClick={() => reset({ name: 'home' })}>reset-home</button>
      <button onClick={goBack}>back</button>
    </div>
  );
}

describe('NavigationContext', () => {
  let backButtonMock: { show: ReturnType<typeof vi.fn>; hide: ReturnType<typeof vi.fn>; onClick: ReturnType<typeof vi.fn>; offClick: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    backButtonMock = { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() };
    vi.spyOn(telegram, 'getTelegramWebApp').mockReturnValue({
      BackButton: backButtonMock,
    } as any);
  });

  it('starts on the home screen', () => {
    render(
      <NavigationProvider>
        <Consumer />
      </NavigationProvider>
    );
    expect(screen.getByText('current: home')).toBeInTheDocument();
  });

  it('navigate pushes a new screen and goBack returns to the previous one', () => {
    render(
      <NavigationProvider>
        <Consumer />
      </NavigationProvider>
    );

    fireEvent.click(screen.getByText('go-leaderboard'));
    expect(screen.getByText('current: leaderboard')).toBeInTheDocument();

    fireEvent.click(screen.getByText('back'));
    expect(screen.getByText('current: home')).toBeInTheDocument();
  });

  it('replace swaps the current screen without growing the stack', () => {
    render(
      <NavigationProvider>
        <Consumer />
      </NavigationProvider>
    );

    fireEvent.click(screen.getByText('go-leaderboard'));
    fireEvent.click(screen.getByText('replace-settings'));
    expect(screen.getByText('current: settings')).toBeInTheDocument();

    fireEvent.click(screen.getByText('back'));
    expect(screen.getByText('current: home')).toBeInTheDocument();
  });

  it('reset clears the whole stack down to a single screen', () => {
    render(
      <NavigationProvider>
        <Consumer />
      </NavigationProvider>
    );

    fireEvent.click(screen.getByText('go-leaderboard'));
    fireEvent.click(screen.getByText('reset-home'));
    fireEvent.click(screen.getByText('back'));
    expect(screen.getByText('current: home')).toBeInTheDocument();
  });

  it('shows the Telegram BackButton once the stack has more than one screen', () => {
    render(
      <NavigationProvider>
        <Consumer />
      </NavigationProvider>
    );

    expect(backButtonMock.hide).toHaveBeenCalled();

    fireEvent.click(screen.getByText('go-leaderboard'));
    expect(backButtonMock.show).toHaveBeenCalled();
  });

  it('hides the BackButton while on the battle screen even if the stack has history', () => {
    function BattleConsumer() {
      const { current, navigate } = useNavigation();
      return (
        <div>
          <div>current: {current.name}</div>
          <button onClick={() => navigate({ name: 'battle', gameId: 'g1' })}>
            go-battle
          </button>
        </div>
      );
    }

    render(
      <NavigationProvider>
        <BattleConsumer />
      </NavigationProvider>
    );

    fireEvent.click(screen.getByText('go-battle'));
    expect(backButtonMock.hide).toHaveBeenLastCalledWith();
  });
});
