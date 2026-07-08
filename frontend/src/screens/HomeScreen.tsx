// frontend/src/screens/HomeScreen.tsx
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import { PrimaryButton } from '../components/PrimaryButton';

export function HomeScreen() {
  const { user } = useAuth();
  const { navigate } = useNavigation();

  if (!user) return null;

  return (
    <div className="flex flex-col items-center gap-6 p-6">
      <h1 className="text-xl font-bold">{user.firstName}</h1>
      <p className="text-sm text-gray-500">Reyting: {user.rating}</p>
      <PrimaryButton onClick={() => navigate({ name: 'categorySelect', intent: 'quick' })}>
        Tezkor o'yin
      </PrimaryButton>
      <button
        type="button"
        className="w-full rounded-lg bg-gray-200 py-3 font-semibold text-gray-800"
        onClick={() => navigate({ name: 'categorySelect', intent: 'invite' })}
      >
        Do'stni chaqirish
      </button>
    </div>
  );
}
