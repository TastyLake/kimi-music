'use client';

import { useEffect, useState } from 'react';
import { FolderInput, Play, Shuffle, Trash2, X } from 'lucide-react';
import { Cover } from '@/components/Cover';
import { TrackTable } from '@/components/TrackTable';
import { api } from '@/lib/api';
import type { PlaylistDetail, PlaylistSummary, Track } from '@/lib/types';
import { shuffleList, trackToItem, usePlayer } from '@/store/player';

export default function PlaylistClient({ id }: { id: string }) {
  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState(false);
  const [targets, setTargets] = useState<PlaylistSummary[]>([]);

  useEffect(() => {
    api<PlaylistDetail>(`/playlists/${id}`)
      .then(setPlaylist)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const tracks = playlist?.tracks ?? [];

  const play = (start = 0) => {
    if (tracks.length === 0) return;
    usePlayer.getState().playQueue(tracks.map(trackToItem), start);
  };

  const playShuffled = () => {
    if (tracks.length === 0) return;
    usePlayer.getState().playQueue(shuffleList(tracks).map(trackToItem), 0);
    usePlayer.setState({ shuffle: true });
  };

  const toggle = (trackId: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(trackId);
      else next.delete(trackId);
      return next;
    });
  };

  const removeSelected = async () => {
    const trackIds = [...selected];
    if (trackIds.length === 0) return;
    try {
      await api(`/playlists/${id}/tracks/bulk-delete`, { method: 'POST', body: { trackIds } });
      setPlaylist((p) => (p ? { ...p, tracks: p.tracks.filter((t) => !selected.has(t.id)) } : p));
      setSelected(new Set());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const openMove = async () => {
    setMoving(true);
    try {
      const res = await api<{ items: PlaylistSummary[] }>('/playlists');
      setTargets(res.items.filter((p) => p.id !== id));
    } catch (e) {
      setError((e as Error).message);
      setMoving(false);
    }
  };

  const moveTo = async (targetId: string) => {
    const trackIds = [...selected];
    try {
      await api(`/playlists/${id}/tracks/move`, { method: 'POST', body: { trackIds, targetId } });
      setPlaylist((p) => (p ? { ...p, tracks: p.tracks.filter((t) => !selected.has(t.id)) } : p));
      setSelected(new Set());
      setMoving(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const removeFromPlaylist = async (track: Track) => {
    try {
      await api(`/playlists/${id}/tracks/${track.id}`, { method: 'DELETE' });
      setPlaylist((p) => (p ? { ...p, tracks: p.tracks.filter((t) => t.id !== track.id) } : p));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (error && !playlist) {
    return <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>;
  }
  if (!playlist) return <div className="text-sm text-zinc-500">Загрузка…</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
        <Cover url={tracks[0]?.coverUrl ?? null} title={playlist.name} size={160} className="!h-40 !w-40" />
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Плейлист</div>
          <h1 className="mt-1 truncate text-3xl font-bold">{playlist.name}</h1>
          {playlist.description && <p className="mt-2 max-w-xl text-sm text-zinc-400">{playlist.description}</p>}
          <p className="mt-2 text-sm text-zinc-500">{tracks.length} треков</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={tracks.length === 0} onClick={() => play(0)}>
              <Play size={16} fill="currentColor" /> Играть
            </button>
            <button className="btn" disabled={tracks.length === 0} onClick={playShuffled}>
              <Shuffle size={16} /> Перемешать
            </button>
          </div>
        </div>
      </div>

      {error && <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}

      {selected.size > 0 && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-pink-500/30 bg-pink-950/90 px-4 py-3 shadow-xl backdrop-blur-xl">
          <span className="text-sm text-pink-100">Выбрано: {selected.size}</span>
          <div className="flex gap-2">
            <button type="button" className="inline-flex items-center gap-1.5 rounded-xl bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-100" onClick={() => void removeSelected()}>
              <Trash2 size={14} /> Удалить выбранные из плейлиста
            </button>
            <button type="button" className="inline-flex items-center gap-1.5 rounded-xl bg-pink-500/20 px-3 py-1.5 text-xs font-semibold text-pink-100" onClick={() => void openMove()}>
              <FolderInput size={14} /> Перенести в другой плейлист
            </button>
          </div>
        </div>
      )}

      {moving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setMoving(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-pink-500/20 bg-pink-950 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 text-sm font-semibold text-pink-50">Куда перенести</div>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {targets.length === 0 && <div className="text-sm text-pink-300/60">Других плейлистов нет</div>}
              {targets.map((target) => (
                <button key={target.id} type="button" className="block w-full rounded-xl px-3 py-2 text-left text-sm text-pink-100 hover:bg-pink-900/40" onClick={() => void moveTo(target.id)}>
                  {target.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <TrackTable
        tracks={tracks}
        onPlay={(i) => play(i)}
        selectedIds={selected}
        onToggleSelect={toggle}
        renderExtra={(track) => (
          <button
            className="rounded p-1.5 text-zinc-500 hover:text-red-400"
            title="Убрать из плейлиста"
            onClick={() => void removeFromPlaylist(track)}
          >
            <X size={16} />
          </button>
        )}
        emptyText="В этом плейлисте пока нет треков."
      />
    </div>
  );
}
