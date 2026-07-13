// frontend/src/screens/LevelSelectScreen.tsx
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import { useGameSocketContext } from '../context/GameSocketContext';
import { getLevelProgress, LevelProgressEntry } from '../api/levelProgress';

const LEVELS_PER_STAGE = 10;
const STAGE_UNLOCK_STARS_REQUIRED = 25;
const LEVEL_UNLOCK_STARS_REQUIRED = 2;

// Mirrors backend/src/game/levelProgress.ts's isLevelUnlocked exactly - kept
// in sync manually (no shared package between frontend/backend in this
// project).
function isLevelUnlocked(level: number, progressByLevel: Map<number, number>): boolean {
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

export function LevelSelectScreen({ intent }: { intent: 'quick' | 'invite' }) {
  const { token } = useAuth();
  const { navigate } = useNavigation();
  const { joinLevelQueue, createLevelInvite } = useGameSocketContext();
  const [progress, setProgress] = useState<LevelProgressEntry[]>([]);
  const [maxAvailableLevel, setMaxAvailableLevel] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setError(false);

    getLevelProgress(token)
      .then((res) => {
        if (cancelled) return;
        setProgress(res.progress);
        setMaxAvailableLevel(res.maxAvailableLevel);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const progressByLevel = new Map(progress.map((p) => [p.levelNumber, p.stars]));

  const handleSelect = (level: number) => {
    if (intent === 'quick') {
      joinLevelQueue(level);
    } else {
      createLevelInvite(level);
    }
    navigate({ name: 'waiting', level, intent });
  };

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center p-6 text-center text-ios-secondary-label">
        Yuklanmoqda...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-full items-center justify-center p-6 text-center text-ios-red">
        Bosqichlarni yuklab bo'lmadi.
      </div>
    );
  }

  const levels = Array.from({ length: maxAvailableLevel }, (_, i) => i + 1);
  const stages = new Map<number, number[]>();
  for (const level of levels) {
    const stage = Math.ceil(level / LEVELS_PER_STAGE);
    if (!stages.has(stage)) stages.set(stage, []);
    stages.get(stage)!.push(level);
  }

  return (
    <div className="flex flex-col gap-6 p-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <h2 className="text-lg font-bold text-ios-label">Bosqichlar</h2>
      {Array.from(stages.entries()).map(([stage, stageLevels]) => (
        <div key={stage} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-ios-secondary-label">{stage}-etap</h3>
          <div className="grid grid-cols-5 gap-2">
            {stageLevels.map((level) => {
              const unlocked = isLevelUnlocked(level, progressByLevel);
              const stars = progressByLevel.get(level) ?? 0;
              const played = progressByLevel.has(level);
              return (
                <button
                  key={level}
                  type="button"
                  disabled={!unlocked}
                  onClick={() => handleSelect(level)}
                  className={`flex flex-col items-center gap-1 rounded-2xl py-3 font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)] transition-transform duration-150 active:scale-[0.96] disabled:active:scale-100 ${
                    unlocked ? 'bg-ios-card text-ios-label' : 'bg-ios-card text-ios-secondary-label opacity-50'
                  }`}
                >
                  <span>{level}</span>
                  {played && (
                    <span className="text-xs text-ios-gold">{'★'.repeat(stars)}{'☆'.repeat(3 - stars)}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
