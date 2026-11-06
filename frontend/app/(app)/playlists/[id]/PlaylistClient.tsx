'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Play, RotateCcw, Trash2, X } from 'lucide-react';
import { TrackTable } from '@/components/TrackTable';
import { api } from '@/lib/api';
import type { PlaylistDetail, PlaylistDownload } from '@/lib/types';
import { trackToItem, usePlayer } from '@/store/player';

const DOWNLOAD_LABEL: Record<PlaylistDownload['status'], string> = {
  PENDING: 'В очереди',
  PROCESSING: 'В процессе загрузки...',
  COMPLETED: 'Готово',
  FAILED: 'Не найдено',
  CANCELLED: 'Отменено',
};

export function PlaylistClient() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [pl, setPl] = useState<PlaylistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let sawPlaylist = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      try {
        const data = await api<PlaylistDetail>(`/playlists/${id}`);
        if (cancelled) return;
        sawPlaylist = true;
        setError(null);
        setPl(data);
        const active = (data.downloads ?? []).some((d) => d.status === 'PENDING' || d.status === 'PROCESSING');
        const processing = (data.downloads ?? []).some((d) => d.status === 'PROCESSING');
        if (active) timer = setTimeout(() => void load(), processing ? 2000 : 4000);
      } catch (e) {
        if (!cancelled && !sawPlaylist) setError((e as Error).message);
      }
    };

    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, rev]);

  if (error) return <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>;
  if (!pl) return <div className="text-sm text-zinc-500">Загрузка…</div>;

  const patch = async (body: { name?: string; isPublic?: boolean }) => {
    await api(`/playlists/${pl.id}`, { method: 'PATCH', body });
    setPl({ ...pl, ...body });
  };

  const removeTrack = async (trackId: string) => {
    await api(`/playlists/${pl.id}/tracks/${trackId}`, { method: 'DELETE' });
    setPl({ ...pl, tracks: pl.tracks.filter((t) => t.id !== trackId) });
  };

  const remove = async () => {
    if (!confirm(`Удалить плейлист «${pl.name}»?`)) return;
    await api(`/playlists/${pl.id}`, { method: 'DELETE' });
    router.replace('/playlists');
  };

  const downloads = pl.downloads ?? [];
  const active = downloads.some((d) => d.status === 'PENDING' || d.status === 'PROCESSING');
  const failed = downloads.filter((d) => d.status === 'FAILED');
  const shown = active ? downloads.filter((d) => d.status !== 'COMPLETED') : downloads.filter((d) => d.status === 'FAILED' || d.status === 'CANCELLED');

  const patchDownload = (id: string, patch: Partial<PlaylistDownload>) =>
    setPl({ ...pl, downloads: downloads.map((d) => (d.id === id ? { ...d, ...patch } : d)) });

  const cancelDownload = async (downloadId: string) => {
    await api(`/playlists/${pl.id}/downloads/${downloadId}/cancel`, { method: 'POST' });
    patchDownload(downloadId, { status: 'CANCELLED', error: 'Отменено', progress: null });
  };

  const retryDownload = async (downloadId: string) => {
    await api(`/playlists/${pl.id}/downloads/${downloadId}/retry`, { method: 'POST' });
    patchDownload(downloadId, { status: 'PENDING', error: null, progress: null });
    setRev((n) => n + 1);
  };

  const retryAll = async () => {
    await api(`/playlists/${pl.id}/downloads/retry`, { method: 'POST' });
    setPl({
      ...pl,
      downloads: downloads.map((d) => (d.status === 'FAILED' ? { ...d, status: 'PENDING', error: null, progress: null } : d)),
    });
    setRev((n) => n + 1);
  };

  const dismissDownload = async (downloadId: string) => {
    await api(`/downloads/errors/${downloadId}`, { method: 'DELETE' });
    setPl({ ...pl, downloads: downloads.filter((d) => d.id !== downloadId) });
  };

  const dismissAll = async () => {
    await api('/downloads/errors', { method: 'DELETE' });
    setPl({ ...pl, downloads: downloads.filter((d) => d.status !== 'FAILED') });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {pl.isMine ? (
            <input
              className="w-full bg-transparent text-2xl font-bold outline-none focus:underline"
              defaultValue={pl.name}
              maxLength={100}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== pl.name) void patch({ name: v });
                else e.target.value = pl.name;
              }}
            />
          ) : (
            <h1 className="text-2xl font-bold">{pl.name}</h1>
          )}
          <p className="text-sm text-zinc-500">
            {pl.tracks.length} треков · {pl.owner}
            {active ? ` · загружается ${downloads.filter((d) => d.status === 'PENDING' || d.status === 'PROCESSING').length}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pl.isMine && failed.length > 0 && (
            <>
              <button className="btn" onClick={() => void retryAll()}>
                <RotateCcw size={14} /> Повторить ошибки
              </button>
              <button className="btn" onClick={() => void dismissAll()}>
                <Trash2 size={14} /> Очистить все
              </button>
            </>
          )}
          {pl.isMine && (
            <button className="btn btn-danger" onClick={remove}>
              <Trash2 size={14} /> Удалить
            </button>
          )}
          <button
            className="btn btn-primary"
            disabled={!pl.tracks.length}
            onClick={() => usePlayer.getState().playQueue(pl.tracks.map(trackToItem), 0)}
          >
            <Play size={16} fill="currentColor" /> Играть
          </button>
        </div>
      </div>

      {shown.length > 0 && (
        <ul className="card divide-y divide-white/5">
          {shown.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate">
                  {d.artist} — {d.title}
                </div>
                {d.status === 'PROCESSING' && (
                  <div className="mt-1.5 h-1 overflow-hidden rounded bg-zinc-800">
                    <div className="h-full bg-accent transition-all" style={{ width: `${d.progress ?? 0}%` }} />
                  </div>
                )}
              </div>
              <span
                className={
                  d.status === 'FAILED'
                    ? 'block max-w-64 truncate text-red-300'
                    : d.status === 'CANCELLED'
                      ? 'shrink-0 text-zinc-500'
                      : d.status === 'COMPLETED'
                        ? 'shrink-0 text-emerald-300'
                        : 'shrink-0 text-zinc-400'
                }
                title={d.error ?? undefined}
              >
                {d.status === 'PROCESSING' && d.progress != null ? `${d.progress}%` : d.status === 'FAILED' ? d.error || DOWNLOAD_LABEL.FAILED : DOWNLOAD_LABEL[d.status]}
              </span>
              {pl.isMine && (d.status === 'PENDING' || d.status === 'PROCESSING') && (
                <button className="btn shrink-0 !px-2 !py-1 text-xs" onClick={() => void cancelDownload(d.id)}>
                  <X size={14} /> Отменить
                </button>
              )}
              {pl.isMine && d.status === 'FAILED' && (
                <>
                  <button className="btn shrink-0 !px-2 !py-1 text-xs" onClick={() => void retryDownload(d.id)}>
                    <RotateCcw size={14} /> Повторить
                  </button>
                  <button className="btn shrink-0 !px-2 !py-1 text-xs" title="Скрыть" onClick={() => void dismissDownload(d.id)}>
                    <X size={14} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <TrackTable
        tracks={pl.tracks}
        onPlay={(i) => usePlayer.getState().playQueue(pl.tracks.map(trackToItem), i)}
        emptyText="Плейлист пуст. Добавляйте треки кнопкой «В плейлист» в библиотеке."
        renderExtra={
          pl.isMine
            ? (t) => (
                <button className="rounded p-1.5 text-zinc-500 hover:text-red-400" onClick={() => void removeTrack(t.id)} title="Убрать из плейлиста">
                  <X size={16} />
                </button>
              )
            : undefined
        }
      />
    </div>
  );
}