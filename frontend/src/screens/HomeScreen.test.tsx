// frontend/src/screens/HomeScreen.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HomeScreen } from './HomeScreen';
import * as authContext from '../context/AuthContext';
import * as navigationContext from '../context/NavigationContext';

describe('HomeScreen', () => {
  it('renders the user first name and rating', () => {
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok',
      user: { id: 1, firstName: 'Aziz', rating: 1050 } as any,
      loading: false,
      error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'home' }, navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn(), reset: vi.fn(),
    });

    render(<HomeScreen />);

    expect(screen.getByText('Aziz')).toBeInTheDocument();
    expect(screen.getByText(/1050/)).toBeInTheDocument();
  });

  it('navigates to categorySelect with intent=quick when "Tezkor o\'yin" is clicked', () => {
    const navigate = vi.fn();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1, firstName: 'Aziz', rating: 1050 } as any, loading: false, error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'home' }, navigate, goBack: vi.fn(), replace: vi.fn(), reset: vi.fn(),
    });

    render(<HomeScreen />);
    fireEvent.click(screen.getByText("Tezkor o'yin"));

    expect(navigate).toHaveBeenCalledWith({ name: 'categorySelect', intent: 'quick' });
  });

  it('navigates to categorySelect with intent=invite when "Do\'stni chaqirish" is clicked', () => {
    const navigate = vi.fn();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1, firstName: 'Aziz', rating: 1050 } as any, loading: false, error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'home' }, navigate, goBack: vi.fn(), replace: vi.fn(), reset: vi.fn(),
    });

    render(<HomeScreen />);
    fireEvent.click(screen.getByText("Do'stni chaqirish"));

    expect(navigate).toHaveBeenCalledWith({ name: 'categorySelect', intent: 'invite' });
  });

  it('renders nothing when there is no user yet', () => {
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: null, user: null, loading: false, error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'home' }, navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn(), reset: vi.fn(),
    });

    const { container } = render(<HomeScreen />);
    expect(container).toBeEmptyDOMElement();
  });
});
