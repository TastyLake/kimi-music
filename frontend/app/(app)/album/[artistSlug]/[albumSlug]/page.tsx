'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Check } from 'lucide-react';
import { Cover } from '@/components/Cover';
import { DownloadTrackButton } from '@/components/DownloadTrackButton';
import { ExternalPlayButton } from '@/components/ExternalPlayButton';
import { api } from '@/lib/api';
import { artistHref } from '@/lib/entity';
import type { RemoteTrack, Track } from '@/lib/types';
import { cn } from '@/lib/utils';
import { trackToItem, usePlayer } from '@/store/player';

interface AlbumCard {
  album: {
    id: string;
    title: string;
    slug: string;
    year: number | null;
    coverUrl: string | null;
    artist: { name: string; slug: string };
  };
  tracks: Track[];
  remoteTracks: RemoteTrack[];
}

function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function AlbumPage() {
  const router = useRouter();
  const params = useParams<{ artistSlug: string; albumSlug: string }>();
  const search = useSearchParams();
  const artist = search.get('artist') ?? '';
  const title = search.get('title') ?? '';
  const [card, setCard] = useState<AlbumCard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCard(null);
    setError(null);
    api<AlbumCard>(`/albums/${params.artistSlug}/${params.albumSlug}`, { query: { artist: artist || undefined, title: title || undefined } })
      .then(setCard)
      .catch((e: Error) => setError(e.message));
  }, [params.artistSlug, params.albumSlug, artist, title]);

  const rows = useMemo(() => {
    if (!card) return [];
    const seen = new Set(card.remoteTracks.map((t) => `${t.artist}|${t.title}`.toLowerCase()));
    const extra: RemoteTrack[] = card.tracks
      .filter((t) => !seen.has(`${t.artist}|${t.title}`.toLowerCase()))
      .map((t) => ({
        title: t.title,
        artist: t.artist,
        album: t.album,
        coverUrl: t.coverUrl,
        duration: t.duration,
        inLibrary: true,
      }));
    return [...card.remoteTracks, ...extra];
  }, [card]);

  if (error) return <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>;
  if (!card) return <div className="py-16 text-center text-sm text-pink-300/60">Открываем альбом…</div>;

  return (
    <div className="space-y-6">
      <button type="button" onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm text-pink-300/70 hover:text-pink-100">
        <ArrowLeft size={16} /> Назад
      </button>
      <header className="flex items-end gap-5">
        <Cover url={card.album.coverUrl} title={card.album.title} size={180} className="rounded-3xl shadow-xl" />
        <div>
          <div className="text-xs uppercase tracking-widest text-pink-300/50">Альбом</div>
          <h1 className="text-3xl font-bold text-pink-50">{card.album.title}</h1>
          <Link href={artistHref(card.album.artist.name)} className="mt-1 inline-block text-sm text-pink-300/70 hover:text-pink-100 hover:underline">
            {card.album.artist.name}
          </Link>
          <p className="mt-1 text-xs text-pink-300/50">{card.album.year ?? 'Год неизвестен'} · {rows.length} треков</p>
        </div>
      </header>

      <div className="divide-y divide-pink-500/10 overflow-hidden rounded-2xl border border-pink-500/15 bg-pink-950/25">
        {rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-pink-300/60">Треклист пока не найден</div>}
        {rows.map((t, i) => (
          <div key={`${t.artist}-${t.title}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
            <span className="w-6 text-right text-xs tabular-nums text-pink-300/40">{i + 1}</span>
            <Cover url={t.coverUrl ?? card.album.coverUrl} title={t.title} size={40} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-pink-50">{t.title}</div>
              <div className="truncate text-xs text-pink-300/60">{t.artist}</div>
            </div>
            <span className={cn('w-12 text-right text-xs tabular-nums text-pink-300/50', !t.duration && 'opacity-40')}>{mmss(t.duration)}</span>
            <div className="flex items-center gap-1">
              {t.inLibrary ? (
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-pink-400/40 px-3 py-1.5 text-xs font-semibold text-pink-100 hover:bg-pink-500/20"
                  onClick={() => {
                    const local = card.tracks.find((row) => row.title === t.title && row.artist === t.artist);
                    if (local) usePlayer.getState().playQueue([trackToItem(local)]);
                  }}
                >
                  Слушать
                </button>
              ) : (
                <>
                  <ExternalPlayButton artist={t.artist} title={t.title} album={t.album ?? card.album.title} coverUrl={t.coverUrl ?? card.album.coverUrl} duration={t.duration} />
                  <DownloadTrackButton artist={t.artist} title={t.title} album={t.album ?? card.album.title} coverUrl={t.coverUrl} downloading={t.downloading} />
                </>
              )}
              {t.inLibrary && <Check size={18} className="shrink-0 text-pink-300" aria-label="Уже в медиатеке" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
