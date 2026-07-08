// frontend/src/components/CountdownTimer.tsx
import { useEffect, useState } from 'react';
import { msToSeconds } from '../utils/time';

export function CountdownTimer({ timeLimitMs }: { timeLimitMs: number }) {
  const [remainingMs, setRemainingMs] = useState(timeLimitMs);

  useEffect(() => {
    setRemainingMs(timeLimitMs);
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      setRemainingMs(Math.max(timeLimitMs - elapsed, 0));
    }, 100);
    return () => clearInterval(interval);
  }, [timeLimitMs]);

  const seconds = msToSeconds(remainingMs);
  const isLow = seconds <= 3;

  return (
    <div className="flex justify-center">
      <div
        className={`flex h-14 w-14 items-center justify-center rounded-full text-xl font-bold tabular-nums transition-colors duration-300 ${
          isLow ? 'bg-ios-red/10 text-ios-red' : 'bg-ios-card text-ios-label shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]'
        }`}
        data-testid="countdown-timer"
      >
        {seconds}s
      </div>
    </div>
  );
}
