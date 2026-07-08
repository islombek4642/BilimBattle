// frontend/src/screens/CategorySelectScreen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CategorySelectScreen } from './CategorySelectScreen';
import * as questionsApi from '../api/questions';
import * as navigationContext from '../context/NavigationContext';
import * as gameSocketContext from '../context/GameSocketContext';

describe('CategorySelectScreen', () => {
  const navigate = vi.fn();
  const joinQueue = vi.fn();
  const createInvite = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    navigate.mockClear();
    joinQueue.mockClear();
    createInvite.mockClear();

    vi.spyOn(questionsApi, 'getCategories').mockResolvedValue({
      categories: [
        { key: 'umumiy_bilim', label: 'Umumiy bilim' },
        { key: 'sport_kino_musiqa', label: 'Sport/Kino/Musiqa' },
      ],
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'categorySelect', intent: 'quick' },
      navigate, goBack: vi.fn(), replace: vi.fn(), reset: vi.fn(),
    });
    vi.spyOn(gameSocketContext, 'useGameSocketContext').mockReturnValue({
      joinQueue, createInvite,
    } as any);
  });

  it('fetches and renders the categories', async () => {
    render(<CategorySelectScreen intent="quick" />);

    await waitFor(() => expect(screen.getByText('Umumiy bilim')).toBeInTheDocument());
    expect(screen.getByText('Sport/Kino/Musiqa')).toBeInTheDocument();
  });

  it('calls joinQueue and navigates to waiting when intent is quick', async () => {
    render(<CategorySelectScreen intent="quick" />);

    await waitFor(() => screen.getByText('Umumiy bilim'));
    fireEvent.click(screen.getByText('Umumiy bilim'));

    expect(joinQueue).toHaveBeenCalledWith('umumiy_bilim');
    expect(createInvite).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ name: 'waiting', category: 'umumiy_bilim', intent: 'quick' });
  });

  it('calls createInvite and navigates to waiting when intent is invite', async () => {
    render(<CategorySelectScreen intent="invite" />);

    await waitFor(() => screen.getByText('Umumiy bilim'));
    fireEvent.click(screen.getByText('Umumiy bilim'));

    expect(createInvite).toHaveBeenCalledWith('umumiy_bilim');
    expect(joinQueue).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ name: 'waiting', category: 'umumiy_bilim', intent: 'invite' });
  });
});
