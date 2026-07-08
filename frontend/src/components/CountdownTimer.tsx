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

  return (
    <div className="text-center text-2xl font-bold" data-testid="countdown-timer">
      {msToSeconds(remainingMs)}s
    </div>
  );
}
