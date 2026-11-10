'use client';

import { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, UploadCloud } from 'lucide-react';
import { api, ApiError, uploadFile, type UploadOutcome } from '@/lib/api';
import { NAMING_HINT, validateUploadName } from '@/lib/filename';
import { formatBytes } from '@/lib/utils';

type Status = 'pending' | 'uploading' | 'success' | 'duplicate' | 'error';

interface UploadItem {
  id: number;
  file: File;
  status: Status;
  progress: number;
  message?: string;
}

// Бэкенд может отдавать id созданного трека в разных полях
type UploadResult = UploadOutcome & { track?: { id?: string }; trackId?: string; id?: string };

let nextId = 0;

const playlistName = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `Загрузка от ${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function UploadPage() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const patch = (id: number, p: Partial<UploadItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i)));

  const handleFiles = (files: FileList | File[]) => {
    const fresh = Array.from(files).map((file): UploadItem => {
      const check = validateUploadName(file.name);
      return check.ok
        ? { id: ++nextId, file, status: 'pending', progress: 0 }
        : { id: ++nextId, file, status: 'error', progress: 0, message: check.error };
    });
    setItems((prev) => [...prev, ...fresh]);
  };

  // Загружаем новые файлы и повторяем те, что упали при загрузке (но не с неверным именем)
  const isUploadable = (i: UploadItem) =>
    i.status === 'pending' || (i.status === 'error' && validateUploadName(i.file.name).ok);
  const uploadableCount = items.filter(isUploadable).length;

  const startUpload = async () => {
    if (isUploading) return;
    const queue = items.filter(isUploadable);
    if (queue.length === 0) return;

    setIsUploading(true);
    let playlistId: string | null = null; // один плейлист на всю пачку файлов
    for (const item of queue) {
      patch(item.id, { status: 'uploading', progress: 0, message: undefined });
      try {
        const r = (await uploadFile(item.file, (progress) => patch(item.id, { progress }))) as UploadResult;
        console.debug('[upload] ответ сервера:', r);
        const st = String(r.status ?? '').toLowerCase();

        if (st === 'duplicate') {
          patch(item.id, { status: 'duplicate', message: r.error ?? 'Уже есть в библиотеке' });
        } else if (st === 'error' || st === 'failed' || r.error) {
          patch(item.id, { status: 'error', message: r.error ?? 'Не удалось добавить' });
        } else {
          // Любой ответ без ошибки считаем успешной загрузкой
          const trackId = r.track?.id ?? r.trackId ?? r.id;
          let message: string | undefined;
          if (trackId) {
            try {
              if (!playlistId) {
                const pl: { id: string } = await api('/playlists', {
                  method: 'POST',
                  body: { name: playlistName(), isPublic: false },
                });
                playlistId = pl.id;
              }
              await api(`/playlists/${playlistId}/tracks`, { method: 'POST', body: { trackId } });
              message = 'Добавлено в плейлист';
            } catch {
              message = 'Загружено, но в плейлист не добавлено';
            }
          } else {
            message = 'Загружено (сервер не вернул id трека)';
          }
          patch(item.id, { status: 'success', progress: 100, message });
        }
      } catch (e) {
        patch(item.id, { status: 'error', message: e instanceof ApiError ? e.message : 'Ошибка загрузки' });
      }
    }
    setIsUploading(false);
  };

  return (
    <div className="flex flex-col h-full p-6 max-w-4xl mx-auto overflow-y-auto">
      <h1 className="text-2xl font-bold text-pink-100 mb-6">Загрузка треков</h1>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer border-2 border-dashed rounded-2xl p-10 text-center transition-all ${
          isDragging
            ? 'border-pink-400 bg-pink-500/20'
            : 'border-pink-500/30 bg-pink-950/20 hover:border-pink-500/50'
        }`}
      >
        <div className="flex flex-col items-center justify-center gap-3">
          <UploadCloud size={48} className="text-pink-400" />
          <p className="text-pink-200 font-medium">Перетащите файлы сюда или нажмите для выбора</p>
          <p className="text-xs text-pink-300/50">Формат имени: Исполнитель - Название.mp3</p>
          <span className="mt-2 bg-pink-500 hover:bg-pink-600 text-pink-950 font-bold px-4 py-2 rounded-xl transition-all shadow-lg shadow-pink-500/20">
            Выбрать файлы
          </span>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".mp3,.flac,.wav,.ogg,.m4a,.opus,audio/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handleFiles(e.target.files);
              e.target.value = ''; // чтобы можно было выбрать тот же файл повторно
            }}
          />
        </div>
      </div>

      {items.length > 0 && (
        <div className="mt-6 flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-pink-200/70">Выбрано файлов: {items.length}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setItems((prev) => prev.filter((i) => i.status === 'uploading'))}
                disabled={isUploading}
                className="text-xs font-medium text-pink-300/60 hover:text-pink-100 disabled:opacity-40 cursor-pointer"
              >
                Очистить список
              </button>
              <button
                onClick={() => void startUpload()}
                disabled={isUploading || uploadableCount === 0}
                className="bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white font-medium px-5 py-2 rounded-xl text-sm transition-all disabled:opacity-50 cursor-pointer shadow-md shadow-pink-950"
              >
                {isUploading ? 'Загрузка...' : 'Загрузить все'}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2 mt-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-pink-950/30 border border-pink-500/15"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {item.status === 'success' && <CheckCircle2 className="text-emerald-400 shrink-0" size={20} />}
                  {item.status === 'duplicate' && <CheckCircle2 className="text-amber-300 shrink-0" size={20} />}
                  {item.status === 'error' && <AlertCircle className="text-rose-400 shrink-0" size={20} />}
                  {item.status === 'uploading' && <Loader2 className="text-pink-400 shrink-0 animate-spin" size={20} />}
                  {item.status === 'pending' && <div className="w-5 h-5 rounded-full border-2 border-pink-500/30 shrink-0" />}

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-pink-100">{item.file.name}</div>
                    {item.status === 'uploading' && (
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-pink-950">
                        <div
                          className="h-full bg-gradient-to-r from-pink-500 to-rose-400 transition-all duration-200"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>

                <span className="shrink-0 text-xs font-medium">
                  {item.status === 'success' && (
                    <span className="text-emerald-300 bg-emerald-950/50 border border-emerald-500/20 px-2 py-1 rounded-md">{item.message ?? 'Успешно'}</span>
                  )}
                  {item.status === 'duplicate' && (
                    <span className="text-amber-200 bg-amber-950/50 border border-amber-500/20 px-2 py-1 rounded-md">
                      {item.message ?? 'Уже есть'}
                    </span>
                  )}
                  {item.status === 'error' && (
                    <span className="block max-w-xs truncate text-rose-300 bg-rose-950/50 border border-rose-500/20 px-2 py-1 rounded-md" title={item.message}>
                      {item.message ?? 'Ошибка'}
                    </span>
                  )}
                  {item.status === 'uploading' && (
                    <span className="text-pink-300 bg-pink-950/50 border border-pink-500/20 px-2 py-1 rounded-md">{item.progress}%</span>
                  )}
                  {item.status === 'pending' && <span className="text-pink-300/50">Ожидание · {formatBytes(item.file.size)}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-6 text-xs text-pink-400/40">{NAMING_HINT}</p>
    </div>
  );
}

