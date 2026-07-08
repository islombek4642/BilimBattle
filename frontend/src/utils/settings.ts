// frontend/src/utils/settings.ts
// Shared source of truth for the "Ovoz/Vibratsiya" preference (SettingsScreen
// writes it, utils/feedback.ts reads it) - kept in one place so both sides
// can never drift onto different localStorage keys.
export const SOUND_KEY = 'bilimbattle:soundEnabled';

export function isSoundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'false';
  } catch {
    return true;
  }
}
