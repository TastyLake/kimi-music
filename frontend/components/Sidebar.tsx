'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Compass, Home, Library, LogOut, Shield, ListMusic, Import, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Logo } from './Logo';
import { useAuth } from '@/store/auth';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const [badge, setBadge] = useState<number>(0);

  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    if (!isAdmin) return;
    let mounted = true;
    const fetchStats = () => {
      api<any>('/admin/summary').then((s) => mounted && setBadge(s.needsReview)).catch(() => {});
    };
    fetchStats();
    const int = setInterval(fetchStats, 60000);
    return () => {
      mounted = false;
      clearInterval(int);
    };
  }, [isAdmin]);

  const links = [
    { href: '/', label: 'Главная', icon: Home },
    { href: '/library', label: 'Библиотека', icon: Library },
    { href: '/browse', label: 'Обзор', icon: Compass },
    { href: '/playlists', label: 'Плейлисты', icon: ListMusic },
    { href: '/import', label: 'Импорт', icon: Import },
    ...(user?.canUpload ? [{ href: '/upload', label: 'Загрузка', icon: Upload }] : []),
    ...(isAdmin ? [{ href: '/admin', label: 'Админ-панель', icon: Shield, badge }] : []),
  ];

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const handleLogout = async () => {
    const { refreshToken, logout } = useAuth.getState();
    if (refreshToken) {
      await api('/auth/logout', { method: 'POST', body: { refreshToken }, anonymous: true }).catch(() => {});
    }
    
    localStorage.clear();
    sessionStorage.clear();
    document.cookie.split(";").forEach((c) => {
      document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
    });
    
    logout();
    router.replace('/login');
    setTimeout(() => window.location.reload(), 100);
  };

  if (!user) return null;

  return (
    <>
      {/* ДОБАВЛЕН КЛАСС pb-[104px] ЧТОБЫ КНОПКА НЕ ПРЯТАЛАСЬ ПОД ПЛЕЕРОМ */}
      <aside className="hidden h-full min-h-0 w-64 shrink-0 flex-col border-r border-pink-500/15 bg-pink-950/20 backdrop-blur-xl p-4 pb-[104px] md:flex">
        <Logo className="mb-6 px-2" />
        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {links.map(({ href, label, icon: Icon, badge: num }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
                isActive(href)
                  ? 'bg-pink-500/20 border border-pink-400/30 text-pink-100 shadow-sm shadow-pink-950/40'
                  : 'text-pink-200/70 hover:bg-pink-900/20 hover:text-pink-100'
              )}
            >
              <Icon size={18} className={isActive(href) ? 'text-pink-300' : 'text-pink-300/60'} />
              <span className="flex-1">{label}</span>
              {!!num && (
                <span className="rounded-full bg-gradient-to-r from-pink-500 to-rose-400 px-2 py-0.5 text-[11px] font-bold text-pink-950 shadow-sm">
                  {num}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="border-t border-pink-500/10 pt-3 mt-auto">
          <div className="mb-2 truncate px-2 text-xs text-pink-300/50">
            {user?.username} &middot; {user?.role === 'ADMIN' ? 'админ' : 'пользователь'}
          </div>
          <button
            className="flex w-full items-center gap-2 rounded-xl border border-pink-500/20 bg-pink-950/30 px-3 py-2 text-sm font-medium text-pink-200/80 transition-colors hover:bg-rose-500/20 hover:border-rose-500/30 hover:text-rose-200 cursor-pointer"
            onClick={handleLogout}
          >
            <LogOut size={16} /> Выйти
          </button>
        </div>
      </aside>

      <nav className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-pink-500/15 bg-pink-950/40 px-3 py-2.5 backdrop-blur-xl md:hidden">
        {links.map(({ href, label, icon: Icon, badge: num }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all',
              isActive(href)
                ? 'bg-pink-500/25 border border-pink-400/30 text-pink-100'
                : 'text-pink-200/70 bg-pink-950/30 border border-pink-500/10'
            )}
          >
            <Icon size={15} className={isActive(href) ? 'text-pink-300' : 'text-pink-300/60'} /> {label}
            {!!num && (
              <span className="rounded-full bg-gradient-to-r from-pink-500 to-rose-400 px-1.5 py-0.2 text-[10px] font-bold text-pink-950">
                {num}
              </span>
            )}
          </Link>
        ))}
        <button
          className="flex shrink-0 items-center gap-1.5 rounded-xl border border-pink-500/10 bg-pink-950/30 px-3 py-1.5 text-xs text-pink-300/70 cursor-pointer"
          onClick={handleLogout}
        >
          <LogOut size={15} /> Выйти
        </button>
      </nav>
    </>
  );
}
