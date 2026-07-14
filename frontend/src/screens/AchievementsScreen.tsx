// frontend/src/screens/AchievementsScreen.tsx
import { useEffect, useState } from 'react';
import { Flame, Star, Medal, GameController, LockSimple } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { getAchievements, Achievement, EarnedAchievement } from '../api/achievements';

const CATEGORY_ICON: Record<Achievement['category'], typeof Flame> = {
  games: GameController,
  streak: Flame,
  rating: Star,
  level: Medal,
};

const CATEGORY_LABEL: Record<Achievement['category'], string> = {
  games: 'Faollik',
  streak: 'Olov',
  rating: 'Yuksalish',
  level: 'Bosqichlar',
};

const CATEGORY_ORDER: Achievement['category'][] = ['games', 'streak', 'rating', 'level'];

export function AchievementsScreen() {
  const { token } = useAuth();
  const [catalog, setCatalog] = useState<Achievement[]>([]);
  const [earned, setEarned] = useState<EarnedAchievement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setError(false);

    getAchievements(token)
      .then((res) => {
        if (cancelled) return;
        setCatalog(res.catalog);
        setEarned(res.earned);
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
        Nishonlarni yuklab bo'lmadi.
      </div>
    );
  }

  const earnedByKey = new Map(earned.map((e) => [e.key, e.earnedAt]));

  return (
    <div className="flex flex-col gap-6 p-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <h2 className="text-lg font-bold text-ios-label">Nishonlarim</h2>
      {CATEGORY_ORDER.map((category) => {
        const items = catalog.filter((a) => a.category === category);
        if (items.length === 0) return null;
        const Icon = CATEGORY_ICON[category];
        return (
          <div key={category} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-ios-secondary-label">{CATEGORY_LABEL[category]}</h3>
            <div className="grid grid-cols-2 gap-2">
              {items.map((achievement) => {
                const isEarned = earnedByKey.has(achievement.key);
                return (
                  <div
                    key={achievement.key}
                    className={`flex flex-col items-center gap-1 rounded-2xl p-4 text-center shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)] ${
                      isEarned ? 'bg-ios-card' : 'bg-ios-card opacity-50'
                    }`}
                  >
                    {isEarned ? (
                      <Icon size={28} weight="fill" className="text-ios-gold" />
                    ) : (
                      <LockSimple size={24} weight="fill" className="text-ios-secondary-label" />
                    )}
                    <span className="text-sm font-semibold text-ios-label">{achievement.label}</span>
                    <span className="text-xs text-ios-secondary-label">{achievement.description}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
