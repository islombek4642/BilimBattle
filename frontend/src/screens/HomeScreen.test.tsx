// frontend/src/screens/HomeScreen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HomeScreen } from './HomeScreen';
import * as authContext from '../context/AuthContext';
import * as navigationContext from '../context/NavigationContext';

describe('HomeScreen', () => {
  const navigate = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    navigate.mockClear();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1, firstName: 'Aziz' } as any, loading: false, error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'home' },
      navigate, goBack: vi.fn(), replace: vi.fn(), reset: vi.fn(),
    });
  });

  it('renders nothing while the user is not yet loaded', () => {
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: null, user: null, loading: false, error: null,
    });
    const { container } = render(<HomeScreen />);
    expect(container).toBeEmptyDOMElement();
  });

  it('navigates to levelSelect with intent quick when "Tezkor o\'yin" is clicked', () => {
    render(<HomeScreen />);
    fireEvent.click(screen.getByText("Tezkor o'yin"));
    expect(navigate).toHaveBeenCalledWith({ name: 'levelSelect', intent: 'quick' });
  });

  it('navigates to levelSelect with intent invite when "Do\'stni chaqirish" is clicked', () => {
    render(<HomeScreen />);
    fireEvent.click(screen.getByText("Do'stni chaqirish"));
    expect(navigate).toHaveBeenCalledWith({ name: 'levelSelect', intent: 'invite' });
  });
});
