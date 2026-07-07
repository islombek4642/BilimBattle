import { describe, it, expect } from 'vitest';
import { msToSeconds } from './time';

describe('utils/time', () => {
  it('rounds up to the nearest whole second', () => {
    expect(msToSeconds(10000)).toBe(10);
    expect(msToSeconds(9001)).toBe(10);
    expect(msToSeconds(9000)).toBe(9);
  });

  it('never returns a negative number', () => {
    expect(msToSeconds(-500)).toBe(0);
  });

  it('returns 0 for exactly 0ms', () => {
    expect(msToSeconds(0)).toBe(0);
  });
});
