// frontend/src/screens/HomeScreen.tsx
import { Lightning, UserPlus } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';

export function HomeScreen() {
  const { user } = useAuth();
  const { navigate } = useNavigation();

  if (!user) return null;

  return (
    <div className="flex min-h-full flex-col justify-center gap-3 p-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <PrimaryButton shiny onClick={() => navigate({ name: 'levelSelect', intent: 'quick' })}>
        <span className="flex items-center justify-center gap-2">
          <Lightning size={20} weight="fill" />
          Tezkor o'yin
        </span>
      </PrimaryButton>
      <SecondaryButton onClick={() => navigate({ name: 'levelSelect', intent: 'invite' })}>
        <span className="flex items-center justify-center gap-2">
          <UserPlus size={20} weight="fill" />
          Do'stni chaqirish
        </span>
      </SecondaryButton>
    </div>
  );
}
