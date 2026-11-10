'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Disc3, Loader2, Mic2, Music, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { albumHref, artistHref } from '@/lib/entity';
import type { SearchHit } from '@/lib/types';
import { Cover } from './Cover';
import { DownloadTrackButton } from './DownloadTrackButton';
import { ExternalPlayButton } from './ExternalPlayButton';

export function SearchBar() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SearchHit | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const req = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setData(null);
      setLoading(false);
      return;
    }
    const id = ++req.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      api<SearchHit>('/search', { query: { q: query } })
        .then((res) => {
          if (id === req.current) setData(res);
        })
        .catch(() => {
          if (id === req.current) setData(null);
        })
        .finally(() => {
          if (id === req.current) setLoading(false);
        });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    setQ('');
    router.push(href);
  };

  const empty = data && data.artists.length + data.albums.length + data.tracks.length + data.remoteTracks.length === 0;

  return (
    <div ref={box} className="relative mb-6">
      <div className="flex items-center gap-2 rounded-2xl border border-pink-500/20 bg-pink-950/40 px-3 py-2.5 shadow-sm backdrop-blur-md focus-within:border-pink-400/50">
        {loading ? <Loader2 size={16} className="shrink-0 animate-spin text-pink-300/70" /> : <Search size={16} className="shrink-0 text-pink-300/70" />}
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Поиск треков, альбомов и исполнителей"
          className="w-full bg-transparent text-sm text-pink-50 outline-none placeholder:text-pink-300/40"
        />
      </div>

      {open && q.trim().length >= 2 && (
        <div className="absolute z-30 mt-2 max-h-[70vh] w-full overflow-y-auto rounded-2xl border border-pink-500/20 bg-pink-950/95 p-2 shadow-2xl backdrop-blur-xl">
          {empty && <div className="px-3 py-6 text-center text-sm text-pink-300/60">Ничего не нашлось</div>}

          {data && data.artists.length > 0 && (
            <Section title="Исполнители">
              {data.artists.map((a) => (
                <button key={`${a.source}-${a.slug}`} type="button" className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-pink-900/40" onClick={() => go(artistHref(a.name))}>
                  <Cover url={a.imageUrl} title={a.name} size={36} />
                  <span className="min-w-0 flex-1 truncate text-sm text-pink-50">{a.name}</span>
                  <Mic2 size={14} className="text-pink-300/50" />
                </button>
              ))}
            </Section>
          )}

          {data && data.albums.length > 0 && (
            <Section title="Альбомы">
              {data.albums.map((a) => (
                <button key={`${a.source}-${a.artistSlug}-${a.slug}`} type="button" className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-pink-900/40" onClick={() => go(albumHref(a.artist, a.title))}>
                  <Cover url={a.coverUrl} title={a.title} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-pink-50">{a.title}</span>
                    <span className="block truncate text-xs text-pink-300/60">{a.artist}</span>
                  </span>
                  <Disc3 size={14} className="text-pink-300/50" />
                </button>
              ))}
            </Section>
          )}

          {data && data.tracks.length > 0 && (
            <Section title="В медиатеке">
              {data.tracks.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-pink-900/40"
                  onClick={() => go(t.album ? albumHref(t.artist, t.album) : artistHref(t.artist))}
                >
                  <Cover url={t.coverUrl} title={t.title} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-pink-50">{t.title}</span>
                    <span className="block truncate text-xs text-pink-300/60">
                      {t.artist}
                      {t.album ? ` · ${t.album}` : ''}
                    </span>
                  </span>
                  <Music size={14} className="text-pink-300/50" />
                </button>
              ))}
            </Section>
          )}

          {data && data.remoteTracks.length > 0 && (
            <Section title="Можно скачать">
              {data.remoteTracks.map((t) => (
                <div key={`${t.artist}-${t.title}`} className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-pink-900/40" onClick={() => go(t.album ? albumHref(t.artist, t.album) : artistHref(t.artist))}>
                  <Cover url={t.coverUrl} title={t.title} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-pink-50">{t.title}</span>
                    <span className="block truncate text-xs text-pink-300/60">
                      {t.artist}
                      {t.album ? ` · ${t.album}` : ''}
                    </span>
                  </span>
                  <ExternalPlayButton artist={t.artist} title={t.title} album={t.album} coverUrl={t.coverUrl} duration={t.duration} />
                  <DownloadTrackButton artist={t.artist} title={t.title} album={t.album} coverUrl={t.coverUrl} />
                </div>
              ))}
            </Section>
          )}
        </div>
      )}

    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-pink-300/50">{title}</div>
      {children}
    </div>
  );
}
