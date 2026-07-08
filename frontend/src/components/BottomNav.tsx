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
    <nav
      className="flex justify-around border-t border-ios-divider bg-ios-card/95 pb-[env(safe-area-inset-bottom)] pt-2 backdrop-blur-lg"
      data-testid="bottom-nav"
    >
      {TABS.map((tab) => (
        <button
          key={tab.name}
          type="button"
          aria-current={current.name === tab.name ? 'page' : undefined}
          className={`flex-1 py-2 text-xs font-medium transition-colors duration-150 active:scale-[0.97] ${
            current.name === tab.name ? 'font-semibold text-ios-blue' : 'text-ios-secondary-label'
          }`}
          onClick={() => reset({ name: tab.name })}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
