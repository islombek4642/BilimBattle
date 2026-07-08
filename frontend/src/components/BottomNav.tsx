// frontend/src/components/BottomNav.tsx
import { useNavigation } from '../context/NavigationContext';

const TABS = [
  { name: 'home' as const, label: 'Bosh sahifa' },
  { name: 'leaderboard' as const, label: 'Reyting' },
  { name: 'settings' as const, label: 'Sozlamalar' },
];

export function BottomNav() {
  const { current, reset } = useNavigation();

  return (
    <nav className="flex justify-around border-t bg-white py-2" data-testid="bottom-nav">
      {TABS.map((tab) => (
        <button
          key={tab.name}
          type="button"
          aria-current={current.name === tab.name ? 'page' : undefined}
          className={`text-sm font-medium ${
            current.name === tab.name ? 'text-blue-600' : 'text-gray-400'
          }`}
          onClick={() => reset({ name: tab.name })}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
