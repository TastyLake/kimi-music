'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Import, Plus } from 'lucide-react';
import { Cover } from '@/components/Cover';
import { api } from '@/lib/api';
import type { PlaylistSummary } from '@/lib/types';

export default function PlaylistsPage() {
  const [mine, setMine] = useState<PlaylistSummary[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api<{ items: PlaylistSummary[] }>('/playlists')
      .then((r) => setMine(r.items))
      .catch((e: Error) => setError(e.message));
  };
  useEffect(load, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api('/playlists', { method: 'POST', body: { name: name.trim() } });
      setName('');
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Плейлисты</h1>
        <Link href="/import" className="btn">
          <Import size={16} /> Импорт из Spotify
        </Link>
      </div>

      <form onSubmit={create} className="card flex flex-wrap items-center gap-3 p-3">
        <input className="input !w-auto min-w-0 flex-1" placeholder="Название нового плейлиста" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        <button className="btn btn-primary" disabled={!name.trim()}>
          <Plus size={16} /> Создать
        </button>
      </form>
      {error && <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}

      {mine === null ? (
        <div className="text-sm text-zinc-500">Загрузка…</div>
      ) : mine.length === 0 ? (
        <div className="text-sm text-zinc-500">Пока нет плейлистов.</div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5">
          {mine.map((p) => (
            <Link key={p.id} href={`/playlists/${p.id}`} className="card block p-3 transition-colors hover:bg-zinc-900">
              <Cover url={p.coverUrl} title={p.name} size={160} className="!h-auto aspect-square !w-full" />
              <div className="mt-3 truncate text-sm font-medium">{p.name}</div>
              <div className="truncate text-xs text-zinc-500">{p.trackCount} треков</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
