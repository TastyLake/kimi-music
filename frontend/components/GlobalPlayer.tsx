'use client';

import { useEffect, useRef, useState } from 'react';
import { ListMusic, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Trash2, Volume2, VolumeX, X, Maximize2 } from 'lucide-react';
import { api, assetUrl, refreshStreamToken, streamUrl } from '@/lib/api';
import { cn, formatDuration } from '@/lib/utils';
import { externalStreamUrl } from '@/lib/api';
import { audioRef, usePlayer } from '@/store/player';
import { Cover } from './Cover';
import { AlbumLink, ArtistLink, TrackMeta } from './TrackMeta';
import { FullScreenPlayer } from './FullScreenPlayer'; // Импортируем наш полноэкранный плеер

function onPlayError(e: unknown) {
  if ((e as Error)?.name !== 'AbortError') usePlayer.getState()._setPlaying(false);
}

function absoluteArtwork(url: string | null | undefined): string | undefined {
  const resolved = assetUrl(url);
  if (!resolved) return undefined;
  if (/^https?:\/\//.test(resolved)) return resolved;
  if (typeof window === 'undefined') return undefined;
  return new URL(resolved, window.location.origin).href;
}

/** Кнопки «предыдущий / следующий» в шторке и на заблокированном экране iPhone. */
function syncMediaSession() {
  const session = navigator.mediaSession;
  if (!session) return;
  const state = usePlayer.getState();
  const current = state.queue[state.index];
  if (!current) {
    session.metadata = null;
    session.playbackState = 'none';
    return;
  }

  const artwork = absoluteArtwork(current.coverUrl);
  session.metadata = new MediaMetadata({
    title: current.title,
    artist: current.artist,
    album: current.album ?? '',
    artwork: artwork
      ? [96, 128, 192, 256, 384, 512].map((size) => ({ src: artwork, sizes: `${size}x${size}`, type: 'image/jpeg' }))
      : [],
  });
  session.playbackState = state.playing ? 'playing' : 'paused';

  const bind = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
    try {
      session.setActionHandler(action, handler);
    } catch {
      /* это действие браузер не показывает */
    }
  };
  bind('play', () => usePlayer.getState()._setPlaying(true));
  bind('pause', () => usePlayer.getState()._setPlaying(false));
  bind('previoustrack', () => usePlayer.getState().prev());
  bind('nexttrack', () => usePlayer.getState().next(false));
  bind('seekto', (details) => {
    if (details.seekTime != null) usePlayer.getState().seek(details.seekTime);
  });
  // Без этих обработчиков iPhone оставляет только «±30 секунд» и прячет смену трека.
  bind('seekbackward', null);
  bind('seekforward', null);

  const length = state.duration || current.duration || 0;
  if (Number.isFinite(length) && length > 0 && Number.isFinite(state.currentTime)) {
    try {
      session.setPositionState({
        duration: length,
        playbackRate: audioRef.current?.playbackRate || 1,
        position: Math.min(Math.max(state.currentTime, 0), length),
      });
    } catch {
      /* поток ещё без длительности */
    }
  }
}

export function GlobalPlayer() {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const playing = usePlayer((s) => s.playing);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const currentTime = usePlayer((s) => s.currentTime);
  const duration = usePlayer((s) => s.duration);
  const queueOpen = usePlayer((s) => s.queueOpen);
  const error = usePlayer((s) => s.error);
  const p = usePlayer.getState;

  const current = queue[index];
  const switching = useRef(false);
  const retried = useRef<string | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  
  // Состояние для открытия полноэкранного плеера
  const [fullScreenOpen, setFullScreenOpen] = useState(false);

  useEffect(() => {
    if (current?.kind === 'local' && current.id) {
      void api('/plays', { method: 'POST', body: { trackId: current.id } }).catch(() => undefined);
    }
  }, [current?.key]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (!current) {
      a.pause();
      a.removeAttribute('src');
      a.load();
      return;
    }
    switching.current = true;
    a.src = current.kind === 'local' ? streamUrl(current.id!) : current.src!;
    if (usePlayer.getState().playing) a.play().catch(onPlayError);
  }, [current?.key]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a || !current) return;
    if (playing && a.paused) a.play().catch(onPlayError);
    else if (!playing && !a.paused) a.pause();
  }, [playing]);

  useEffect(() => {
    const a = audioRef.current;
    if (a) {
      a.volume = volume;
      a.muted = muted;
    }
  }, [volume, muted]);

  useEffect(() => {
    syncMediaSession();
  }, [current?.key, current?.title, current?.artist, current?.coverUrl, playing, currentTime, duration]);

  const dur = duration || current?.duration || 0;
  const shown = scrub ?? currentTime;
  const commitScrub = () => {
    if (scrub !== null) {
      p().seek(scrub);
      setScrub(null);
    }
  };

  return (
    <>
      <audio
        ref={(el) => {
          audioRef.current = el;
        }}
        preload="auto"
        title={current ? `${current.artist} — ${current.title}` : undefined}
        onTimeUpdate={(e) => p()._tick(e.currentTarget.currentTime, e.currentTarget.duration)}
        onLoadedMetadata={(e) => p()._tick(e.currentTarget.currentTime, e.currentTarget.duration)}
        onPlaying={() => {
          switching.current = false;
          p()._setPlaying(true);
          if (usePlayer.getState().error) p()._setError(null);
        }}
        onPlay={() => {
          p()._setPlaying(true);
          syncMediaSession();
        }}
        onPause={(e) => {
          if (!e.currentTarget.ended && !switching.current) p()._setPlaying(false);
        }}
        onEnded={() => p().next(true)}
        onError={() => {
          const state = usePlayer.getState();
          const cur = state.queue[state.index];
          if (!cur || cur.kind !== 'preview' || !cur.src || cur.src.includes('/external/stream')) return;
          const fallback = externalStreamUrl(cur.artist, cur.title);
          if (cur.src === fallback) return;
          const queue = state.queue.map((item, i) => (i === state.index && item.kind === 'preview' ? { ...item, src: fallback } : item));
          usePlayer.setState({ queue });
          const el = audioRef.current;
          if (!el) return;
          el.src = fallback;
          void el.play().catch(() => p()._setError('Не удалось открыть поток'));
        }}
      />

      {/* Очередь воспроизведения (выпадающая панель) */}
      {queueOpen && (
        <div className="fixed bottom-[96px] right-4 z-40 flex max-h-[60vh] w-[calc(100%-2rem)] max-w-md flex-col rounded-3xl border border-pink-500/20 bg-pink-950/90 p-4 shadow-2xl backdrop-blur-2xl">
          <div className="flex items-center justify-between border-b border-pink-500/10 pb-3">
            <h3 className="text-sm font-bold text-pink-100">Очередь воспроизведения · {queue.length}</h3>
            <div className="flex gap-2">
              <button className="rounded-xl bg-pink-900/30 px-3 py-1.5 text-xs font-medium text-pink-300 hover:bg-pink-800/40" onClick={() => p().clear()}>
                Очистить
              </button>
              <button className="rounded-xl bg-pink-900/30 p-1.5 text-pink-300 hover:bg-pink-800/40" onClick={() => p().setQueueOpen(false)}>
                <X size={16} />
              </button>
            </div>
          </div>
          <ul className="overflow-y-auto divide-y divide-pink-500/5 py-2">
            {queue.map((item, i) => (
              <li
                key={item.key}
                className={cn('flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-pink-900/30', i === index && 'bg-pink-500/20')}
                onClick={() => p().jumpTo(i)}
              >
                <Cover url={item.coverUrl} title={item.title} size={36} />
                <div className="min-w-0 flex-1">
                <TrackMeta
                  title={item.title}
                  artist={item.artist}
                  album={item.album}
                  titleClassName={cn('text-sm font-medium', i === index ? 'text-pink-200' : 'text-pink-100/80')}
                  metaClassName="text-xs text-pink-300/50"
                />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Нижняя панель плеера */}
      <div className="fixed inset-x-0 bottom-0 z-30 h-[88px] border-t border-pink-500/20 bg-pink-950/80 backdrop-blur-2xl">
        {current ? (
          <div className="mx-auto grid h-full max-w-[1600px] grid-cols-[1fr_auto] items-center gap-4 px-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 items-center gap-3">
              {/* Кликабельная обложка с иконкой развертывания */}
              <div 
                className="relative group cursor-pointer transition-transform hover:scale-105 overflow-hidden rounded-xl shadow-lg" 
                onClick={() => setFullScreenOpen(true)}
                title="Развернуть во весь экран"
              >
                <Cover url={current.coverUrl} title={current.title} size={52} />
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Maximize2 size={18} className="text-white" />
                </div>
              </div>

              <div className="min-w-0">
                <button type="button" className="block max-w-full truncate text-left text-sm font-semibold text-pink-100 hover:underline" onClick={() => setFullScreenOpen(true)}>
                  {current.title}
                </button>
                <div className="truncate text-xs text-pink-300/60">
                  <ArtistLink name={current.artist} />
                  {current.album ? (
                    <>
                      <span className="px-1 text-pink-300/35">·</span>
                      <AlbumLink artist={current.artist} album={current.album} />
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center gap-1.5">
              <div className="flex items-center gap-4">
                <button
                  className={cn('hidden rounded-xl p-2 transition-colors sm:block', shuffle ? 'text-pink-300 bg-pink-500/20' : 'text-pink-300/50 hover:text-pink-200')}
                  onClick={() => p().toggleShuffle()}
                >
                  <Shuffle size={18} />
                </button>
                <button className="rounded-xl p-2 text-pink-200 hover:bg-pink-900/30 transition-colors" onClick={() => p().prev()}>
                  <SkipBack size={20} />
                </button>
                <button
                  className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-tr from-pink-500 via-rose-400 to-purple-400 text-pink-950 shadow-lg shadow-pink-500/30 transition-transform hover:scale-105 active:scale-95"
                  onClick={() => p().toggle()}
                  aria-label={playing ? 'Пауза' : 'Играть'}
                >
                  {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-0.5" />}
                </button>
                <button className="rounded-xl p-2 text-pink-200 hover:bg-pink-900/30 transition-colors" onClick={() => p().next()}>
                  <SkipForward size={20} />
                </button>
                <button
                  className={cn('hidden rounded-xl p-2 transition-colors sm:block', repeat !== 'off' ? 'text-pink-300 bg-pink-500/20' : 'text-pink-300/50 hover:text-pink-200')}
                  onClick={() => p().cycleRepeat()}
                >
                  {repeat === 'one' ? <Repeat1 size={18} /> : <Repeat size={18} />}
                </button>
              </div>
              <div className="hidden w-full items-center gap-3 text-xs tabular-nums text-pink-300/60 md:flex">
                <span className="w-10 text-right">{formatDuration(shown)}</span>
                <input
                  type="range"
                  className="h-1.5 flex-1 cursor-pointer accent-pink-400 rounded-lg bg-pink-950/60"
                  min={0}
                  max={dur || 1}
                  step={0.5}
                  value={Math.min(shown, dur || 1)}
                  onChange={(e) => setScrub(Number(e.target.value))}
                  onPointerUp={commitScrub}
                  onKeyUp={commitScrub}
                  onBlur={commitScrub}
                />
                <span className="w-10">{formatDuration(dur)}</span>
              </div>
            </div>

            <div className="hidden items-center justify-end gap-3 md:flex">
              <button
                className={cn('rounded-xl p-2 transition-colors', queueOpen ? 'bg-pink-500/20 text-pink-200' : 'text-pink-300/60 hover:text-pink-200')}
                onClick={() => p().setQueueOpen(!queueOpen)}
                title="Очередь"
              >
                <ListMusic size={20} />
              </button>
              <button className="rounded-xl p-2 text-pink-300/60 hover:text-pink-200 transition-colors" onClick={() => p().toggleMute()}>
                {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <input
                type="range"
                className="h-1.5 w-24 cursor-pointer accent-pink-400 rounded-lg bg-pink-950/60"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={(e) => p().setVolume(Number(e.target.value))}
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm font-medium text-pink-300/50">Выберите трек для воспроизведения</div>
        )}
      </div>

      {/* Рендерим полноэкранный плеер */}
      <FullScreenPlayer open={fullScreenOpen} onClose={() => setFullScreenOpen(false)} />
    </>
  );
}