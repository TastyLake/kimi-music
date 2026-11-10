'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  MoreVertical,
  Pause,
  Play,
  Plus,
  Shuffle,
  Trash2,
  X,
} from 'lucide-react';
import { Cover } from '@/components/Cover';
import { ArtistLink, AlbumLink } from '@/components/TrackMeta';
import { api } from '@/lib/api';
import type { Track } from '@/lib/types';
import { cn, formatDuration } from '@/lib/utils';
import { useAuth } from '@/store/auth';
import { shuffleList, trackToItem, usePlayer } from '@/store/player';

interface Playlist {
  id: string;
  name: string;
  description?: string | null;
  trackCount?: number;
}

type SortOption = 'recent' | 'title' | 'artist' | 'year';

export default function LibraryPage() {
  const user = useAuth((s) => s.user);
  const canManage = user?.role === 'ADMIN' || Boolean(user?.canUpload);

  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);

  // Фильтры и поиск
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortOption>('recent');

  // Мультивыбор
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Контекстное меню для отдельного трека
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // Модальные окна
  const [addToPlaylistTrackIds, setAddToPlaylistTrackIds] = useState<string[] | null>(null);
  const [deleteTrackIds, setDeleteTrackIds] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const current = usePlayer((s) => s.queue[s.index]);
  const playing = usePlayer((s) => s.playing);

  const loadData = async () => {
    try {
      const [tRes, pRes] = await Promise.all([
        api<{ items: Track[] }>('/tracks'),
        api<{ items: Playlist[] }>('/playlists').catch(() => ({ items: [] })),
      ]);
      setTracks(tRes.items || []);
      setPlaylists(pRes.items || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  // Закрываем контекстное меню при клике вне его
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    return tracks
      .filter((t) => {
        const q = query.toLowerCase().trim();
        return !q || t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        if (sort === 'title') return a.title.localeCompare(b.title);
        if (sort === 'artist') return a.artist.localeCompare(b.artist);
        if (sort === 'year') return (b.year ?? 0) - (a.year ?? 0);
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [tracks, query, sort]);

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((t) => t.id)));
    }
  };

  const playTrack = (track: Track) => {
    const player = usePlayer.getState();
    if (current?.kind === 'local' && current.id === track.id) {
      player.toggle();
      return;
    }
    const playerShuffle = player.shuffle && filtered.length > 1;
    const ordered = playerShuffle
      ? [track, ...shuffleList(filtered.filter((t) => t.id !== track.id))]
      : filtered;
    const queueItems = ordered.map(trackToItem);
    const index = playerShuffle ? 0 : Math.max(filtered.findIndex((t) => t.id === track.id), 0);
    player.playQueue(queueItems, index);
  };

  const playShuffle = () => {
    if (filtered.length === 0) return;
    const queueItems = shuffleList(filtered).map(trackToItem);
    usePlayer.getState().playQueue(queueItems, 0);
    usePlayer.setState({ shuffle: true });
  };

  const handleDelete = async () => {
    if (!deleteTrackIds || deleteTrackIds.length === 0) return;
    setBusy(true);
    try {
      await Promise.all(
        deleteTrackIds.map((id) => api(`/tracks/${id}`, { method: 'DELETE' }))
      );
      setTracks((prev) => prev.filter((t) => !deleteTrackIds.includes(t.id)));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        deleteTrackIds.forEach((id) => next.delete(id));
        return next;
      });
      setDeleteTrackIds(null);
    } catch (e) {
      alert(`Ошибка при удалении: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleAddToPlaylist = async (playlistId: string) => {
    if (!addToPlaylistTrackIds || addToPlaylistTrackIds.length === 0) return;
    setBusy(true);
    try {
      await Promise.all(
        addToPlaylistTrackIds.map((trackId) =>
          api(`/playlists/${playlistId}/tracks`, {
            method: 'POST',
            body: { trackId },
          })
        )
      );
      setAddToPlaylistTrackIds(null);
    } catch (e) {
      alert(`Ошибка добавления в плейлист: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 pb-24">
      {/* Шапка */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-pink-300 via-rose-300 to-purple-300 bg-clip-text text-transparent">
            Библиотека
          </h1>
          <p className="text-xs text-pink-300/60">{tracks.length} треков</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setSelecting(!selecting);
              setSelectedIds(new Set());
            }}
            className={cn(
              'rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer',
              selecting
                ? 'border-pink-400 bg-pink-500/20 text-pink-200'
                : 'border-pink-500/20 bg-pink-950/40 text-pink-300 hover:text-pink-100'
            )}
          >
            {selecting ? 'Отменить выбор' : 'Выбрать несколько'}
          </button>

          <button
            type="button"
            onClick={playShuffle}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-pink-500 via-rose-400 to-purple-400 px-4 py-1.5 text-xs font-bold text-pink-950 shadow-md hover:opacity-95 cursor-pointer"
          >
            <Shuffle size={14} /> Играть вперемешку
          </button>
        </div>
      </div>

      {/* Панель массовых действий */}
      {selecting && selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center justify-between rounded-2xl border border-pink-500/30 bg-pink-950/60 p-3 text-xs backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleSelectAll}
              className="text-pink-300 hover:text-pink-100 underline cursor-pointer"
            >
              {selectedIds.size === filtered.length ? 'Снять выделение' : 'Выбрать все'}
            </button>
            <span className="text-pink-200 font-semibold">
              Выбрано: {selectedIds.size}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAddToPlaylistTrackIds(Array.from(selectedIds))}
              className="flex items-center gap-1 rounded-xl border border-pink-500/30 bg-pink-900/40 px-3 py-1 text-pink-200 hover:bg-pink-800/40 cursor-pointer"
            >
              <Plus size={14} /> В плейлист
            </button>
            {canManage && (
              <button
                type="button"
                onClick={() => setDeleteTrackIds(Array.from(selectedIds))}
                className="flex items-center gap-1 rounded-xl bg-rose-600/80 px-3 py-1 font-semibold text-white hover:bg-rose-500 cursor-pointer"
              >
                <Trash2 size={14} /> Удалить
              </button>
            )}
          </div>
        </div>
      )}

      {/* Фильтры и поиск */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Поиск по исполнителю и названию..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-[220px] flex-1 rounded-2xl border border-pink-500/20 bg-pink-950/40 px-4 py-2 text-xs text-pink-100 placeholder-pink-400/40 outline-none focus:border-pink-400"
        />

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOption)}
          className="rounded-2xl border border-pink-500/20 bg-pink-950/60 px-3 py-2 text-xs font-semibold text-pink-100 outline-none cursor-pointer"
        >
          <option value="recent" className="bg-pink-950">
            Недавно добавленные
          </option>
          <option value="title" className="bg-pink-950">
            По названию
          </option>
          <option value="artist" className="bg-pink-950">
            По исполнителю
          </option>
          <option value="year" className="bg-pink-950">
            По году
          </option>
        </select>
      </div>

      {/* Список треков */}
      <div className="rounded-2xl border border-pink-500/15 bg-pink-950/20 backdrop-blur-md overflow-visible divide-y divide-pink-500/10">
        {loading && (
          <div className="px-6 py-12 text-center text-xs text-pink-300/50">
            Загрузка медиатеки...
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="px-6 py-12 text-center text-xs text-pink-300/50">
            Треки не найдены
          </div>
        )}

        {!loading &&
          filtered.map((track, i) => {
            const isCurrent = current?.kind === 'local' && current.id === track.id;
            const isSelected = selectedIds.has(track.id);
            const isMenuOpen = activeMenuId === track.id;

            return (
              <div
                key={track.id}
                className={cn(
                  'relative flex items-center gap-3 px-4 py-2.5 hover:bg-pink-900/20 transition-colors group',
                  isSelected && 'bg-pink-500/10'
                )}
              >
                {/* Чекбокс мультивыбора */}
                {selecting ? (
                  <button
                    type="button"
                    onClick={() => toggleSelect(track.id)}
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-lg border transition-colors cursor-pointer',
                      isSelected
                        ? 'border-pink-400 bg-pink-500 text-pink-950'
                        : 'border-pink-500/30 bg-pink-950/40'
                    )}
                  >
                    {isSelected && <Check size={12} strokeWidth={3} />}
                  </button>
                ) : (
                  <span className="w-6 text-right text-xs font-semibold tabular-nums text-pink-400/40">
                    {i + 1}
                  </span>
                )}

                {/* Постер / Play */}
                <button
                  type="button"
                  onClick={() => playTrack(track)}
                  className="relative shrink-0 cursor-pointer group/cover"
                >
                  <Cover
                    url={track.coverUrl}
                    title={track.title}
                    size={40}
                    className="rounded-xl shadow-md"
                  />
                  <span
                    className={cn(
                      'absolute inset-0 flex items-center justify-center rounded-xl bg-pink-950/60 transition-opacity',
                      isCurrent ? 'opacity-100' : 'opacity-0 group-hover/cover:opacity-100'
                    )}
                  >
                    {isCurrent && playing ? (
                      <Pause size={16} fill="white" />
                    ) : (
                      <Play size={16} fill="white" />
                    )}
                  </span>
                </button>

                {/* Название и Артист */}
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      'truncate text-sm font-semibold',
                      isCurrent ? 'text-pink-300' : 'text-pink-100'
                    )}
                  >
                    {track.title}
                  </div>
                  <div className="truncate text-xs text-pink-300/60">
                    <ArtistLink name={track.artist} />
                    {track.album ? (
                      <>
                        <span className="px-1 text-pink-300/35">·</span>
                        <AlbumLink artist={track.artist} album={track.album} />
                      </>
                    ) : null}
                  </div>
                </div>

                {/* Длительность */}
                <span className="w-12 text-right text-xs tabular-nums text-pink-300/50">
                  {formatDuration(track.duration)}
                </span>

                {/* Меню трех точек */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setActiveMenuId(isMenuOpen ? null : track.id)}
                    className="rounded-lg p-1.5 text-pink-300/40 hover:text-pink-100 hover:bg-pink-900/30 transition-colors cursor-pointer"
                  >
                    <MoreVertical size={16} />
                  </button>

                  {isMenuOpen && (
                    <div
                      ref={menuRef}
                      className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-xl border border-pink-500/20 bg-pink-950/95 p-1.5 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setActiveMenuId(null);
                          setAddToPlaylistTrackIds([track.id]);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-pink-200 hover:bg-pink-900/40 transition-colors cursor-pointer text-left"
                      >
                        <Plus size={14} /> Добавить в плейлист
                      </button>

                      {canManage && (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveMenuId(null);
                            setDeleteTrackIds([track.id]);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-950/40 transition-colors cursor-pointer text-left"
                        >
                          <Trash2 size={14} /> Удалить из медиатеки
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
      </div>

      {/* Модальное окно "Добавить в плейлист" */}
      {Boolean(addToPlaylistTrackIds) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-pink-500/20 bg-pink-950/90 p-5 shadow-2xl backdrop-blur-xl space-y-4">
            <div className="flex items-center justify-between border-b border-pink-500/15 pb-3">
              <h3 className="text-base font-bold text-pink-100">Добавить в плейлист</h3>
              <button
                type="button"
                onClick={() => setAddToPlaylistTrackIds(null)}
                className="text-pink-300/50 hover:text-pink-100 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
              {playlists.length === 0 ? (
                <p className="text-xs text-pink-300/60 py-4 text-center">
                  У вас пока нет созданных плейлистов.
                </p>
              ) : (
                playlists.map((pl) => (
                  <button
                    key={pl.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void handleAddToPlaylist(pl.id)}
                    className="flex w-full items-center justify-between rounded-xl border border-pink-500/20 bg-pink-950/40 px-4 py-3 text-left hover:bg-pink-900/40 transition-colors cursor-pointer"
                  >
                    <div>
                      <div className="text-sm font-semibold text-pink-100">
                        {pl.name}
                      </div>
                      <div className="text-xs text-pink-300/50">
                        {pl.trackCount ?? 0} треков
                      </div>
                    </div>
                    <Plus size={16} className="text-pink-400" />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно подтверждения удаления */}
      {Boolean(deleteTrackIds) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-rose-500/20 bg-pink-950/90 p-5 shadow-2xl backdrop-blur-xl space-y-4">
            <div className="flex items-center justify-between border-b border-pink-500/15 pb-3">
              <h3 className="text-base font-bold text-rose-200">Удалить из медиатеки?</h3>
              <button
                type="button"
                onClick={() => setDeleteTrackIds(null)}
                className="text-pink-300/50 hover:text-pink-100 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-sm text-pink-200">
              Вы действительно хотите удалить {deleteTrackIds?.length} трек(ов) из вашей медиатеки? Файлы будут удалены с сервера.
            </p>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTrackIds(null)}
                className="rounded-xl border border-pink-500/20 bg-pink-950/40 px-4 py-2 text-xs font-semibold text-pink-300 hover:bg-pink-900/40 cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleDelete()}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-500 cursor-pointer"
              >
                {busy ? 'Удаление...' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}