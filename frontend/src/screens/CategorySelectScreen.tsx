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
    <div className="flex flex-col gap-3 p-6">
      <h2 className="text-lg font-bold">Kategoriya tanlang</h2>
      {loading && <p className="text-sm text-gray-500">Yuklanmoqda...</p>}
      {!loading && error && (
        <p className="text-sm text-red-500">Kategoriyalarni yuklab bo'lmadi.</p>
      )}
      {!loading &&
        !error &&
        categories.map((c) => (
          <button
            key={c.key}
            type="button"
            className="w-full rounded-lg bg-gray-100 py-3 font-semibold text-gray-800"
            onClick={() => handleSelect(c.key)}
          >
            {c.label}
          </button>
        ))}
    </div>
  );
}
