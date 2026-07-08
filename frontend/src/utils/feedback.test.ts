// frontend/src/utils/feedback.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as telegram from '../telegram/webApp';
import * as settings from './settings';
import { playSelectFeedback, playCorrectFeedback, playIncorrectFeedback, playResultFeedback } from './feedback';

function createFakeAudioContext() {
  const oscillator = {
    type: 'sine',
    frequency: { value: 0, setValueAtTime: vi.fn() },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const gain = {
    gain: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  };
  const ctx = {
    currentTime: 0,
    destination: {},
    createOscillator: vi.fn(() => oscillator),
    createGain: vi.fn(() => gain),
  };
  return { ctx, oscillator, gain };
}

describe('utils/feedback', () => {
  let fakeAudioCtor: ReturnType<typeof vi.fn>;
  let lastFake: ReturnType<typeof createFakeAudioContext>;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(settings, 'isSoundEnabled').mockReturnValue(true);
    vi.spyOn(telegram, 'hapticImpact').mockImplementation(() => {});
    vi.spyOn(telegram, 'hapticNotification').mockImplementation(() => {});

    // Must be a regular function, not an arrow function - arrow functions
    // have no [[Construct]] internal method and can never be called with
    // `new`, which is exactly how playTone() uses this constructor.
    fakeAudioCtor = vi.fn(function FakeAudioContext() {
      lastFake = createFakeAudioContext();
      return lastFake.ctx;
    });
    vi.stubGlobal('AudioContext', fakeAudioCtor);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('playSelectFeedback triggers a light haptic impact and does not play a tone', () => {
    playSelectFeedback();

    expect(telegram.hapticImpact).toHaveBeenCalledWith('light');
    expect(fakeAudioCtor).not.toHaveBeenCalled();
  });

  it('playCorrectFeedback triggers a success haptic notification and plays a tone when sound is enabled', () => {
    playCorrectFeedback();

    expect(telegram.hapticNotification).toHaveBeenCalledWith('success');
    expect(fakeAudioCtor).toHaveBeenCalledOnce();
    expect(lastFake.oscillator.start).toHaveBeenCalledOnce();
  });

  it('playIncorrectFeedback triggers an error haptic notification and plays a tone when sound is enabled', () => {
    playIncorrectFeedback();

    expect(telegram.hapticNotification).toHaveBeenCalledWith('error');
    expect(fakeAudioCtor).toHaveBeenCalledOnce();
    expect(lastFake.oscillator.start).toHaveBeenCalledOnce();
  });

  it('playResultFeedback("win") triggers a success haptic and plays a tone', () => {
    playResultFeedback('win');
    expect(telegram.hapticNotification).toHaveBeenCalledWith('success');
    expect(fakeAudioCtor).toHaveBeenCalledOnce();
  });

  it('playResultFeedback("loss") triggers an error haptic and plays a tone', () => {
    playResultFeedback('loss');
    expect(telegram.hapticNotification).toHaveBeenCalledWith('error');
    expect(fakeAudioCtor).toHaveBeenCalledOnce();
  });

  it('playResultFeedback("draw") triggers a warning haptic and plays a tone', () => {
    playResultFeedback('draw');
    expect(telegram.hapticNotification).toHaveBeenCalledWith('warning');
    expect(fakeAudioCtor).toHaveBeenCalledOnce();
  });

  it('triggers neither haptics nor a tone when the combined "Ovoz/Vibratsiya" setting is disabled', () => {
    // The Settings screen exposes exactly one toggle covering both sound and
    // vibration - disabling it must silence both, not just the tone.
    vi.spyOn(settings, 'isSoundEnabled').mockReturnValue(false);

    playCorrectFeedback();

    expect(telegram.hapticNotification).not.toHaveBeenCalled();
    expect(fakeAudioCtor).not.toHaveBeenCalled();
  });

  it('does not trigger a haptic when the setting is disabled, even for the tone-less select feedback', () => {
    vi.spyOn(settings, 'isSoundEnabled').mockReturnValue(false);

    playSelectFeedback();

    expect(telegram.hapticImpact).not.toHaveBeenCalled();
  });

  it('does not throw when AudioContext is unavailable in this environment', () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);

    expect(() => playCorrectFeedback()).not.toThrow();
  });
});
