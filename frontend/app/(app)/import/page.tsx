'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

interface YandexTrack {
  artist: string;
  title: string;
}

interface YandexPlaylist {
  owner: string;
  kind: string;
  title: string;
  trackCount: number;
}

export default function ImportPage() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [account, setAccount] = useState<{ uid: string; playlists: YandexPlaylist[] } | null>(null);
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (playlistName: string, tracks: YandexTrack[]) => {
    const created = await api<{ playlist: { id: string } }>('/import/playlist', {
      method: 'POST',
      body: { name: playlistName, tracks },
    });
    router.push(`/playlists/${created.playlist.id}`);
  };

  const importUrl = async () => {
    setError(null);
    setBusy('Читаю плейлист Яндекс Музыки…');
    try {
      const data = await api<{ title: string; tracks: YandexTrack[] }>('/import/yandex/url', { method: 'POST', body: { url } });
      await save(data.title, data.tracks);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const loadAccount = async () => {
    setError(null);
    setBusy('Проверяю токен…');
    try {
      setAccount(await api('/import/yandex/account', { method: 'POST', body: { token } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const importLikes = async () => {
    setError(null);
    setBusy('Забираю «Мне нравится»…');
    try {
      const data = await api<{ title: string; tracks: YandexTrack[] }>('/import/yandex/likes', { method: 'POST', body: { token } });
      await save(data.title, data.tracks);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const importPlaylist = async (playlist: YandexPlaylist) => {
    setError(null);
    setBusy(`Читаю «${playlist.title}»…`);
    try {
      const data = await api<{ title: string; tracks: YandexTrack[] }>('/import/yandex/playlist', {
        method: 'POST',
        body: { token, owner: playlist.owner, kind: playlist.kind },
      });
      await save(data.title, data.tracks);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const importText = async () => {
    setError(null);
    setBusy('Импортирую…');
    try {
      const created = await api<{ playlist: { id: string } }>('/import/playlist', {
        method: 'POST',
        body: { name: name.trim() || 'Импортированный плейлист', text },
      });
      router.push(`/playlists/${created.playlist.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-pink-50">Импорт</h1>
        <p className="mt-1 text-sm text-pink-300/60">Публичная ссылка Яндекс Музыки, токен аккаунта или текст «Исполнитель - Название».</p>
      </div>
      {error && <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}
      {busy && (
        <div className="flex items-center gap-2 text-sm text-pink-200">
          <Loader2 size={16} className="animate-spin" /> {busy}
        </div>
      )}

      <section className="space-y-3 rounded-2xl border border-pink-500/15 bg-pink-950/30 p-4">
        <h2 className="font-semibold text-pink-50">Публичный плейлист</h2>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://music.yandex.ru/users/…/playlists/…"
          className="w-full rounded-xl border border-pink-500/20 bg-pink-950/40 px-3 py-2 text-sm text-pink-50 outline-none"
        />
        <button type="button" className="rounded-xl bg-pink-500/25 px-4 py-2 text-sm font-semibold text-pink-50" disabled={!url.trim() || Boolean(busy)} onClick={() => void importUrl()}>
          Импортировать ссылку
        </button>
      </section>

      <section className="space-y-3 rounded-2xl border border-pink-500/15 bg-pink-950/30 p-4">
        <h2 className="font-semibold text-pink-50">Токен Яндекс Музыки</h2>
        <p className="text-xs text-pink-300/60">Токен нужен только чтобы прочитать твои плейлисты и «Мне нравится». Он уходит на сервер в момент запроса и не сохраняется.</p>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="OAuth-токен"
          type="password"
          className="w-full rounded-xl border border-pink-500/20 bg-pink-950/40 px-3 py-2 text-sm text-pink-50 outline-none"
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded-xl bg-pink-500/25 px-4 py-2 text-sm font-semibold text-pink-50" disabled={token.trim().length < 10 || Boolean(busy)} onClick={() => void loadAccount()}>
            Показать плейлисты
          </button>
          <button type="button" className="rounded-xl border border-pink-400/30 px-4 py-2 text-sm text-pink-100" disabled={!account || Boolean(busy)} onClick={() => void importLikes()}>
            Импорт «Мне нравится»
          </button>
        </div>
        {account && (
          <div className="divide-y divide-pink-500/10">
            {account.playlists.map((playlist) => (
              <button key={`${playlist.owner}-${playlist.kind}`} type="button" className="flex w-full items-center justify-between py-2 text-left text-sm text-pink-100 hover:text-white" onClick={() => void importPlaylist(playlist)}>
                <span className="truncate">{playlist.title}</span>
                <span className="shrink-0 text-xs text-pink-300/50">{playlist.trackCount}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border border-pink-500/15 bg-pink-950/30 p-4">
        <h2 className="font-semibold text-pink-50">Файл или текст</h2>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название плейлиста" className="w-full rounded-xl border border-pink-500/20 bg-pink-950/40 px-3 py-2 text-sm text-pink-50 outline-none" />
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder={'Исполнитель - Название'} className="w-full rounded-xl border border-pink-500/20 bg-pink-950/40 px-3 py-2 text-sm text-pink-50 outline-none" />
        <button type="button" className="rounded-xl bg-pink-500/25 px-4 py-2 text-sm font-semibold text-pink-50" disabled={!text.trim() || Boolean(busy)} onClick={() => void importText()}>
          Импортировать текст
        </button>
      </section>
    </div>
  );
}
