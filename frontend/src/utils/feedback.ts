// frontend/src/utils/feedback.ts
// Wires the "Ovoz/Vibratsiya" (Sound/Vibration) setting to real feedback:
// Telegram's native haptics (free, no assets needed, works even with the
// device's ringer silenced) plus a couple of short tones synthesized via the
// Web Audio API - no external audio files to source, license, or ship.
import { hapticImpact, hapticNotification } from '../telegram/webApp';
import { isSoundEnabled } from './settings';

function playTone(frequencyHz: number, durationMs: number): void {
  const AudioContextCtor = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!AudioContextCtor) return;

  const ctx = new AudioContextCtor();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequencyHz, ctx.currentTime);

  // Quick fade in/out envelope so the tone doesn't click at the start/end -
  // a bare on/off square-wave-like gain step is audibly harsh at these
  // durations.
  const durationSec = durationMs / 1000;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationSec);

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + durationSec);
}

// The Settings screen exposes ONE combined toggle labeled "Ovoz/Vibratsiya"
// (Sound/Vibration) - so turning it off must silence BOTH the tones AND the
// haptics, not just the tones. Every function below checks isSoundEnabled()
// once, up front, and returns early (no haptic, no tone) when disabled.

export function playSelectFeedback(): void {
  if (!isSoundEnabled()) return;
  hapticImpact('light');
}

export function playCorrectFeedback(): void {
  if (!isSoundEnabled()) return;
  hapticNotification('success');
  playTone(880, 150);
}

export function playIncorrectFeedback(): void {
  if (!isSoundEnabled()) return;
  hapticNotification('error');
  playTone(220, 200);
}

export function playResultFeedback(outcome: 'win' | 'loss' | 'draw'): void {
  if (!isSoundEnabled()) return;
  const hapticType = outcome === 'win' ? 'success' : outcome === 'loss' ? 'error' : 'warning';
  hapticNotification(hapticType);
  if (outcome === 'win') playTone(660, 300);
  else if (outcome === 'loss') playTone(180, 300);
  else playTone(440, 200);
}
