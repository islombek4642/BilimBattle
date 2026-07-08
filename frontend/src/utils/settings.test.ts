// frontend/src/utils/settings.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SOUND_KEY, isSoundEnabled } from './settings';

describe('utils/settings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('defaults to enabled when no preference is stored', () => {
    expect(isSoundEnabled()).toBe(true);
  });

  it('returns false once the stored preference is explicitly "false"', () => {
    localStorage.setItem(SOUND_KEY, 'false');
    expect(isSoundEnabled()).toBe(false);
  });

  it('returns true for any stored value other than the literal string "false"', () => {
    localStorage.setItem(SOUND_KEY, 'true');
    expect(isSoundEnabled()).toBe(true);
  });

  it('defaults to enabled if localStorage throws (private mode, restricted WebView)', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    expect(isSoundEnabled()).toBe(true);

    getItemSpy.mockRestore();
  });
});
