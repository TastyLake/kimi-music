'use client';

import { useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

interface Props {
  artist: string;
  title: string;
  album?: string | null;
  coverUrl?: string | null;
  downloading?: boolean;
}

type Phase = 'idle' | 'queued' | 'done' | 'error';

export function DownloadTrackButton({ artist, title, album, coverUrl, downloading }: Props) {
  const [phase, setPhase] = useState<Phase>(downloading ? 'queued' : 'idle');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (downloading) setPhase('queued');
  }, [downloading]);

  const start = async () => {
    setPhase('queued');
    setMessage(null);
    try {
      const res = await api<{ status: string; downloadId?: string; trackId?: string }>('/downloads', {
        method: 'POST',
        body: { artist, title, album: album || undefined, coverUrl: coverUrl || undefined },
      });
      if (res.status === 'in_library') {
        setPhase('done');
        return;
      }
      if (!res.downloadId) return;
      const id = res.downloadId;
      const timer = window.setInterval(async () => {
        try {
          const row = await api<{ status: string; error: string | null }>(`/downloads/${id}`);
          if (row.status === 'COMPLETED') {
            setPhase('done');
            window.clearInterval(timer);
          } else if (row.status === 'FAILED' || row.status === 'CANCELLED') {
            setPhase('error');
            setMessage(row.error);
            window.clearInterval(timer);
          }
        } catch {
          window.clearInterval(timer);
        }
      }, 3000);
    } catch (e) {
      setPhase('error');
      setMessage((e as Error).message);
    }
  };

  if (phase === 'done') {
    return <span className="shrink-0 rounded-xl bg-pink-500/15 px-3 py-1.5 text-xs font-medium text-pink-200">В медиатеке</span>;
  }
  if (phase === 'queued') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-pink-500/20 bg-pink-900/40 px-3 py-1.5 text-xs font-medium text-pink-200">
        <Loader2 size={14} className="animate-spin" /> Скачивается
      </span>
    );
  }
  return (
    <button
      type="button"
      title={message ?? 'Скачать и добавить в медиатеку'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void start();
      }}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-pink-500/20 px-3 py-1.5 text-xs font-semibold text-pink-100 transition-colors hover:bg-pink-500/35"
    >
      <Download size={14} /> В базу
    </button>
  );
}
