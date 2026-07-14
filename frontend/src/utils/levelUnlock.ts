// frontend/src/utils/levelUnlock.ts
// Mirrors backend/src/game/levelProgress.ts's isLevelUnlocked exactly - kept
// in sync manually (no shared package between frontend/backend in this
// project). Extracted out of LevelSelectScreen.tsx (which now imports
// isLevelUnlocked from here) so HomeScreen's "Davom etish" shortcut can
// reuse the identical logic instead of a third independent copy.
export const LEVELS_PER_STAGE = 10;
export const STAGE_UNLOCK_STARS_REQUIRED = 25;
export const LEVEL_UNLOCK_STARS_REQUIRED = 2;
export const MAX_STARS_PER_LEVEL = 3;

export function isLevelUnlocked(level: number, progressByLevel: Map<number, number>): boolean {
  if (level === 1) return true;
  const isFirstOfStage = (level - 1) % LEVELS_PER_STAGE === 0;
  if (isFirstOfStage) {
    const stageStart = level - LEVELS_PER_STAGE;
    let totalStars = 0;
    for (let i = stageStart; i < level; i += 1) {
      totalStars += progressByLevel.get(i) ?? 0;
    }
    return totalStars >= STAGE_UNLOCK_STARS_REQUIRED;
  }
  return (progressByLevel.get(level - 1) ?? 0) >= LEVEL_UNLOCK_STARS_REQUIRED;
}

// The lowest-numbered level that's unlocked but not yet perfected (3
// stars) - i.e. "the next thing worth doing". Scans upward from 1, since
// the unlock rule is inherently sequential (level N's unlock depends on
// level N-1 or the stage total), so the first candidate that's both
// unlocked and non-perfect is always genuinely playable right now, not
// just numerically first. Returns null if every level up to
// maxAvailableLevel is already 3-starred, or if maxAvailableLevel is 0
// (progress hasn't loaded yet).
export function findNextLevelToPlay(maxAvailableLevel: number, progressByLevel: Map<number, number>): number | null {
  for (let level = 1; level <= maxAvailableLevel; level += 1) {
    const stars = progressByLevel.get(level) ?? 0;
    if (stars < MAX_STARS_PER_LEVEL && isLevelUnlocked(level, progressByLevel)) {
      return level;
    }
  }
  return null;
}
