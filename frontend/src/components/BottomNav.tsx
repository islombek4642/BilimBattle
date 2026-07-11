// frontend/src/components/BottomNav.tsx
import { House, Trophy, Gear } from '@phosphor-icons/react';
import { useNavigation } from '../context/NavigationContext';

const TABS: { name: 'home' | 'leaderboard' | 'settings'; label: string; icon: typeof House }[] = [
  { name: 'home', label: 'Bosh sahifa', icon: House },
  { name: 'leaderboard', label: 'Reyting', icon: Trophy },
  { name: 'settings', label: 'Sozlamalar', icon: Gear },
];

export function BottomNav() {
  const { current, reset } = useNavigation();

  return (
    <nav
      className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-10 flex items-center justify-around gap-1 rounded-full bg-ios-card/95 p-1.5 shadow-[0_4px_20px_rgba(0,0,0,0.1)] backdrop-blur-lg"
      data-testid="bottom-nav"
    >
      {TABS.map((tab) => {
        const isActive = current.name === tab.name;
        const Icon = tab.icon;
        return (
          <button
            key={tab.name}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => reset({ name: tab.name })}
            className="flex flex-1 items-center justify-center py-1 transition-transform duration-200 active:scale-[0.96]"
          >
            {/* The colored highlight lives on this inner, content-sized span
                (not the flex-1 button above) so the active "chip" hugs just
                the icon+label instead of stretching across the whole
                equal-width tap target - a large touch target is still good
                for accessibility, but the visual highlight reads as a
                compact pill only if it doesn't fill that entire width. */}
            <span
              className={`flex flex-col items-center gap-0.5 rounded-full px-4 py-1.5 text-[11px] font-medium transition-colors duration-200 ${
                isActive ? 'bg-ios-blue/10 text-ios-blue' : 'text-ios-secondary-label'
              }`}
            >
              <Icon size={22} weight={isActive ? 'fill' : 'regular'} />
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
