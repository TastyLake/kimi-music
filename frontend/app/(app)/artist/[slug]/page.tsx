'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Cover } from '@/components/Cover';
import { DownloadTrackButton } from '@/components/DownloadTrackButton';
import { ExternalPlayButton } from '@/components/ExternalPlayButton';
import { TrackTable } from '@/components/TrackTable';
import { api } from '@/lib/api';
import { albumHref } from '@/lib/entity';
import type { RemoteTrack, Track } from '@/lib/types';
import { trackToItem, usePlayer } from '@/store/player';

interface ArtistCard {
  artist: { id: string; name: string; slug: string; imageUrl: string | null };
  albums: { title: string; slug: string; artist: string; year: number | null; coverUrl: string | null }[];
  tracks: Track[];
  remoteTracks: RemoteTrack[];
}

export default function ArtistPage() {
  const params = useParams<{ slug: string }>();
  const search = useSearchParams();
  const name = search.get('name') ?? '';
  const albumsRef = useRef<HTMLDivElement>(null);
  const [card, setCard] = useState<ArtistCard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCard(null);
    setError(null);
    api<ArtistCard>(`/artists/${params.slug}`, { query: { name: name || undefined } })
      .then(setCard)
      .catch((e: Error) => setError(e.message));
  }, [params.slug, name]);

  if (error) return <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>;
  if (!card) return <div className="py-16 text-center text-sm text-pink-300/60">Открываем карточку…</div>;

  return (
    <div className="space-y-8">
      <header className="flex items-end gap-5">
        <Cover url={card.artist.imageUrl} title={card.artist.name} size={160} className="rounded-3xl shadow-xl" />
        <div>
          <div className="text-xs uppercase tracking-widest text-pink-300/50">Исполнитель</div>
          <h1 className="text-3xl font-bold text-pink-50">{card.artist.name}</h1>
          <p className="mt-1 text-sm text-pink-300/60">{card.tracks.length} в медиатеке · {card.albums.length} альбомов</p>
        </div>
      </header>

      {card.albums.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-pink-100">Альбомы</h2>
            <div className="flex items-center gap-2">
              {card.albums.length > 3 && (
                <Link href={`/artist/${card.artist.slug}/albums?name=${encodeURIComponent(card.artist.name)}`} className="text-sm font-semibold text-pink-200 hover:underline">
                  Все альбомы
                </Link>
              )}
              <button type="button" aria-label="Назад" className="rounded-full bg-pink-950/70 p-1.5 text-pink-100" onClick={() => albumsRef.current?.scrollBy({ left: -280, behavior: 'smooth' })}>
                <ChevronLeft size={16} />
              </button>
              <button type="button" aria-label="Вперёд" className="rounded-full bg-pink-950/70 p-1.5 text-pink-100" onClick={() => albumsRef.current?.scrollBy({ left: 280, behavior: 'smooth' })}>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
          <div ref={albumsRef} className="flex gap-3 overflow-x-auto scroll-smooth pb-1 [scrollbar-width:none]">
            {card.albums.map((album) => (
              <Link
                key={album.slug}
                href={albumHref(card.artist.name, album.title)}
                className="w-[180px] shrink-0 rounded-2xl border border-pink-500/15 bg-pink-950/30 p-3 transition-colors hover:border-pink-400/40 hover:bg-pink-900/30"
              >
                <Cover url={album.coverUrl} title={album.title} size={180} className="aspect-square w-full rounded-xl" />
                <div className="mt-2 truncate text-sm font-medium text-pink-50">{album.title}</div>
                <div className="text-xs text-pink-300/50">{album.year ?? 'Альбом'}</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-pink-100">В медиатеке</h2>
          <button
            type="button"
            className="rounded-xl bg-pink-500/20 px-3 py-1.5 text-xs font-semibold text-pink-100 hover:bg-pink-500/30"
            disabled={!card.tracks.length}
            onClick={() => usePlayer.getState().playQueue(card.tracks.map(trackToItem), 0)}
          >
            Играть
          </button>
        </div>
        <TrackTable tracks={card.tracks} onPlay={(i) => usePlayer.getState().playQueue(card.tracks.map(trackToItem), i)} emptyText="В медиатеке пока нет треков этого исполнителя" />
      </section>

      {card.remoteTracks.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-pink-100">Популярное</h2>
          <div className="divide-y divide-pink-500/10 overflow-hidden rounded-2xl border border-pink-500/15 bg-pink-950/20">
            {card.remoteTracks.map((t, index) => (
              <div key={`${t.artist}-${t.title}-${index}`} className="flex items-center gap-3 px-4 py-2.5">
                <Cover url={t.coverUrl} title={t.title} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-pink-50">{t.title}</div>
                  <div className="truncate text-xs text-pink-300/60">{t.album ?? t.artist}</div>
                </div>
                <ExternalPlayButton artist={t.artist} title={t.title} album={t.album} coverUrl={t.coverUrl} duration={t.duration} />
                {t.inLibrary ? <Check size={16} className="text-pink-300" /> : <DownloadTrackButton artist={t.artist} title={t.title} album={t.album} coverUrl={t.coverUrl} downloading={t.downloading} />}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
