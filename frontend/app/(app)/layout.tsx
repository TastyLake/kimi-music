'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { GlobalPlayer } from '@/components/GlobalPlayer';
import { Sidebar } from '@/components/Sidebar';
import { api } from '@/lib/api';
import type { User } from '@/lib/types';
import { useAuth, useAuthHydrated } from '@/store/auth';

/**
 * Этот layout не перемонтируется при навигации между страницами группы (app),
 * поэтому <GlobalPlayer/> с единственным <audio> живёт непрерывно — музыка не прерывается.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const hydrated = useAuthHydrated();
  const user = useAuth((s) => s.user);

  useEffect(() => {
    if (hydrated && !user) {
      // Spotify вернул пользователя на /import до входа — запоминаем код авторизации
      if (location.pathname === '/import' && location.search.includes('code=')) {
        sessionStorage.setItem('loral-pending-import', location.search);
      }
      router.replace('/login');
    }
  }, [hydrated, user, router]);

  // Актуализируем роль/права (их мог изменить админ)
  useEffect(() => {
    if (!user) return;
    api<{ user: User }>('/auth/me')
      .then((r) => useAuth.getState().setUser(r.user))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!hydrated || !user) {
    return <div className="flex h-screen items-center justify-center text-sm text-zinc-500">Загрузка…</div>;
  }

  return (
    <div className="flex h-screen flex-col md:flex-row">
      <Sidebar />
      <main className="min-h-0 flex-1 overflow-y-auto pb-[104px]">
        <div className="mx-auto max-w-6xl p-4 md:p-8">{children}</div>
      </main>
      <GlobalPlayer />
    </div>
  );
}
