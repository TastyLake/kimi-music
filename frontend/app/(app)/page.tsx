'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Cover } from '@/components/Cover';
import { api } from '@/lib/api';
import { albumHref, slugify } from '@/lib/entity';

interface HomeArtist {
  name: string;
  plays: number;
  imageUrl: string | null;
}

interface HomeRelease {
  artist: string;
  title: string;
  coverUrl: string | null;
  date: string;
}

interface HomeTrack {
  artist: string;
  title: string;
  album: string | null;
  coverUrl: string | null;
  duration: number;
}

interface HomeResponse {
  artists: HomeArtist[];
  releases: HomeRelease[];
  mixes: { title: string; tracks: HomeTrack[] }[] | null;
}

export default function HomePage() {
  const [data, setData] = useState<HomeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<HomeResponse>('/home')
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>;
  if (!data) return <div className="py-16 text-center text-sm text-pink-300/60">Собираем главную…</div>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-pink-50">Главная</h1>
        <p className="mt-1 text-sm text-pink-300/60">Артисты, релизы и подборки.</p>
      </div>

      {data.artists.length === 0 ? (
        <div className="rounded-2xl border border-pink-500/15 bg-pink-950/30 p-6 text-sm text-pink-300/70">
          В медиатеке пока нет треков. Загрузи музыку или скачай её из обзора — и здесь появятся релизы и подборки.
        </div>
      ) : (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-pink-100">Твои артисты</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
            {data.artists.map((artist) => (
              <Link
                key={artist.name}
                href={`/mix/${slugify(artist.name)}?name=${encodeURIComponent(artist.name)}`}
                className="group rounded-2xl p-3 text-center transition-colors hover:bg-pink-950/40"
              >
                <Cover url={artist.imageUrl} title={artist.name} size={180} className="mx-auto aspect-square w-full rounded-full shadow-lg" />
                <div className="mt-3 truncate text-sm font-semibold text-pink-50">{artist.name}</div>
                <div className="truncate text-xs text-pink-300/50">Исполнитель</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {data.releases.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-pink-100">Новые релизы</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {data.releases.map((release) => (
              <Link
                key={`${release.artist}-${release.title}`}
                href={albumHref(release.artist, release.title)}
                className="rounded-2xl p-3 transition-colors hover:bg-pink-950/40"
              >
                <Cover url={release.coverUrl} title={release.title} size={180} className="aspect-square w-full rounded-xl shadow-lg" />
                <div className="mt-3 truncate text-sm font-semibold text-pink-50">{release.title}</div>
                <div className="truncate text-xs text-pink-300/60">{release.artist}</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {data.mixes && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-pink-100">Подборки</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {data.mixes.map((mix) => {
              const cover = mix.tracks.find((t) => t.coverUrl)?.coverUrl ?? null;
              const href = `/mix/${slugify(mix.title)}?title=${encodeURIComponent(mix.title)}&q=${encodeURIComponent(mix.tracks[0] ? `${mix.tracks[0].artist} ${mix.title}` : mix.title)}`;
              return (
                <Link key={mix.title} href={href} className="rounded-2xl p-3 transition-colors hover:bg-pink-950/40">
                  <Cover url={cover} title={mix.title} size={180} className="aspect-square w-full rounded-xl shadow-lg" />
                  <div className="mt-3 truncate text-sm font-semibold text-pink-50">{mix.title}</div>
                  <div className="truncate text-xs text-pink-300/60">Плейлист</div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
