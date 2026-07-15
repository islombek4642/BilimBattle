import { cefrWeight, masteryRankForPoints } from '../../src/progression/masteryTiers';

describe('cefrWeight', () => {
  it('maps each CEFR tier to its increasing weight', () => {
    expect(cefrWeight('A1')).toBe(1);
    expect(cefrWeight('A2')).toBe(2);
    expect(cefrWeight('B1')).toBe(3);
    expect(cefrWeight('B2')).toBe(4);
    expect(cefrWeight('C1')).toBe(5);
    expect(cefrWeight('C2')).toBe(6);
  });

  it('defaults to the easiest weight for a missing or unknown tag', () => {
    expect(cefrWeight(null)).toBe(1);
    expect(cefrWeight(undefined)).toBe(1);
    expect(cefrWeight('unknown')).toBe(1);
  });
});

describe('masteryRankForPoints', () => {
  it('returns Boshlangich below the Orta threshold', () => {
    expect(masteryRankForPoints(0)).toBe('Boshlangich');
    expect(masteryRankForPoints(149)).toBe('Boshlangich');
  });

  it('returns each tier at its exact lower boundary', () => {
    expect(masteryRankForPoints(150)).toBe('Orta');
    expect(masteryRankForPoints(450)).toBe('Yuqori');
    expect(masteryRankForPoints(1200)).toBe('Usta');
    expect(masteryRankForPoints(3000)).toBe('Professor');
  });

  it('returns Professor for very high point totals', () => {
    expect(masteryRankForPoints(999999)).toBe('Professor');
  });
});
