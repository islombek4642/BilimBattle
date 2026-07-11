// frontend/src/components/BattleHeader.tsx
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { BattleAvatar } from './BattleAvatar';
import { ScoreEntry } from '../api/types';
import { OpponentInfo } from '../socket/useGameSocket';
import { findMyScore, findOpponentScore } from '../utils/score';

// At a 500-point lead, the bar is fully at one edge. Chosen as a simple,
// legible starting point (a 7-question match's realistic score spread) -
// adjustable later without needing to touch anything else. This is also
// exactly HP_MAX on the backend (backend/src/game/gameEngine.ts) - a
// player's HP is `HP_MAX - opponentScore`, so this bar's position was
// already mathematically an HP difference before the HP/knockout feature
// existed; nothing about the position formula below changes for it.
const MAX_SWING_POINTS = 500;
const DAMAGE_POPUP_MS = 800;
const SHAKE_THRESHOLD = 150;
const SHAKE_MS = 150;

interface HitInfo {
  toOpponent: number;
  toMe: number;
  id: number;
}

export function BattleHeader({
  scores,
  opponent,
  questionIndex,
  totalQuestions,
}: {
  scores: ScoreEntry[];
  opponent: OpponentInfo | null;
  questionIndex: number;
  totalQuestions: number;
}) {
  const { user } = useAuth();
  const myUserId = user?.id ?? -1;
  const myScore = findMyScore(scores, myUserId);
  const opponentScore = findOpponentScore(scores, myUserId);

  const rawPosition = 50 + ((myScore - opponentScore) / MAX_SWING_POINTS) * 50;
  const position = Math.min(100, Math.max(0, rawPosition));

  const prevScoresRef = useRef({ my: myScore, opponent: opponentScore });
  const hitIdRef = useRef(0);
  const [hit, setHit] = useState<HitInfo | null>(null);
  const [shaking, setShaking] = useState(false);

  // Detects a score increase since the last render (a "hit" landing) by
  // comparing against the previous values, rather than reacting to the
  // `scores` prop identity - `scores` is a fresh array/objects on every
  // question_result even when the numbers inside haven't changed, so
  // comparing prop identity would misfire.
  useEffect(() => {
    const prev = prevScoresRef.current;
    const toOpponent = myScore - prev.my;
    const toMe = opponentScore - prev.opponent;
    prevScoresRef.current = { my: myScore, opponent: opponentScore };

    if (toOpponent <= 0 && toMe <= 0) return;

    hitIdRef.current += 1;
    setHit({ toOpponent, toMe, id: hitIdRef.current });
    const popupTimer = setTimeout(() => setHit(null), DAMAGE_POPUP_MS);

    let shakeTimer: ReturnType<typeof setTimeout> | undefined;
    if (toOpponent > SHAKE_THRESHOLD || toMe > SHAKE_THRESHOLD) {
      setShaking(true);
      shakeTimer = setTimeout(() => setShaking(false), SHAKE_MS);
    }

    return () => {
      clearTimeout(popupTimer);
      if (shakeTimer) clearTimeout(shakeTimer);
    };
  }, [myScore, opponentScore]);

  return (
    <div
      className={`flex flex-col gap-3 rounded-2xl bg-ios-card p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)] ${
        shaking ? 'animate-battle-shake' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BattleAvatar telegramId={user?.telegramId ?? null} size={36} borderColorClass="border-ios-blue" />
          <span className="text-sm font-semibold text-ios-blue">{user?.firstName ?? 'Siz'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ios-red">{opponent?.firstName ?? 'Raqib'}</span>
          <BattleAvatar telegramId={opponent?.telegramId ?? null} size={36} borderColorClass="border-ios-red" />
        </div>
      </div>
      <span className="text-center text-xs font-semibold tabular-nums text-ios-secondary-label">
        {questionIndex + 1}/{totalQuestions}
      </span>
      <div className="flex h-2 w-full overflow-hidden rounded-full">
        <div
          data-testid="tugofwar-blue"
          className="h-full bg-ios-blue transition-[width] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          style={{ width: `${position}%` }}
        />
        <div
          data-testid="tugofwar-red"
          className="h-full bg-ios-red transition-[width] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          style={{ width: `${100 - position}%` }}
        />
      </div>
      {hit && (hit.toMe > 0 || hit.toOpponent > 0) && (
        <div className="flex items-center justify-between text-sm font-bold">
          <span>
            {hit.toMe > 0 && (
              <span key={`me-${hit.id}`} data-testid="damage-me" className="animate-damage-pop text-ios-red">
                -{hit.toMe}
              </span>
            )}
          </span>
          <span>
            {hit.toOpponent > 0 && (
              <span
                key={`opp-${hit.id}`}
                data-testid="damage-opponent"
                className="animate-damage-pop text-ios-blue"
              >
                -{hit.toOpponent}
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
