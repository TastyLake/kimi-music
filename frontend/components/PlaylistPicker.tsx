'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import type { PlaylistSummary } from '@/lib/types';

/** Небольшое всплывающее окно «Добавить в плейлист». */
export function PlaylistPicker({ trackId, onClose }: { trackId: string; onClose: () => void }) {
  const [lists, setLists] = useState<PlaylistSummary[] | null>(null);
  const [name, setName] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ items: PlaylistSummary[] }>('/playlists')
      .then((r) => setLists(r.items))
      .catch(() => setLists([]));
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const add = async (playlistId: string, label: string) => {
    try {
      await api(`/playlists/${playlistId}/tracks`, { method: 'POST', body: { trackId } });
      setDone(label);
      setTimeout(onClose, 700);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    try {
      const p = await api<PlaylistSummary>('/playlists', { method: 'POST', body: { name: n } });
      await add(p.id, p.name);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div ref={ref} className="card absolute right-0 top-full z-30 mt-1 w-64 p-2 text-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
      {done ? (
        <div className="flex items-center gap-2 px-2 py-3 text-accent">
          <Check size={16} /> Добавлено в «{done}»
        </div>
      ) : (
        <>
          <div className="max-h-48 overflow-y-auto">
            {lists === null && <div className="px-2 py-2 text-zinc-500">Загрузка…</div>}
            {lists?.length === 0 && <div className="px-2 py-2 text-zinc-500">Плейлистов пока нет</div>}
            {lists?.map((p) => (
              <button
                key={p.id}
                className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-zinc-800"
                onClick={() => add(p.id, p.name)}
              >
                <span className="truncate">{p.name}</span>
                <span className="ml-2 text-xs text-zinc-500">{p.trackCount}</span>
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-1 border-t border-zinc-800 pt-2">
            <input
              className="input !py-1"
              placeholder="Новый плейлист"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
            />
            <button className="btn btn-primary !px-2" onClick={create} aria-label="Создать">
              <Plus size={16} />
            </button>
          </div>
          {error && <div className="mt-1 px-1 text-xs text-red-400">{error}</div>}
        </>
      )}
    </div>
  );
}
