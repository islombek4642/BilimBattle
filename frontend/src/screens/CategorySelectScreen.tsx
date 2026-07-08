// frontend/src/screens/CategorySelectScreen.tsx
import { useEffect, useState } from 'react';
import { useNavigation } from '../context/NavigationContext';
import { useGameSocketContext } from '../context/GameSocketContext';
import { getCategories } from '../api/questions';
import { Category } from '../api/types';

export function CategorySelectScreen({ intent }: { intent: 'quick' | 'invite' }) {
  const { navigate } = useNavigation();
  const { joinQueue, createInvite } = useGameSocketContext();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(false);

    getCategories()
      .then((res) => {
        if (cancelled) return;
        setCategories(res.categories);
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
  }, []);

  const handleSelect = (category: string) => {
    if (intent === 'quick') {
      joinQueue(category);
    } else {
      createInvite(category);
    }
    navigate({ name: 'waiting', category, intent });
  };

  return (
    <div className="flex flex-col gap-3 p-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <h2 className="text-lg font-bold text-ios-label">Kategoriya tanlang</h2>
      {loading && <p className="text-sm text-ios-secondary-label">Yuklanmoqda...</p>}
      {!loading && error && (
        <p className="text-sm text-ios-red">Kategoriyalarni yuklab bo'lmadi.</p>
      )}
      {!loading &&
        !error &&
        categories.map((c) => (
          <button
            key={c.key}
            type="button"
            className="w-full rounded-2xl bg-ios-card py-4 text-left font-semibold text-ios-label shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)] transition-transform duration-150 active:scale-[0.98]"
            onClick={() => handleSelect(c.key)}
          >
            <span className="px-5">{c.label}</span>
          </button>
        ))}
    </div>
  );
}
