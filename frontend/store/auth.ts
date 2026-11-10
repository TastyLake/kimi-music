'use client';

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Session, User } from '@/lib/types';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  streamToken: string | null;
  setSession: (s: Session) => void;
  setUser: (u: User) => void;
  setStreamToken: (t: string) => void;
  logout: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      streamToken: null,
      setSession: (s) =>
        set({ user: s.user, accessToken: s.accessToken, refreshToken: s.refreshToken, streamToken: s.streamToken }),
      setUser: (user) => set({ user }),
      setStreamToken: (streamToken) => set({ streamToken }),
      logout: () => set({ user: null, accessToken: null, refreshToken: null, streamToken: null }),
    }),
    {
      name: 'ms-auth',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

/** true, когда состояние из localStorage уже подгружено (избегаем мигания экрана входа). */
export function useAuthHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (useAuth.persist.hasHydrated()) setHydrated(true);
    return useAuth.persist.onFinishHydration(() => setHydrated(true));
  }, []);
  return hydrated;
}
