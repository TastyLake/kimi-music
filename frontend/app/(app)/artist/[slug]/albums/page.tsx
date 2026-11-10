'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Cover } from '@/components/Cover';
import { api } from '@/lib/api';
import { albumHref } from '@/lib/entity';

interface ArtistCard {
  artist: { name: string; slug: string };
  albums: { title: string; slug: string; year: number | null; coverUrl: string | null }[];
}

export default function ArtistAlbumsPage() {
  const params = useParams<{ slug: string }>();
  const search = useSearchParams();
  const name = search.get('name') ?? '';
  const [card, setCard] = useState<ArtistCard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ArtistCard>(`/artists/${params.slug}`, { query: { name: name || undefined } })
      .then(setCard)
      .catch((e: Error) => setError(e.message));
  }, [params.slug, name]);

  if (error) return <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>;
  if (!card) return <div className="py-16 text-center text-sm text-pink-300/60">Загружаем альбомы…</div>;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/artist/${card.artist.slug}?name=${encodeURIComponent(card.artist.name)}`} className="text-sm text-pink-300/70 hover:underline">
          {card.artist.name}
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-pink-50">Все альбомы</h1>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {card.albums.map((album) => (
          <Link key={album.slug} href={albumHref(card.artist.name, album.title)} className="rounded-2xl p-3 transition-colors hover:bg-pink-950/40">
            <Cover url={album.coverUrl} title={album.title} size={180} className="aspect-square w-full rounded-xl" />
            <div className="mt-2 truncate text-sm font-medium text-pink-50">{album.title}</div>
            <div className="text-xs text-pink-300/50">{album.year ?? 'Альбом'}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
