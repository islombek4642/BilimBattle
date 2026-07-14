import { isLevelUnlocked, findNextLevelToPlay } from './levelUnlock';

describe('isLevelUnlocked', () => {
  it('level 1 is always unlocked', () => {
    expect(isLevelUnlocked(1, new Map())).toBe(true);
  });

  it('a non-stage-boundary level unlocks once the previous level has at least 2 stars', () => {
    expect(isLevelUnlocked(4, new Map([[3, 2]]))).toBe(true);
    expect(isLevelUnlocked(4, new Map([[3, 1]]))).toBe(false);
    expect(isLevelUnlocked(4, new Map())).toBe(false);
  });

  it("the first level of a new stage requires >=25 total stars across the previous stage's 10 levels", () => {
    const notEnough = new Map<number, number>();
    for (let i = 1; i <= 10; i += 1) notEnough.set(i, 2); // 20 total
    expect(isLevelUnlocked(11, notEnough)).toBe(false);

    const enough = new Map<number, number>();
    for (let i = 1; i <= 9; i += 1) enough.set(i, 3); // 27
    expect(isLevelUnlocked(11, enough)).toBe(true);
  });
});

describe('findNextLevelToPlay', () => {
  it('returns level 1 for a brand new user with zero progress', () => {
    expect(findNextLevelToPlay(5, new Map())).toBe(1);
  });

  it('returns the first unlocked level with fewer than 3 stars', () => {
    const progress = new Map([[1, 3], [2, 3], [3, 2]]);
    expect(findNextLevelToPlay(5, progress)).toBe(3);
  });

  it('skips a fully-starred level and returns the next one', () => {
    const progress = new Map([[1, 3]]);
    expect(findNextLevelToPlay(5, progress)).toBe(2);
  });

  it('returns null when every level up to maxAvailableLevel already has 3 stars', () => {
    const progress = new Map([[1, 3], [2, 3]]);
    expect(findNextLevelToPlay(2, progress)).toBe(null);
  });

  it('returns null when maxAvailableLevel is 0 (progress not loaded yet)', () => {
    expect(findNextLevelToPlay(0, new Map())).toBe(null);
  });
});
