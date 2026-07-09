// frontend/src/components/BattleAvatar.tsx
import { useState } from 'react';
import { getAvatarUrl } from '../api/client';

export function BattleAvatar({
  telegramId,
  size = 40,
  borderColorClass = '',
}: {
  telegramId: number | null;
  size?: number;
  borderColorClass?: string;
}) {
  const [errored, setErrored] = useState(false);

  if (telegramId === null || errored) {
    return (
      <div
        data-testid="battle-avatar-fallback"
        className={`flex items-center justify-center rounded-full border-2 bg-ios-divider ${borderColorClass}`}
        style={{ width: size, height: size }}
        role="img"
        aria-label="Foydalanuvchi rasmi"
      >
        <svg viewBox="0 0 24 24" width={size * 0.55} height={size * 0.55} fill="currentColor" className="text-ios-secondary-label">
          <path d="M12 12c2.7 0 4.9-2.2 4.9-4.9S14.7 2.2 12 2.2 7.1 4.4 7.1 7.1 9.3 12 12 12zm0 2.4c-3.3 0-9.8 1.6-9.8 4.9v2.4h19.6v-2.4c0-3.3-6.5-4.9-9.8-4.9z" />
        </svg>
      </div>
    );
  }

  return (
    <img
      src={getAvatarUrl(telegramId)}
      alt="Foydalanuvchi rasmi"
      onError={() => setErrored(true)}
      className={`rounded-full border-2 object-cover ${borderColorClass}`}
      style={{ width: size, height: size }}
    />
  );
}
