// frontend/src/screens/HomeScreen.tsx
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';

export function HomeScreen() {
  const { user } = useAuth();
  const { navigate } = useNavigation();

  if (!user) return null;

  return (
    <div className="flex min-h-full flex-col gap-8 p-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-ios-card px-6 py-8 text-center shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-ios-blue/10 text-2xl font-bold text-ios-blue">
          {user.firstName.charAt(0).toUpperCase()}
        </div>
        <p className="text-xl font-bold text-ios-label">{user.firstName}</p>
        <span className="rounded-full bg-ios-bg px-3 py-1 text-sm font-semibold text-ios-secondary-label">
          Reyting: {user.rating}
        </span>
      </div>
      <div className="flex flex-col gap-3">
        <PrimaryButton onClick={() => navigate({ name: 'categorySelect', intent: 'quick' })}>
          Tezkor o'yin
        </PrimaryButton>
        <SecondaryButton onClick={() => navigate({ name: 'categorySelect', intent: 'invite' })}>
          Do'stni chaqirish
        </SecondaryButton>
      </div>
    </div>
  );
}
