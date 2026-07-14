// frontend/src/utils/achievementSeen.ts
// Shared source of truth for which achievement keys this device has already
// shown a "yangi nishon!" reveal for - mirrors utils/settings.ts's SOUND_KEY
// pattern (one exported key, try/catch around localStorage access since
// it's unavailable in some private-mode/restricted WebView contexts).
const SEEN_KEY = 'bilimbattle:seenAchievements';

function readSeenKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

// Given the full set of currently-earned achievement keys, returns which
// ones this device has never shown a reveal for, and marks all of
// `earnedKeys` as seen for next time - a single combined read-diff-write,
// so callers can't forget the "mark as seen" step by only calling a
// separate query function.
export function findAndMarkNewlySeenAchievements(earnedKeys: string[]): string[] {
  const seen = readSeenKeys();
  const newlySeen = earnedKeys.filter((key) => !seen.has(key));
  if (newlySeen.length === 0) return [];
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, ...newlySeen]));
  } catch {
    // Storage unavailable - the reveal still shows this once, just might
    // repeat on a future visit; not worth surfacing an error over.
  }
  return newlySeen;
}
