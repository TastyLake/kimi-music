'use client';

import { useCallback, useEffect, useState } from 'react';
import { Ban, Check, RefreshCw, ScanLine, Trash2, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import type { Paged, Track } from '@/lib/types';
import { cn, formatBytes, formatDate, formatDuration } from '@/lib/utils';
import { useAuth } from '@/store/auth';

type Tab = 'stats' | 'review' | 'users';

interface Stats {
  tracks: number;
  needsReview: number;
  users: number;
  genres: number;
  withoutCover: number;
  withoutGenre: number;
  libraryBytes: number;
  totalDurationSec: number;
  disk: { freeBytes: number; totalBytes: number } | null;
  topArtists: { artist: string; tracks: number }[];
}

interface ScanState {
  running: boolean;
  total: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  duplicates: number;
  needsReview: number;
  errors: number;
  missing: number;
  pruned: number;
  errorSamples: string[];
  finishedAt: string | null;
}

interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: 'ADMIN' | 'USER';
  canUpload: boolean;
  isBlocked: boolean;
  createdAt: string;
  playlists: number;
  favorites: number;
}

interface Summary {
  needsReview: number;
}

const Err = ({ msg }: { msg: string | null }) => (msg ? <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">{msg}</div> : null);

/* ---------------- Статистика и сканирование ---------------- */

function StatsTab() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [scan, setScan] = useState<ScanState | null>(null);
  const [prune, setPrune] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(() => {
    api<Stats>('/admin/stats').then(setStats).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    loadStats();
    api<ScanState>('/admin/scan').then(setScan).catch(() => undefined);
  }, [loadStats]);

  // пока идёт сканирование — опрашиваем прогресс
  const running = scan?.running;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      api<ScanState>('/admin/scan')
        .then((s) => {
          setScan(s);
          if (!s.running) loadStats();
        })
        .catch(() => undefined);
    }, 1500);
    return () => clearInterval(t);
  }, [running, loadStats]);

  const startScan = async () => {
    setError(null);
    try {
      setScan(await api<ScanState>('/admin/scan', { method: 'POST', body: { pruneMissing: prune } }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const enrich = async () => {
    try {
      await api('/admin/enrich', { method: 'POST' });
      setMsg('Обогащение метаданных поставлено в очередь');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const runCleanup = async () => {
    try {
      const res = await api<Record<string, unknown>>('/admin/cleanup', { method: 'POST' });
      setMsg(`Чистка завершена: ${JSON.stringify(res)}`);
      loadStats();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const cards = stats
    ? [
        ['Треков', stats.tracks],
        ['Нужна проверка', stats.needsReview],
        ['Пользователей', stats.users],
        ['Жанров', stats.genres],
        ['Без обложки', stats.withoutCover],
        ['Без жанра', stats.withoutGenre],
        ['Длительность', `${Math.round(stats.totalDurationSec / 3600)} ч`],
      ]
    : [];

  return (
    <div className="space-y-6">
      <Err msg={error} />
      {stats && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {cards.map(([label, value]) => (
              <div key={label} className="card p-4">
                <div className="text-2xl font-bold">{value}</div>
                <div className="text-xs text-zinc-500">{label}</div>
              </div>
            ))}
          </div>

          <div className="card space-y-3 p-4">
            <div className="flex justify-between text-sm">
              <span>Размер библиотеки</span>
              <span className="font-medium">{formatBytes(stats.libraryBytes)}</span>
            </div>
            {stats.disk && (
              <>
                <div className="h-2 overflow-hidden rounded bg-zinc-800">
                  <div
                    className="h-full bg-accent"
                    style={{ width: `${Math.min(100, ((stats.disk.totalBytes - stats.disk.freeBytes) / stats.disk.totalBytes) * 100)}%` }}
                  />
                </div>
                <div className="text-xs text-zinc-500">
                  Диск: свободно {formatBytes(stats.disk.freeBytes)} из {formatBytes(stats.disk.totalBytes)}
                </div>
              </>
            )}
            {stats.topArtists.length > 0 && (
              <div className="text-xs text-zinc-400">
                Больше всего треков: {stats.topArtists.map((a) => `${a.artist} (${a.tracks})`).join(', ')}
              </div>
            )}
          </div>
        </>
      )}

      <div className="card space-y-3 p-4">
        <h3 className="font-semibold">Сканирование и обслуживание</h3>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-primary" onClick={startScan} disabled={scan?.running}>
            <ScanLine size={16} /> {scan?.running ? 'Сканирую…' : 'Запустить сканирование'}
          </button>
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            <input type="checkbox" checked={prune} onChange={(e) => setPrune(e.target.checked)} /> Удалять из базы пропавшие файлы
          </label>
          <button className="btn" onClick={enrich}>
            <RefreshCw size={16} /> Обогатить метаданные
          </button>
          <button className="btn" onClick={runCleanup}>
            <Trash2 size={16} /> Очистить мусор БД/диска
          </button>
        </div>
        {msg && <div className="text-sm text-yellow-300">{msg}</div>}
        {scan && (scan.running || scan.finishedAt) && (
          <div className="space-y-2 text-sm text-zinc-300">
            {scan.running && (
              <div className="h-2 overflow-hidden rounded bg-zinc-800">
                <div className="h-full bg-accent transition-all" style={{ width: `${scan.total ? (scan.processed / scan.total) * 100 : 5}%` }} />
              </div>
            )}
            <div>
              Обработано {scan.processed} из {scan.total} · новых {scan.created} · обновлено {scan.updated} · без изменений {scan.skipped} · дубликатов{' '}
              {scan.duplicates} · на проверку {scan.needsReview} · ошибок {scan.errors}
              {scan.missing > 0 && ` · пропало с диска ${scan.missing}${scan.pruned ? ` (удалено из базы: ${scan.pruned})` : ''}`}
            </div>
            {scan.errorSamples.length > 0 && <pre className="overflow-x-auto rounded bg-zinc-900 p-2 text-xs text-red-300">{scan.errorSamples.join('\n')}</pre>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Нераспознанные треки ---------------- */

function ReviewRow({ track, onSaved }: { track: Track; onSaved: (id: string) => void }) {
  const [artist, setArtist] = useState(track.artist === 'Unknown Artist' ? '' : track.artist);
  const [title, setTitle] = useState(track.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/tracks/${track.id}`, { method: 'PATCH', body: { artist: artist.trim(), title: title.trim() } });
      onSaved(track.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Удалить трек из базы? Файл на диске останется.')) return;
    await api(`/admin/tracks/${track.id}`, { method: 'DELETE' });
    onSaved(track.id);
  };

  return (
    <div className="space-y-2 px-4 py-3">
      <div className="truncate text-xs text-zinc-500" title={track.filePath}>
        {track.owner ? `${track.owner} · ` : ''}{track.filePath?.split(/[\\/]/).pop()} · {formatDuration(track.duration)} · {formatBytes(track.fileSize ?? 0)}
      </div>
      <div className="flex flex-wrap gap-2">
        <input className="input !w-auto min-w-0 flex-1" placeholder="Исполнитель" value={artist} onChange={(e) => setArtist(e.target.value)} />
        <input className="input !w-auto min-w-0 flex-[2]" placeholder="Название" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button className="btn btn-primary" onClick={save} disabled={busy || !artist.trim() || !title.trim()}>
          <Check size={16} /> Сохранить
        </button>
        <button className="btn" onClick={remove} title="Удалить из базы">
          <Trash2 size={16} />
        </button>
      </div>
      <Err msg={error} />
    </div>
  );
}

function ReviewTab() {
  const [data, setData] = useState<Paged<Track> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Paged<Track>>('/admin/review', { query: { limit: 100 } }).then(setData).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">Файлы, имя которых не соответствует «Исполнитель - Название» и в тегах которых нет исполнителя и названия.</p>
      <Err msg={error} />
      {data && data.items.length === 0 && <div className="card px-6 py-12 text-center text-sm text-zinc-500">Нераспознанных треков нет 🎉</div>}
      {data && data.items.length > 0 && (
        <div className="card divide-y divide-zinc-900">
          {data.items.map((t) => (
            <ReviewRow key={t.id} track={t} onSaved={(id) => setData((d) => d && { ...d, total: d.total - 1, items: d.items.filter((x) => x.id !== id) })} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Пользователи ---------------- */

function UsersTab() {
  const me = useAuth((s) => s.user);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ items: AdminUser[] }>('/admin/users').then((r) => setUsers(r.items)).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const patch = async (id: string, body: Partial<Pick<AdminUser, 'isBlocked' | 'canUpload' | 'role'>>) => {
    setError(null);
    try {
      await api(`/admin/users/${id}`, { method: 'PATCH', body });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (u: AdminUser) => {
    if (!confirm(`Удалить пользователя ${u.username} вместе с его плейлистами и избранным?`)) return;
    try {
      await api(`/admin/users/${u.id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <Err msg={error} />
      {users && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2">Пользователь</th>
                <th className="px-4 py-2">Роль</th>
                <th className="px-4 py-2">Загрузка</th>
                <th className="px-4 py-2">Регистрация</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {users.map((u) => {
                const self = u.id === me?.id;
                return (
                  <tr key={u.id} className={u.isBlocked ? 'opacity-50' : ''}>
                    <td className="px-4 py-2">
                      <div>{u.username}{self && ' (вы)'}</div>
                      <div className="text-xs text-zinc-500">{u.email}</div>
                    </td>
                    <td className="px-4 py-2">
                      <select className="input !w-auto !py-1" value={u.role} disabled={self} onChange={(e) => void patch(u.id, { role: e.target.value as 'ADMIN' | 'USER' })}>
                        <option value="USER">User</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <label className="flex items-center gap-2 text-zinc-400">
                        <input type="checkbox" checked={u.canUpload || u.role === 'ADMIN'} disabled={u.role === 'ADMIN'} onChange={(e) => void patch(u.id, { canUpload: e.target.checked })} />
                        <Upload size={14} />
                      </label>
                    </td>
                    <td className="px-4 py-2 text-xs text-zinc-400">{formatDate(u.createdAt)}</td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-2">
                        <button className="btn" disabled={self} onClick={() => void patch(u.id, { isBlocked: !u.isBlocked })}>
                          <Ban size={14} /> {u.isBlocked ? 'Разблокировать' : 'Блок'}
                        </button>
                        <button className="btn btn-danger" disabled={self} onClick={() => void remove(u)} aria-label="Удалить">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------- Страница ---------------- */

export default function AdminPage() {
  const user = useAuth((s) => s.user);
  const [tab, setTab] = useState<Tab>('stats');
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    if (user?.role !== 'ADMIN') return;
    api<Summary>('/admin/summary').then(setSummary).catch(() => undefined);
  }, [user?.role, tab]);

  if (user?.role !== 'ADMIN') return <div className="card p-8 text-center text-sm text-zinc-400">Доступ только для администратора.</div>;

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'stats', label: 'Хранилище и сканирование' },
    { id: 'review', label: 'Нераспознанные', badge: summary?.needsReview },
    { id: 'users', label: 'Пользователи' },
  ];

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Админ-панель</h1>
      <div className="flex flex-wrap gap-1">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cn('flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm', tab === t.id ? 'bg-zinc-700 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-white')}>
            {t.label}
            {!!t.badge && <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-black">{t.badge}</span>}
          </button>
        ))}
      </div>
      {tab === 'stats' && <StatsTab />}
      {tab === 'review' && <ReviewTab />}
      {tab === 'users' && <UsersTab />}
    </div>
  );
}