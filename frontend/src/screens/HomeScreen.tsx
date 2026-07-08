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
    <div className="flex flex-col items-center gap-6 p-6">
      <p className="text-xl font-bold">{user.firstName}</p>
      <p className="text-sm text-gray-500">Reyting: {user.rating}</p>
      <PrimaryButton onClick={() => navigate({ name: 'categorySelect', intent: 'quick' })}>
        Tezkor o'yin
      </PrimaryButton>
      <SecondaryButton onClick={() => navigate({ name: 'categorySelect', intent: 'invite' })}>
        Do'stni chaqirish
      </SecondaryButton>
    </div>
  );
}
