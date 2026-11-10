'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { splitArtists } from '@/lib/artists';
import { albumHref, artistHref } from '@/lib/entity';

const linkClass = 'rounded-sm hover:text-pink-100 hover:underline underline-offset-2 transition-colors';

export function ArtistLink({ name, className }: { name: string; className?: string }) {
  const people = splitArtists(name);
  if (people.length === 0) return null;
  return (
    <span className={className}>
      {people.map((person, index) => (
        <span key={person}>
          {index > 0 ? ', ' : null}
          <Link href={artistHref(person)} className={linkClass} onClick={(e) => e.stopPropagation()}>
            {person}
          </Link>
        </span>
      ))}
    </span>
  );
}

export function AlbumLink({ artist, album, className }: { artist: string; album: string; className?: string }) {
  return (
    <Link href={albumHref(artist, album)} className={cn(linkClass, className)} onClick={(e) => e.stopPropagation()}>
      {album}
    </Link>
  );
}

/** Название, исполнитель и альбом. Ссылки одни и те же в списках и в плеере. */
export function TrackMeta({
  title,
  artist,
  album,
  titleClassName,
  metaClassName,
}: {
  title: string;
  artist: string;
  album?: string | null;
  titleClassName?: string;
  metaClassName?: string;
}) {
  return (
    <div className="min-w-0">
      <div className={cn('truncate', titleClassName)}>{title}</div>
      <div className={cn('truncate', metaClassName)}>
        <ArtistLink name={artist} />
        {album ? (
          <>
            <span className="px-1 text-pink-300/35">·</span>
            <AlbumLink artist={artist} album={album} />
          </>
        ) : null}
      </div>
    </div>
  );
}
