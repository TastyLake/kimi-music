'use client';

import { useState, type ReactNode } from 'react';
import { Heart, ListEnd, ListPlus, Pause, Play, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { Track } from '@/lib/types';
import { cn, formatDuration } from '@/lib/utils';
import { trackToItem, usePlayer } from '@/store/player';
import { Cover } from './Cover';
import { PlaylistPicker } from './PlaylistPicker';

interface Props {
  tracks: Track[];
  onPlay: (index: number) => void;
  onFavoriteChange?: (trackId: string, favorite: boolean) => void;
  /** если передан — у каждой строки появляется кнопка удаления трека из медиатеки */
  onDelete?: (trackId: string) => void;
  /** дополнительные кнопки в конце строки (например, «убрать из плейлиста») */
  renderExtra?: (track: Track, index: number) => ReactNode;
  emptyText?: string;
}

export function TrackTable({ tracks, onPlay, onFavoriteChange, onDelete, renderExtra, emptyText = 'Ничего не найдено' }: Props) {
  const current = usePlayer((s) => s.queue[s.index]);
  const playing = usePlayer((s) => s.playing);
  const [favs, setFavs] = useState<Record<string, boolean>>({});
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const isFav = (t: Track) => favs[t.id] ?? t.isFavorite ?? false;

  const toggleFav = async (t: Track) => {
    const next = !isFav(t);
    setFavs((f) => ({ ...f, [t.id]: next }));
    try {
      await api(`/favorites/${t.id}`, { method: next ? 'PUT' : 'DELETE' });
      onFavoriteChange?.(t.id, next);
    } catch {
      setFavs((f) => ({ ...f, [t.id]: !next }));
    }
  };

  const remove = async (t: Track) => {
    if (!confirm(`Удалить «${t.artist} — ${t.title}» из медиатеки? Файл будет удалён с сервера.`)) return;
    try {
      await api(`/tracks/${t.id}`, { method: 'DELETE' });
    } catch (e) {
      alert((e as Error).message);
      return;
    }
    // убираем удалённый трек из очереди плеера, иначе он попытается его воспроизвести
    const p = usePlayer.getState();
    p.queue
      .map((q, i) => (q.kind === 'local' && q.id === t.id ? i : -1))
      .filter((i) => i >= 0)
      .reverse()
      .forEach((i) => usePlayer.getState().removeAt(i));
    onDelete?.(t.id);
  };

  if (tracks.length === 0) return <div className="card px-6 py-12 text-center text-sm text-zinc-500">{emptyText}</div>;

  return (
    <div className="card divide-y divide-zinc-900">
      <div className="hidden grid-cols-[2.5rem_minmax(0,2fr)_minmax(0,1.3fr)_4rem_4rem_8.5rem] gap-3 px-4 py-2 text-[11px] uppercase tracking-wide text-zinc-500 md:grid">
        <span>#</span>
        <span>Название</span>
        <span>Альбом · жанры</span>
        <span>Год</span>
        <span>Время</span>
        <span />
      </div>
      {tracks.map((t, i) => {
        const isCurrent = current?.kind === 'local' && current.id === t.id;
        return (
          <div
            key={t.id}
            className={cn(
              'group relative grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 hover:bg-zinc-900/60 md:grid-cols-[2.5rem_minmax(0,2fr)_minmax(0,1.3fr)_4rem_4rem_8.5rem]',
              isCurrent && 'bg-zinc-900/80',
            )}
            onDoubleClick={() => onPlay(i)}
          >
            <button
              className="flex h-8 w-8 items-center justify-center rounded text-zinc-500 hover:text-white"
              onClick={() => (isCurrent ? usePlayer.getState().toggle() : onPlay(i))}
              aria-label={isCurrent && playing ? 'Пауза' : 'Играть'}
            >
              {isCurrent && playing ? (
                <Pause size={16} className="text-accent" fill="currentColor" />
              ) : (
                <>
                  <span className={cn('text-xs tabular-nums group-hover:hidden', isCurrent && 'text-accent')}>{i + 1}</span>
                  <Play size={16} className="hidden group-hover:block" fill="currentColor" />
                </>
              )}
            </button>

            <div className="flex min-w-0 items-center gap-3">
              <Cover url={t.coverUrl} title={t.title} size={40} />
              <div className="min-w-0">
                <div className={cn('truncate text-sm', isCurrent && 'text-accent')}>{t.title}</div>
                <div className="truncate text-xs text-zinc-400">{t.artist}</div>
              </div>
            </div>

            <div className="hidden min-w-0 md:block">
              <div className="truncate text-xs text-zinc-400">{t.album ?? '—'}</div>
              <div className="mt-0.5 flex gap-1 overflow-hidden">
                {t.genres.slice(0, 3).map((g) => (
                  <span
                    key={g.name}
                    className={cn(
                      'truncate rounded px-1.5 py-0.5 text-[10px]',
                      g.primary ? 'bg-yellow-400/15 text-yellow-300' : 'bg-zinc-800 text-zinc-400',
                    )}
                  >
                    {g.name}
                  </span>
                ))}
              </div>
            </div>
            <div className="hidden text-xs text-zinc-400 md:block">{t.year ?? '—'}</div>
            <div className="hidden text-xs tabular-nums text-zinc-400 md:block">{formatDuration(t.duration)}</div>

            <div className="relative flex items-center justify-end gap-0.5">
              <button
                className={cn('rounded p-1.5', isFav(t) ? 'text-accent' : 'text-zinc-500 hover:text-white')}
                onClick={() => toggleFav(t)}
                aria-label="В избранное"
                aria-pressed={isFav(t)}
              >
                <Heart size={16} fill={isFav(t) ? 'currentColor' : 'none'} />
              </button>
              <button
                className="rounded p-1.5 text-zinc-500 hover:text-white"
                onClick={() => usePlayer.getState().enqueue(trackToItem(t))}
                title="В очередь"
              >
                <ListEnd size={16} />
              </button>
              <button
                className="rounded p-1.5 text-zinc-500 hover:text-white"
                onClick={() => setPickerFor(pickerFor === t.id ? null : t.id)}
                title="В плейлист"
              >
                <ListPlus size={16} />
              </button>
              {onDelete && (
                <button className="rounded p-1.5 text-zinc-500 hover:text-red-400" onClick={() => void remove(t)} title="Удалить из медиатеки">
                  <Trash2 size={16} />
                </button>
              )}
              {renderExtra?.(t, i)}
              {pickerFor === t.id && <PlaylistPicker trackId={t.id} onClose={() => setPickerFor(null)} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
