import { useEffect, useState } from 'react';

export function formatDuration(sec: number | undefined | null): string {
  if (!sec || !Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/** «2024-05-31» → начало/конец дня в локальной зоне, в ISO для API */
export function dayStartISO(date: string): string {
  return new Date(`${date}T00:00:00`).toISOString();
}
export function dayEndISO(date: string): string {
  return new Date(`${date}T23:59:59.999`).toISOString();
}

export function youtubeSearchUrl(artist: string, title: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${artist} ${title}`)}`;
}