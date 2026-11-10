'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { ArtistLink } from '@/components/TrackMeta';
import { Cover } from '@/components/Cover';
import { ExternalPlayButton } from '@/components/ExternalPlayButton';
import { api } from '@/lib/api';
import { usePlayer } from '@/store/player';

interface MixTrack {
  id?: string;
  title: string;
  artist: string;
  album: string | null;
  coverUrl: string | null;
  local: boolean;
}

export default function MixPage() {
  const params = useParams<{ slug: string }>();
  const search = useSearchParams();
  const name = search.get('name') ?? '';
  const title = search.get('title') ?? '';
  const q = search.get('q') ?? '';
  const [mix, setMix] = useState<{ title: string; tracks: MixTrack[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ title: string; tracks: MixTrack[] }>(`/mixes/${params.slug}`, { query: { name, title, q } })
      .then(setMix)
      .catch((e: Error) => setError(e.message));
  }, [params.slug, name, title, q]);

  if (error) return <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>;
  if (!mix) return <div className="py-16 text-center text-sm text-pink-300/60">Собираем микс…</div>;

  const playAll = () => {
    const locals = mix.tracks.filter((t): t is MixTrack & { id: string } => Boolean(t.local && t.id));
    usePlayer.getState().playQueue(
      locals.map((t) => ({ kind: 'local' as const, id: t.id, title: t.title, artist: t.artist, album: t.album, coverUrl: t.coverUrl, duration: 0 })),
    );
  };

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-pink-300/50">Плейлист</div>
          <h1 className="text-3xl font-bold text-pink-50">{mix.title}</h1>
        </div>
        <button type="button" className="rounded-full bg-pink-500 px-5 py-2 text-sm font-semibold text-white" onClick={playAll} disabled={!mix.tracks.some((t) => t.local)}>
          Играть
        </button>
      </header>
      <div className="divide-y divide-pink-500/10 overflow-hidden rounded-2xl border border-pink-500/15 bg-pink-950/20">
        {mix.tracks.map((track, index) => (
          <div key={`${track.artist}-${track.title}-${index}`} className="flex items-center gap-3 px-4 py-2.5">
            <Cover url={track.coverUrl} title={track.title} size={40} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-pink-50">{track.title}</div>
              <div className="truncate text-xs text-pink-300/60"><ArtistLink name={track.artist} /></div>
            </div>
            {track.local && track.id ? (
              <button
                type="button"
                className="rounded-xl border border-pink-400/40 px-3 py-1.5 text-xs font-semibold text-pink-100"
                onClick={() =>
                  usePlayer.getState().playQueue([
                    { kind: 'local', id: track.id!, title: track.title, artist: track.artist, album: track.album, coverUrl: track.coverUrl, duration: 0 },
                  ])
                }
              >
                Слушать
              </button>
            ) : (
              <ExternalPlayButton artist={track.artist} title={track.title} album={track.album} coverUrl={track.coverUrl} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
