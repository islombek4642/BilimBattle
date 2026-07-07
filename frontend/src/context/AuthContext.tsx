// frontend/src/context/AuthContext.tsx
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { login } from '../api/auth';
import { getInitData, getStartParam } from '../telegram/webApp';
import { User } from '../api/types';

interface AuthContextValue {
  token: string | null;
  user: User | null;
  loading: boolean;
  error: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initData = getInitData();
    if (!initData) {
      setError("Telegram ma'lumotlari topilmadi");
      setLoading(false);
      return;
    }

    login(initData, getStartParam())
      .then((res) => {
        setToken(res.token);
        setUser(res.user);
      })
      .catch(() => {
        setError('Tizimga kirishda xatolik yuz berdi');
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return (
    <AuthContext.Provider value={{ token, user, loading, error }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
