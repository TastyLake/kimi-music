'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Track } from '@/lib/types';

export interface QueueItem {
  key: string;
  kind: 'local' | 'preview';
  /** id трека в нашей библиотеке (для kind = local) */
  id?: string;
  title: string;
  artist: string;
  coverUrl?: string | null;
  duration?: number;
  /** прямой URL (для превью) */
  src?: string;
}

export type NewQueueItem = Omit<QueueItem, 'key'>;
export type RepeatMode = 'off' | 'all' | 'one';

/** <audio> живёт в GlobalPlayer, а стор управляет им через эту ссылку. */
export const audioRef: { current: HTMLAudioElement | null } = { current: null };

let seq = 0;
const nextKey = () => `q${++seq}`;
const withKey = (i: NewQueueItem): QueueItem => ({ ...i, key: nextKey() });

export function trackToItem(t: Track): NewQueueItem {
  return { kind: 'local', id: t.id, title: t.title, artist: t.artist, coverUrl: t.coverUrl, duration: t.duration };
}

interface PlayerState {
  queue: QueueItem[];
  index: number;
  playing: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
  muted: boolean;
  currentTime: number;
  duration: number;
  /** индексы уже сыгранных треков (для shuffle и кнопки «назад») */
  history: number[];
  queueOpen: boolean;
  error: string | null;

  playQueue: (items: NewQueueItem[], start?: number) => void;
  toggle: () => void;
  next: (auto?: boolean) => void;
  prev: () => void;
  seek: (t: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  enqueue: (item: NewQueueItem) => void;
  playNext: (item: NewQueueItem) => void;
  removeAt: (i: number) => void;
  jumpTo: (i: number) => void;
  clear: () => void;
  setQueueOpen: (open: boolean) => void;
  // служебные — вызываются из GlobalPlayer
  _tick: (t: number, d: number) => void;
  _setPlaying: (p: boolean) => void;
  _setError: (e: string | null) => void;
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

function restartCurrent() {
  const a = audioRef.current;
  if (a) {
    a.currentTime = 0;
    void a.play().catch(() => undefined);
  }
}

export const usePlayer = create<PlayerState>()(
  persist(
    (set, get) => {
      const pushHistory = (s: PlayerState, idx: number) => (s.shuffle ? [...s.history, idx] : [idx]);

      return {
        queue: [],
        index: 0,
        playing: false,
        shuffle: false,
        repeat: 'off',
        volume: 0.8,
        muted: false,
        currentTime: 0,
        duration: 0,
        history: [],
        queueOpen: false,
        error: null,

        playQueue: (items, start = 0) => {
          if (items.length === 0) return;
          const idx = Math.min(Math.max(start, 0), items.length - 1);
          set({ queue: items.map(withKey), index: idx, history: [idx], playing: true, currentTime: 0, duration: 0, error: null });
        },

        toggle: () => {
          const s = get();
          if (s.queue.length === 0) return;
          set({ playing: !s.playing, error: null });
        },

        next: (auto = false) => {
          const s = get();
          const n = s.queue.length;
          if (n === 0) return;
          if (auto && s.repeat === 'one') return restartCurrent();

          let nextIdx: number | null = null;
          let history = s.history;
          if (s.shuffle && n > 1) {
            const played = new Set(history);
            let candidates = range(n).filter((i) => !played.has(i));
            if (candidates.length === 0 && s.repeat === 'all') {
              history = [s.index]; // новый круг
              candidates = range(n).filter((i) => i !== s.index);
            }
            if (candidates.length) nextIdx = candidates[Math.floor(Math.random() * candidates.length)]!;
          } else if (s.index + 1 < n) {
            nextIdx = s.index + 1;
          } else if (s.repeat === 'all') {
            nextIdx = 0;
          }

          if (nextIdx === null) {
            if (auto) set({ playing: false, currentTime: 0 }); // очередь закончилась
            return;
          }
          if (nextIdx === s.index) return restartCurrent(); // в очереди один трек
          set({ index: nextIdx, history: pushHistory({ ...s, history }, nextIdx), playing: true, currentTime: 0, error: null });
        },

        prev: () => {
          const s = get();
          const a = audioRef.current;
          if (a && a.currentTime > 3) {
            a.currentTime = 0;
            return;
          }
          if (s.shuffle) {
            if (s.history.length > 1) {
              const h = s.history.slice(0, -1);
              set({ index: h[h.length - 1]!, history: h, playing: true, currentTime: 0, error: null });
            } else if (a) a.currentTime = 0;
            return;
          }
          const target = s.index > 0 ? s.index - 1 : s.repeat === 'all' ? s.queue.length - 1 : -1;
          if (target < 0 || target === s.index) {
            if (a) a.currentTime = 0;
            return;
          }
          set({ index: target, history: [target], playing: true, currentTime: 0, error: null });
        },

        seek: (t) => {
          const a = audioRef.current;
          if (a && Number.isFinite(t)) {
            a.currentTime = t;
            set({ currentTime: t });
          }
        },

        setVolume: (v) => set({ volume: Math.min(Math.max(v, 0), 1), muted: false }),
        toggleMute: () => set((s) => ({ muted: !s.muted })),
        toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle, history: [s.index] })),
        cycleRepeat: () => set((s) => ({ repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off' })),

        enqueue: (item) => {
          const s = get();
          if (s.queue.length === 0) return get().playQueue([item]);
          set({ queue: [...s.queue, withKey(item)] });
        },

        playNext: (item) => {
          const s = get();
          if (s.queue.length === 0) return get().playQueue([item]);
          const at = s.index + 1;
          const queue = [...s.queue.slice(0, at), withKey(item), ...s.queue.slice(at)];
          set({ queue, history: s.history.map((h) => (h >= at ? h + 1 : h)) });
        },

        removeAt: (i) => {
          const s = get();
          const queue = s.queue.filter((_, k) => k !== i);
          if (queue.length === 0) return get().clear();
          let index = s.index;
          if (i < index) index -= 1;
          else if (i === index) index = Math.min(index, queue.length - 1); // продолжит следующий трек
          const history = s.history.filter((h) => h !== i).map((h) => (h > i ? h - 1 : h));
          set({ queue, index, history: history.length ? history : [index] });
        },

        jumpTo: (i) => {
          const s = get();
          if (i < 0 || i >= s.queue.length) return;
          set({ index: i, history: pushHistory(s, i), playing: true, currentTime: 0, error: null });
        },

        clear: () => {
          audioRef.current?.pause();
          set({ queue: [], index: 0, history: [], playing: false, currentTime: 0, duration: 0, error: null });
        },

        setQueueOpen: (queueOpen) => set({ queueOpen }),

        _tick: (currentTime, duration) => set({ currentTime, duration: Number.isFinite(duration) ? duration : 0 }),
        _setPlaying: (playing) => set({ playing }),
        _setError: (error) => set({ error, ...(error ? { playing: false } : {}) }),
      };
    },
    {
      name: 'ms-player',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ volume: s.volume, shuffle: s.shuffle, repeat: s.repeat }),
    },
  ),
);
