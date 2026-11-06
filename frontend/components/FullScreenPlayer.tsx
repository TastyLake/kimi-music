'use client';

import { useState, useEffect } from 'react';
import {
  Heart,
  Pause,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  X,
  ListMusic,
} from 'lucide-react';
import { Cover } from '@/components/Cover';
import { usePlayer } from '@/store/player';
import { cn, formatDuration } from '@/lib/utils';

interface FullScreenPlayerProps {
  open: boolean;
  onClose: () => void;
}

export function FullScreenPlayer({ open, onClose }: FullScreenPlayerProps) {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const playing = usePlayer((s) => s.playing);
  const toggle = usePlayer((s) => s.toggle);
  const next = usePlayer((s) => s.next);
  const prev = usePlayer((s) => s.prev);
  const playQueue = usePlayer((s) => s.playQueue);

  const current = queue[index];

  const [showQueueSidebar, setShowQueueSidebar] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [trackDuration, setTrackDuration] = useState(0);
  const [isRepeating, setIsRepeating] = useState(false);
  const [isShuffling, setIsShuffling] = useState(false);

  // Синхронизация времени воспроизведения из аудиоэлемента
  useEffect(() => {
    const audio = document.querySelector('audio');
    if (!audio) return;

    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => setTrackDuration(audio.duration || 0);

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);

    setCurrentTime(audio.currentTime);
    setTrackDuration(audio.duration || 0);

    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
    };
  }, [open, current]);

  if (!open || !current) return null;

  return (
    <div className="fixed inset-0 z-50 flex bg-pink-950/95 backdrop-blur-2xl text-pink-100 animate-in fade-in duration-200">
      {/* Размытый фон из обложки текущего трека */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-20">
        <Cover url={current.coverUrl} title={current.title} size={1200} className="w-full h-full object-cover blur-3xl scale-125" />
      </div>

      {/* Основная часть плеера (слева/по центру) */}
      <div className="relative flex-1 flex flex-col justify-between p-8 z-10 max-w-5xl mx-auto">
        {/* Верхняя панель */}
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-widest text-pink-300/60 font-semibold">
            Сейчас играет
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowQueueSidebar(!showQueueSidebar)}
              className={cn(
                'flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer',
                showQueueSidebar ? 'border-pink-400 bg-pink-500/20 text-pink-200' : 'border-pink-500/20 bg-pink-900/30 text-pink-300'
              )}
            >
              <ListMusic size={16} /> Очередь
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-pink-500/20 bg-pink-900/30 p-2 text-pink-300 hover:text-white hover:bg-pink-800/40 cursor-pointer transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Центр: Большая обложка и информация о треке */}
        <div className="flex flex-col items-center justify-center my-auto py-4 space-y-6">
          <div className="relative group shadow-2xl rounded-3xl overflow-hidden border border-pink-500/20 w-72 h-72 sm:w-96 sm:h-96">
            <Cover url={current.coverUrl} title={current.title} size={500} className="w-full h-full object-cover" />
          </div>

          <div className="text-center space-y-1 max-w-md">
            <h2 className="text-2xl font-bold truncate text-pink-100">{current.title}</h2>
            <p className="text-sm text-pink-300/70 truncate">{current.artist}</p>
          </div>
        </div>

        {/* Нижняя панель управления */}
        <div className="space-y-4 max-w-2xl mx-auto w-full pb-4">
          {/* Ползунок прогресса */}
          <div className="space-y-1">
            <div
              className="relative h-2 w-full cursor-pointer rounded-full bg-pink-950/60 border border-pink-500/20 overflow-hidden group"
              onClick={(e) => {
                const audio = document.querySelector('audio');
                if (!audio || !trackDuration) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const pos = (e.clientX - rect.left) / rect.width;
                audio.currentTime = pos * trackDuration;
              }}
            >
              <div
                className="absolute left-0 top-0 h-full bg-gradient-to-r from-pink-500 via-rose-400 to-purple-400 rounded-full"
                style={{ width: `${(currentTime / (trackDuration || 1)) * 100}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-pink-300/60 tabular-nums">
              <span>{formatDuration(currentTime)}</span>
              <span>{formatDuration(trackDuration)}</span>
            </div>
          </div>

          {/* Кнопки плеера */}
          <div className="flex items-center justify-center gap-6">
            <button
              type="button"
              onClick={() => setIsShuffling(!isShuffling)}
              className={cn(
                'p-2 transition-colors cursor-pointer',
                isShuffling ? 'text-pink-400' : 'text-pink-300/40 hover:text-pink-200'
              )}
            >
              <Shuffle size={18} />
            </button>
            <button
              type="button"
              onClick={() => prev()}
              className="p-2 text-pink-200 hover:text-white transition-colors cursor-pointer"
            >
              <SkipBack size={24} fill="currentColor" />
            </button>
            <button
              type="button"
              onClick={() => toggle()}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-r from-pink-500 via-rose-400 to-purple-400 text-pink-950 shadow-lg hover:scale-105 transition-transform cursor-pointer"
            >
              {playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-0.5" />}
            </button>
            <button
              type="button"
              onClick={() => next()}
              className="p-2 text-pink-200 hover:text-white transition-colors cursor-pointer"
            >
              <SkipForward size={24} fill="currentColor" />
            </button>
            <button
              type="button"
              onClick={() => setIsRepeating(!isRepeating)}
              className={cn(
                'p-2 transition-colors cursor-pointer',
                isRepeating ? 'text-pink-400' : 'text-pink-300/40 hover:text-pink-200'
              )}
            >
              <Repeat size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* Правая панель: Очередь воспроизведения */}
      {showQueueSidebar && (
        <div className="w-80 border-l border-pink-500/20 bg-pink-950/80 backdrop-blur-xl flex flex-col z-20 shadow-2xl">
          <div className="p-4 border-b border-pink-500/15 flex items-center justify-between">
            <h3 className="text-sm font-bold text-pink-100">Очередь воспроизведения</h3>
            <span className="text-xs text-pink-300/50">{queue.length} треков</span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1 divide-y divide-pink-500/10">
            {queue.map((track, i) => {
              const isCurrent = i === index;
              return (
                <div
                  key={`${track.id}-${i}`}
                  onClick={() => playQueue(queue, i)}
                  className={cn(
                    'flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-colors group',
                    isCurrent ? 'bg-pink-500/20 border border-pink-500/30' : 'hover:bg-pink-900/30'
                  )}
                >
                  <Cover url={track.coverUrl} title={track.title} size={36} className="rounded-lg shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className={cn('truncate text-xs font-semibold', isCurrent ? 'text-pink-300' : 'text-pink-100')}>
                      {track.title}
                    </div>
                    <div className="truncate text-[11px] text-pink-300/60">{track.artist}</div>
                  </div>
                  <span className="text-[11px] tabular-nums text-pink-300/40">{formatDuration(track.duration)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}