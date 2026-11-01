import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getTokens, NetworkError, setTokens } from './api';
import type { Me } from './types';

type Ctx = {
  me: Me | null;
  loading: boolean;
  login: (email: string, password: string, otp?: string) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  setMe: (m: Me) => void;
};
const AuthCtx = createContext<Ctx>(null as unknown as Ctx);
export const useAuth = () => useContext(AuthCtx);

const ME_CACHE = 'spx.me';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMeState] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const setMe = (m: Me | null) => {
    setMeState(m);
    if (m) localStorage.setItem(ME_CACHE, JSON.stringify(m));
    else localStorage.removeItem(ME_CACHE);
  };

  const reload = useCallback(async () => {
    if (!getTokens()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await api<Me>('me'));
    } catch (e) {
      // sem rede: usa o último perfil conhecido (modo offline)
      if (e instanceof NetworkError) {
        const cached = localStorage.getItem(ME_CACHE);
        setMeState(cached ? JSON.parse(cached) : null);
      } else setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const out = () => setMe(null);
    const must = () => reload();
    window.addEventListener('spx:logout', out);
    window.addEventListener('spx:must-change', must);
    return () => {
      window.removeEventListener('spx:logout', out);
      window.removeEventListener('spx:must-change', must);
    };
  }, [reload]);

  const login = async (email: string, password: string, otp?: string) => {
    const t = await api('auth/login', { body: { email, password, otp } });
    setTokens(t);
    setMe(await api<Me>('me'));
  };
  const logout = async () => {
    try {
      await api('auth/logout', { method: 'POST' });
    } catch {
      /* já expirou */
    }
    setTokens(null);
    setMe(null);
  };

  return <AuthCtx.Provider value={{ me, loading, login, logout, reload, setMe: (m) => setMe(m) }}>{children}</AuthCtx.Provider>;
}
