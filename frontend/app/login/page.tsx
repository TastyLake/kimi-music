'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Mail, User, Loader2, Music2 } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { api, ApiError } from '@/lib/api';
import type { Session } from '@/lib/types';
import { useAuth } from '@/store/auth';

export default function LoginPage() {
  const router = useRouter();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
      
      // Передаем и username, и login одновременно, чтобы бэкенд точно нашел нужное поле
      const body: any = {
        username,
        login: username,
        password,
      };

      if (mode === 'register' && email) {
        body.email = email;
      }

      const res = await api<Session>(endpoint, {
        method: 'POST',
        body,
        anonymous: true,
      });

      useAuth.getState().setSession(res);

      router.replace('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Произошла ошибка соединения');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-3xl border border-pink-500/20 bg-pink-950/40 p-8 shadow-2xl shadow-pink-950/80 backdrop-blur-xl">
        
        {/* Логотип */}
        <div className="flex justify-center pb-2">
          <Logo />
        </div>

        {/* Переключатель Вход / Регистрация */}
        <div className="grid grid-cols-2 gap-1 rounded-2xl border border-pink-500/15 bg-pink-950/50 p-1 text-sm">
          <button
            type="button"
            onClick={() => { setMode('login'); setError(null); }}
            className={`rounded-xl py-2 font-medium transition-all ${
              mode === 'login'
                ? 'bg-pink-500/30 border border-pink-400/40 text-pink-100 shadow-sm'
                : 'text-pink-300/60 hover:text-pink-200'
            }`}
          >
            Вход
          </button>
          <button
            type="button"
            onClick={() => { setMode('register'); setError(null); }}
            className={`rounded-xl py-2 font-medium transition-all ${
              mode === 'register'
                ? 'bg-pink-500/30 border border-pink-400/40 text-pink-100 shadow-sm'
                : 'text-pink-300/60 hover:text-pink-200'
            }`}
          >
            Регистрация
          </button>
        </div>

        {error && (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-center text-xs font-medium text-rose-200">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-pink-300/85">Имя пользователя / Логин</label>
            <div className="relative">
              <User size={16} className="absolute left-3.5 top-3.5 text-pink-400/50" />
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Введите логин"
                className="w-full rounded-2xl border border-pink-500/20 bg-pink-950/60 py-3 pl-10 pr-4 text-sm text-pink-100 placeholder-pink-300/30 outline-none transition-all focus:border-pink-400 focus:bg-pink-900/40 focus:ring-2 focus:ring-pink-500/20"
              />
            </div>
          </div>

          {/* Поле Email появляется при регистрации */}
          {mode === 'register' && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-pink-300/85">Email</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-3.5 text-pink-400/50" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full rounded-2xl border border-pink-500/20 bg-pink-950/60 py-3 pl-10 pr-4 text-sm text-pink-100 placeholder-pink-300/30 outline-none transition-all focus:border-pink-400 focus:bg-pink-900/40 focus:ring-2 focus:ring-pink-500/20"
                />
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-semibold text-pink-300/85">Пароль</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3.5 top-3.5 text-pink-400/50" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-2xl border border-pink-500/20 bg-pink-950/60 py-3 pl-10 pr-4 text-sm text-pink-100 placeholder-pink-300/30 outline-none transition-all focus:border-pink-400 focus:bg-pink-900/40 focus:ring-2 focus:ring-pink-500/20"
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-pink-500 via-rose-400 to-purple-400 py-3.5 text-sm font-bold text-pink-950 shadow-lg shadow-pink-500/25 transition-all hover:opacity-95 active:scale-[0.99] disabled:opacity-50"
        >
          {loading ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <Music2 size={18} />
          )}
          {mode === 'login' ? 'Войти в Кими' : 'Создать аккаунт'}
        </button>
      </form>
    </div>
  );
}