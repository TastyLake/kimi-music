'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Download, ExternalLink, Pause, Play, Youtube } from 'lucide-react';
import { Cover } from '@/components/Cover';
import { AlbumLink, ArtistLink } from '@/components/TrackMeta';
import { api, ApiError, resolveExternalSrc } from '@/lib/api';
import type { DiscoverMeta, DiscoverResponse, ExternalItem } from '@/lib/types';
import { cn, formatDuration, youtubeSearchUrl } from '@/lib/utils';
import { useAuth } from '@/store/auth';
import { usePlayer, type NewQueueItem } from '@/store/player';

type Tab = 'top' | 'genre';

const TABS: { id: Tab; label: string }[] = [
  { id: 'top', label: 'Топ-50 недели' },
  { id: 'genre', label: 'По жанрам' },
];

const DEFAULT_GENRES = [
  { tag: 'pop', label: 'Поп' },
  { tag: 'hip-hop', label: 'Хип-хоп / Рэп' },
  { tag: 'rock', label: 'Рок' },
  { tag: 'electronic', label: 'Электроника' },
  { tag: 'rnb', label: 'R&B' },
  { tag: 'indie', label: 'Инди' },
  { tag: 'dance', label: 'Танцевальная' },
  { tag: 'metal', label: 'Метал' },
];

const TONES: Record<string, string> = {
  'hip-hop': 'from-pink-600 to-rose-950',
  rock: 'from-rose-600 to-purple-950',
  electronic: 'from-fuchsia-600 to-pink-950',
  pop: 'from-pink-500 to-purple-900',
  metal: 'from-purple-800 to-pink-950',
  indie: 'from-pink-400 to-rose-900',
  rnb: 'from-rose-400 to-purple-900',
  dance: 'from-pink-500 to-rose-900',
};

const itemKey = (i: ExternalItem) => `${i.artist}|${i.title}`;

export default function BrowsePage() {
  const user = useAuth((s) => s.user);
  const canDownload = user?.role === 'ADMIN' || Boolean(user?.canUpload);
  const [meta, setMeta] = useState<DiscoverMeta | null>(null);
  const [tab, setTab] = useState<Tab>('top');
  const [genre, setGenre] = useState<string | null>(null);
  const [data, setData] = useState<DiscoverResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const reqId = useRef(0);

  const current = usePlayer((s) => s.queue[s.index]);
  const playing = usePlayer((s) => s.playing);

  useEffect(() => {
    api<DiscoverMeta>('/discover/meta')
      .then(setMeta)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (tab === 'genre' && !genre) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    setError(null);

    const fetchItunesFallback = async (genreTag?: string) => {
      const term = genreTag ? genreTag : 'top songs';
      const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=50`);
      const raw = await res.json();
      const items: ExternalItem[] = (raw.results || []).map((r: any) => ({
        artist: r.artistName,
        title: r.trackName,
        album: r.collectionName,
        coverUrl: r.artworkUrl100?.replace('100x100bb', '600x600bb'),
        previewUrl: r.previewUrl,
        externalUrl: r.trackViewUrl,
        source: 'lastfm' as const,
        local: null,
        downloadStatus: null,
      }));
      return { kind: tab === 'top' ? ('chart' as const) : ('genre' as const), source: 'lastfm' as const, items };
    };

    const path = tab === 'top' ? '/discover/charts' : `/discover/genre/${genre}`;

    api<DiscoverResponse>(path, { query: { limit: 50 } })
      .then((r) => {
        if (id !== reqId.current) return;
        if (!r.items || r.items.length === 0) {
          fetchItunesFallback(genre || undefined).then((res) => id === reqId.current && setData(res));
        } else {
          setData(r);
        }
      })
      .catch(async () => {
        if (id !== reqId.current) return;
        try {
          const fallbackData = await fetchItunesFallback(genre || undefined);
          if (id === reqId.current) setData(fallbackData);
        } catch (err) {
          if (id === reqId.current) setError('Не удалось подгрузить мировые чарты.');
        }
      })
      .finally(() => id === reqId.current && setLoading(false));
  }, [tab, genre]);

  const patchItem = (item: ExternalItem, p: Partial<ExternalItem>) =>
    setData((d) => d && { ...d, items: (d.items || []).map((i) => (itemKey(i) === itemKey(item) ? { ...i, ...p } : i)) });

  const play = async (item: ExternalItem) => {
    setHint(null);
    const player = usePlayer.getState();

    const isSamePreview = current?.kind === 'preview' && current.artist === item.artist && current.title === item.title;
    const isSameLocal = item.local && current?.kind === 'local' && current.id === item.local.trackId;

    if (isSamePreview || isSameLocal) {
      player.toggle();
      return;
    }

    if (item.local) {
      const q: NewQueueItem = {
        kind: 'local',
        id: item.local.trackId,
        title: item.title,
        artist: item.artist,
        album: item.album,
        coverUrl: item.local.coverUrl ?? item.coverUrl,
        duration: item.local.duration,
      };
      return player.playQueue([q]);
    }

    const src = await resolveExternalSrc(item.artist, item.title);
    player.playQueue([{
      kind: 'preview',
      title: item.title,
      artist: item.artist,
      album: item.album,
      coverUrl: item.coverUrl,
      src,
    }]);
  };

  const download = async (item: ExternalItem) => {
    setHint(null);
    if (!canDownload) {
      setHint('Загрузка в медиатеку доступна администратору и пользователям с правом загрузки.');
      return;
    }
    setBusy(itemKey(item));
    try {
      patchItem(item, { downloadStatus: 'PENDING' });
      const r = await api<{ status: 'PENDING' | 'PROCESSING' }>('/discover/download', {
        method: 'POST',
        body: {
          artist: item.artist.trim(),
          title: item.title.trim(),
          coverUrl: item.coverUrl ?? null,
          source: 'lastfm',
        },
      });
      patchItem(item, { downloadStatus: r.status });
      setHint(`«${item.title}» передан бэкенду в очередь на скачивание.`);
    } catch (e) {
      patchItem(item, { downloadStatus: null });
      if (e instanceof ApiError && e.code === 'already_local') setHint('Этот трек уже есть в вашей медиатеке.');
      else setHint((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const genresList = meta?.genres && meta.genres.length > 0 ? meta.genres : DEFAULT_GENRES;
  const genreLabel = genresList.find((g) => g.tag === genre)?.label ?? genre;
  const items = data?.items ?? [];
  const localCount = items.filter((i) => i.local).length;

  return (
    <div className="space-y-5 pb-20">
      <div>
        <h1 className="text-2xl font-bold bg-gradient-to-r from-pink-300 via-rose-300 to-purple-300 bg-clip-text text-transparent">Обзор популярного</h1>
        <p className="text-sm text-pink-300/60">
          Самые популярные мировые треки и жанровые топ-50. Треки из вашей медиатеки играют полностью, а новые можно моментально скачивать.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-2xl border border-pink-500/20 bg-pink-950/40 p-1.5 backdrop-blur-xl">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                if (t.id === 'top') setGenre(null);
              }}
              className={cn(
                'rounded-xl px-4 py-2 text-xs font-bold transition-all cursor-pointer',
                tab === t.id
                  ? 'bg-gradient-to-r from-pink-500 via-rose-400 to-purple-400 text-pink-950 shadow-md'
                  : 'text-pink-300/70 hover:text-pink-100'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'genre' && !genre && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {genresList.map((g) => (
            <button
              key={g.tag}
              type="button"
              onClick={() => setGenre(g.tag)}
              className={cn(
                'flex h-32 flex-col justify-end rounded-2xl bg-gradient-to-br p-4 text-left shadow-lg border border-pink-500/20 transition-transform hover:scale-[1.02] cursor-pointer',
                TONES[g.tag] ?? 'from-pink-900 to-purple-950'
              )}
            >
              <span className="text-lg font-bold text-pink-100">{g.label}</span>
              <span className="text-xs text-pink-300/70">Топ-50 {g.label}</span>
            </button>
          ))}
        </div>
      )}

      {tab === 'genre' && genre && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="flex items-center gap-2 rounded-xl border border-pink-500/20 bg-pink-950/40 px-3 py-1.5 text-xs font-semibold text-pink-200 hover:bg-pink-900/40 cursor-pointer"
            onClick={() => setGenre(null)}
          >
            <ArrowLeft size={16} /> Все жанры
          </button>
          <h2 className="text-xl font-bold text-pink-100">Топ-50: {genreLabel}</h2>
        </div>
      )}

      {data && (tab !== 'genre' || genre) && (
        <p className="text-xs text-pink-300/50">
          {tab === 'top' ? 'Главный мировой Топ-50 треков за неделю' : `Топ-50 жанра «${genreLabel}»`}
          {' · '}в вашей медиатеке: {localCount} из {items.length}
        </p>
      )}
      {hint && <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">{hint}</div>}
      {error && <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">{error}</div>}

      {(tab !== 'genre' || genre) && (
        <div className={cn('rounded-2xl border border-pink-500/15 bg-pink-950/20 backdrop-blur-md overflow-hidden divide-y divide-pink-500/10', loading && 'opacity-60')}>
          {loading && <div className="px-6 py-12 text-center text-xs text-pink-300/50">Загрузка самых популярных треков…</div>}

          {!loading && items.map((item, i) => {
            const k = itemKey(item);
            const isCurrent = item.local
              ? current?.kind === 'local' && current.id === item.local.trackId
              : current?.kind === 'preview' && current.src === item.previewUrl;
            const queued = item.downloadStatus === 'PENDING' || item.downloadStatus === 'PROCESSING';
            return (
              <div key={`${k}-${i}`} className="flex items-center gap-3 px-4 py-3 hover:bg-pink-900/20 transition-colors">
                <span className="w-6 text-right text-xs font-semibold tabular-nums text-pink-400/40">{i + 1}</span>
                <button type="button" className="relative shrink-0 cursor-pointer group" onClick={() => void play(item)} disabled={busy === k} aria-label="Играть">
                  <Cover url={item.local?.coverUrl ?? item.coverUrl} title={item.title} size={44} className="rounded-xl shadow-md" />
                  <span className={cn(
                    "absolute inset-0 flex items-center justify-center rounded-xl bg-pink-950/60 transition-opacity",
                    isCurrent ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  )}>
                    {isCurrent && playing ? <Pause size={18} fill="white" /> : <Play size={18} fill="white" />}
                  </span>
                </button>
                <div className="min-w-0 flex-1">
                  <div className={cn('truncate text-sm font-semibold', isCurrent ? 'text-pink-300' : 'text-pink-100')}>{item.title}</div>
                  <div className="truncate text-xs text-pink-300/60">
                    <ArtistLink name={item.artist} />
                    {item.album ? (
                      <>
                        <span className="px-1 text-pink-300/35">·</span>
                        <AlbumLink artist={item.artist} album={item.album} />
                      </>
                    ) : null}
                  </div>
                </div>

                {item.local ? (
                  <span className="hidden shrink-0 items-center gap-1 rounded-xl bg-pink-500/20 border border-pink-400/30 px-3 py-1 text-xs text-pink-200 sm:flex font-medium">
                    <Check size={14} /> В медиатеке{item.local.duration ? ` · ${formatDuration(item.local.duration)}` : ''}
                  </span>
                ) : (
                  <div className="flex items-center gap-1">
                    <a
                      className="rounded-xl p-2 text-pink-300/50 hover:text-pink-100 hover:bg-pink-900/30 transition-colors"
                      href={youtubeSearchUrl(item.artist, item.title)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Искать на YouTube"
                    >
                      <Youtube size={16} />
                    </a>
                    {item.externalUrl && (
                      <a
                        className="rounded-xl p-2 text-pink-300/50 hover:text-pink-100 hover:bg-pink-900/30 transition-colors"
                        href={item.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Открыть в оригинале"
                      >
                        <ExternalLink size={16} />
                      </a>
                    )}
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-pink-400/40 px-3 py-1.5 text-xs font-semibold text-pink-100 hover:bg-pink-500/20"
                      onClick={() => void play(item)}
                    >
                      <Play size={14} fill="currentColor" /> Слушать
                    </button>
                    {queued ? (
                      <span className="shrink-0 rounded-xl bg-pink-900/40 px-3 py-1.5 text-xs font-semibold text-pink-300 border border-pink-500/20">
                        {item.downloadStatus === 'PROCESSING' ? 'Скачивается' : 'В очереди'}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-pink-500 via-rose-400 to-purple-400 px-3 py-1.5 text-xs font-bold text-pink-950 shadow-md hover:opacity-95 cursor-pointer"
                        onClick={() => void download(item)}
                        disabled={busy === k}
                      >
                        <Download size={14} /> В медиатеку
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}