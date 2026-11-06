'use client';

import { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, UploadCloud } from 'lucide-react';
import { api, ApiError, uploadFile } from '@/lib/api';
import { NAMING_HINT, validateUploadName } from '@/lib/filename';
import { cn, formatBytes } from '@/lib/utils';
import { useAuth } from '@/store/auth';

interface Row {
  id: number;
  name: string;
  size: number;
  state: 'invalid' | 'queued' | 'uploading' | 'done' | 'error';
  progress: number;
  message?: string;
}

let rowId = 0;

export default function UploadPage() {
  const canUpload = useAuth((s) => s.user?.canUpload);
  const [rows, setRows] = useState<Row[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const queue = useRef<{ id: number; file: File }[]>([]);
  const playlistIdRef = useRef<string | null>(null);

  const patch = (id: number, p: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const ensurePlaylist = async () => {
    if (playlistIdRef.current) return playlistIdRef.current;
    const now = new Date();
    const dateStr = `${now.getDate()}.${now.getMonth() + 1}.${now.getFullYear()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
    try {
      const pl = await api<{ id: string }>('/playlists', {
        method: 'POST',
        body: {
          name: `Загрузка от ${dateStr}`,
          isPublic: false,
        },
      });
      playlistIdRef.current = pl.id;
      return pl.id;
    } catch {
      return null;
    }
  };

  const pump = async () => {
    if (running.current) return;
    running.current = true;

    // Создаем плейлист перед стартом пачки файлов
    const playlistId = await ensurePlaylist();

    while (queue.current.length) {
      const { id, file } = queue.current.shift()!;
      patch(id, { state: 'uploading', progress: 0 });
      try {
        const r = await uploadFile(file, (progress) => patch(id, { progress }));
        const createdTrack = (r as { track?: { id: string } }).track;

        if (r.status === 'created' && createdTrack?.id) {
          if (playlistId) {
            await api(`/playlists/${playlistId}/tracks`, {
              method: 'POST',
              body: { trackId: createdTrack.id },
            }).catch(() => null);
          }
          patch(id, { state: 'done', progress: 100, message: 'Добавлено в плейлист и библиотеку' });
        } else if (r.status === 'duplicate') {
          patch(id, { state: 'invalid', message: r.error ?? 'Уже есть в библиотеке' });
        } else {
          patch(id, { state: 'error', message: r.error ?? 'Не удалось добавить' });
        }
      } catch (e) {
        patch(id, { state: 'error', message: e instanceof ApiError ? e.message : 'Ошибка загрузки' });
      }
    }

    // Сбрасываем ID плейлиста для следующей сессии загрузки
    playlistIdRef.current = null;
    running.current = false;
  };

  const addFiles = (list: FileList | File[]) => {
    const fresh: Row[] = [];
    for (const file of Array.from(list)) {
      const id = ++rowId;
      const check = validateUploadName(file.name);
      if (check.ok) {
        fresh.push({ id, name: file.name, size: file.size, state: 'queued', progress: 0 });
        queue.current.push({ id, file });
      } else {
        fresh.push({ id, name: file.name, size: file.size, state: 'invalid', progress: 0, message: check.error });
      }
    }
    setRows((rs) => [...fresh, ...rs]);
    void pump();
  };

  if (!canUpload) {
    return <div className="card p-8 text-center text-sm text-pink-300/70">У вас нет прав на загрузку треков. Обратитесь к администратору.</div>;
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold bg-gradient-to-r from-pink-300 via-rose-300 to-purple-300 bg-clip-text text-transparent">
        Загрузка треков
      </h1>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => input.current?.click()}
        className={cn(
          'flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-all duration-300 backdrop-blur-md',
          dragging
            ? 'border-pink-400 bg-pink-500/10 scale-[1.01]'
            : 'border-pink-500/20 bg-pink-950/20 hover:border-pink-400/50 hover:bg-pink-900/20',
        )}
      >
        <UploadCloud size={40} className="text-pink-400 animate-pulse" />
        <div className="font-semibold text-pink-100">Перетащите файлы сюда или нажмите для выбора</div>
        <div className="text-xs text-pink-300/60">
          Формат имени: <code className="rounded-md bg-pink-950/60 px-2 py-0.5 border border-pink-500/20 text-pink-200">Исполнитель - Название.mp3</code>
        </div>
        <input
          ref={input}
          type="file"
          multiple
          accept=".mp3,.flac,.wav,.ogg,.m4a,.opus,audio/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {rows.length > 0 && (
        <ul className="rounded-2xl border border-pink-500/15 bg-pink-950/20 backdrop-blur-md divide-y divide-pink-500/10 overflow-hidden">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-3">
              {r.state === 'done' && <CheckCircle2 size={18} className="shrink-0 text-pink-400" />}
              {(r.state === 'invalid' || r.state === 'error') && <AlertCircle size={18} className="shrink-0 text-rose-400" />}
              {r.state === 'uploading' && <Loader2 size={18} className="shrink-0 animate-spin text-pink-300" />}
              {r.state === 'queued' && <Loader2 size={18} className="shrink-0 text-pink-500/40" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-pink-100">{r.name}</div>
                <div className={cn('text-xs', r.state === 'invalid' || r.state === 'error' ? 'text-rose-300' : 'text-pink-300/60')}>
                  {r.state === 'uploading'
                    ? `Загрузка… ${r.progress}%`
                    : r.state === 'queued'
                      ? `В очереди · ${formatBytes(r.size)}`
                      : (r.message ?? '')}
                </div>
                {r.state === 'uploading' && (
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-pink-950">
                    <div className="h-full bg-gradient-to-r from-pink-500 to-rose-400 transition-all duration-200" style={{ width: `${r.progress}%` }} />
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-pink-400/40">{NAMING_HINT}</p>
    </div>
  );
}