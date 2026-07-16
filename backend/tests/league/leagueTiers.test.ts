import { LEAGUE_TIERS, computeTierChanges } from '../../src/league/leagueTiers';

describe('LEAGUE_TIERS', () => {
  it('has the 7 tiers in ascending order', () => {
    expect(LEAGUE_TIERS).toEqual(['Bronza', 'Kumush', 'Oltin', 'Platina', 'Olmos', 'Usta', 'Chempion']);
  });
});

describe('computeTierChanges', () => {
  it('promotes the top ~20% and relegates the bottom ~20% of a mid-tier bracket', () => {
    const members = Array.from({ length: 10 }, (_, i) => ({ userId: i + 1, weeklyXp: (10 - i) * 100 }));
    const changes = computeTierChanges('Oltin', members);

    // Top 2 (userId 1, 2 - highest XP) promoted to Platina.
    expect(changes).toContainEqual({ userId: 1, newTier: 'Platina' });
    expect(changes).toContainEqual({ userId: 2, newTier: 'Platina' });
    // Bottom 2 (userId 9, 10 - lowest XP) relegated to Kumush.
    expect(changes).toContainEqual({ userId: 9, newTier: 'Kumush' });
    expect(changes).toContainEqual({ userId: 10, newTier: 'Kumush' });
    // Everyone else (userId 3-8) has no change.
    expect(changes.length).toBe(4);
  });

  it('never relegates out of Bronza, the lowest tier', () => {
    const members = Array.from({ length: 10 }, (_, i) => ({ userId: i + 1, weeklyXp: (10 - i) * 100 }));
    const changes = computeTierChanges('Bronza', members);

    // No relegation targets exist below Bronza.
    expect(changes.every((c) => c.newTier !== undefined)).toBe(true);
    expect(changes.some((c) => c.userId === 9 || c.userId === 10)).toBe(false);
    // Promotion to Kumush still applies to the top performers.
    expect(changes).toContainEqual({ userId: 1, newTier: 'Kumush' });
    expect(changes).toContainEqual({ userId: 2, newTier: 'Kumush' });
  });

  it('never promotes past Chempion, the highest tier', () => {
    const members = Array.from({ length: 10 }, (_, i) => ({ userId: i + 1, weeklyXp: (10 - i) * 100 }));
    const changes = computeTierChanges('Chempion', members);

    expect(changes.some((c) => c.userId === 1 || c.userId === 2)).toBe(false);
    // Relegation to Usta still applies to the bottom performers.
    expect(changes).toContainEqual({ userId: 9, newTier: 'Usta' });
    expect(changes).toContainEqual({ userId: 10, newTier: 'Usta' });
  });

  it('returns no changes for an empty bracket', () => {
    expect(computeTierChanges('Oltin', [])).toEqual([]);
  });

  it('returns no changes for a bracket too small for any 20% band to round up to at least 1', () => {
    const members = [
      { userId: 1, weeklyXp: 300 },
      { userId: 2, weeklyXp: 200 },
      { userId: 3, weeklyXp: 100 },
    ];
    expect(computeTierChanges('Oltin', members)).toEqual([]);
  });
});
