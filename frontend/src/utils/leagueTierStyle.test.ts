import { describe, it, expect } from 'vitest';
import { leagueTierBorderClass } from './leagueTierStyle';

describe('leagueTierBorderClass', () => {
  it('returns the correct border class for each league tier', () => {
    expect(leagueTierBorderClass('Bronza')).toBe('border-ios-bronze');
    expect(leagueTierBorderClass('Kumush')).toBe('border-ios-silver');
    expect(leagueTierBorderClass('Oltin')).toBe('border-ios-gold');
    expect(leagueTierBorderClass('Platina')).toBe('border-league-platinum');
    expect(leagueTierBorderClass('Olmos')).toBe('border-league-diamond');
    expect(leagueTierBorderClass('Usta')).toBe('border-league-master');
    expect(leagueTierBorderClass('Chempion')).toBe('border-ios-gold shadow-[0_0_12px_rgba(255,192,46,0.6)]');
  });
});
