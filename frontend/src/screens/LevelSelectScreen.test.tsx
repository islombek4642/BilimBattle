// frontend/src/screens/LevelSelectScreen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LevelSelectScreen } from './LevelSelectScreen';
import * as authContext from '../context/AuthContext';
import * as navigationContext from '../context/NavigationContext';
import * as gameSocketContext from '../context/GameSocketContext';
import * as levelProgressApi from '../api/levelProgress';
import * as profileApi from '../api/profile';

describe('LevelSelectScreen', () => {
  const navigate = vi.fn();
  const joinLevelQueue = vi.fn();
  const createLevelInvite = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    navigate.mockClear();
    joinLevelQueue.mockClear();
    createLevelInvite.mockClear();

    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1 } as any, loading: false, error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'levelSelect', intent: 'quick' },
      navigate, goBack: vi.fn(), replace: vi.fn(), reset: vi.fn(),
    });
    vi.spyOn(gameSocketContext, 'useGameSocketContext').mockReturnValue({
      joinLevelQueue, createLevelInvite,
    } as any);
    vi.spyOn(profileApi, 'getProfile').mockResolvedValue({
      xp: 0, masteryPoints: 0, masteryRank: 'Boshlangich', category: 'ingliz_tili',
      dailyQuests: [], streak: { current: 0, best: 0, freezeAvailable: true },
    });
  });

  it('shows a loading state, then renders level cards once progress loads', async () => {
    vi.spyOn(levelProgressApi, 'getLevelProgress').mockResolvedValue({
      progress: [{ levelNumber: 1, stars: 3 }],
      maxAvailableLevel: 5,
      tierBoundaries: [],
    });

    render(<LevelSelectScreen intent="quick" />);
    expect(screen.getByText(/Yuklanmoqda/)).toBeInTheDocument();

    await screen.findByText('1');
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('level 1 is always clickable even with zero progress', async () => {
    vi.spyOn(levelProgressApi, 'getLevelProgress').mockResolvedValue({
      progress: [],
      maxAvailableLevel: 3,
      tierBoundaries: [],
    });

    render(<LevelSelectScreen intent="quick" />);
    const level1Button = await screen.findByRole('button', { name: /1/ });
    expect(level1Button).not.toBeDisabled();
  });

  it('a level beyond an unearned unlock threshold is locked (disabled)', async () => {
    vi.spyOn(levelProgressApi, 'getLevelProgress').mockResolvedValue({
      progress: [{ levelNumber: 1, stars: 1 }], // only 1 star - level 2 needs >=2
      maxAvailableLevel: 5,
      tierBoundaries: [],
    });

    render(<LevelSelectScreen intent="quick" />);
    const level2Button = await screen.findByRole('button', { name: /2/ });
    expect(level2Button).toBeDisabled();
  });

  it('clicking an unlocked level in quick mode joins the level queue and navigates to waiting', async () => {
    vi.spyOn(levelProgressApi, 'getLevelProgress').mockResolvedValue({
      progress: [],
      maxAvailableLevel: 3,
      tierBoundaries: [],
    });

    render(<LevelSelectScreen intent="quick" />);
    const level1Button = await screen.findByRole('button', { name: /1/ });
    fireEvent.click(level1Button);

    expect(joinLevelQueue).toHaveBeenCalledWith(1);
    expect(navigate).toHaveBeenCalledWith({ name: 'waiting', level: 1, intent: 'quick' });
  });

  it('clicking an unlocked level in invite mode creates a level invite and navigates to waiting', async () => {
    vi.spyOn(levelProgressApi, 'getLevelProgress').mockResolvedValue({
      progress: [],
      maxAvailableLevel: 3,
      tierBoundaries: [],
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'levelSelect', intent: 'invite' },
      navigate, goBack: vi.fn(), replace: vi.fn(), reset: vi.fn(),
    });

    render(<LevelSelectScreen intent="invite" />);
    const level1Button = await screen.findByRole('button', { name: /1/ });
    fireEvent.click(level1Button);

    expect(createLevelInvite).toHaveBeenCalledWith(1);
    expect(navigate).toHaveBeenCalledWith({ name: 'waiting', level: 1, intent: 'invite' });
  });

  it('shows an error message if progress fails to load', async () => {
    vi.spyOn(levelProgressApi, 'getLevelProgress').mockRejectedValue(new Error('network'));

    render(<LevelSelectScreen intent="quick" />);
    await waitFor(() => expect(screen.getByText(/yuklab bo'lmadi/i)).toBeInTheDocument());
  });

  it('shows the CEFR tier badge on each level card, based on tierBoundaries', async () => {
    vi.spyOn(levelProgressApi, 'getLevelProgress').mockResolvedValue({
      progress: [],
      maxAvailableLevel: 3,
      tierBoundaries: [{ tier: 'A1', fromLevel: 1, toLevel: 2 }, { tier: 'A2', fromLevel: 3, toLevel: 3 }],
    });

    render(<LevelSelectScreen intent="quick" />);
    await screen.findByText('1');

    // Anchored to start: the tier badge text ("A1") itself contains the digit
    // "1", so an unanchored /1/ would also match level 2's button ("2 A1").
    const level1Button = screen.getByRole('button', { name: /^1/ });
    const level3Button = screen.getByRole('button', { name: /^3/ });
    expect(level1Button).toHaveTextContent('A1');
    expect(level3Button).toHaveTextContent('A2');
  });

  it("shows the user's Mastery badge next to the heading once the profile loads", async () => {
    vi.spyOn(levelProgressApi, 'getLevelProgress').mockResolvedValue({
      progress: [], maxAvailableLevel: 3, tierBoundaries: [],
    });
    vi.spyOn(profileApi, 'getProfile').mockResolvedValue({
      xp: 500, masteryPoints: 200, masteryRank: 'Orta', category: 'ingliz_tili',
      dailyQuests: [], streak: { current: 3, best: 3, freezeAvailable: true },
    });

    render(<LevelSelectScreen intent="quick" />);

    await screen.findByText("O'rta");
  });
});
