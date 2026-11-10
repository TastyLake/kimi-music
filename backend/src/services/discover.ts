import { prisma } from '../lib/prisma.js';
import { matchKey } from '../lib/filename.js';

export interface ExternalItem {
  artist: string;
  title: string;
  album?: string;
  coverUrl?: string;
  previewUrl?: string;
  inLibrary?: boolean;
  libraryTrackId?: string;
  downloading?: boolean;
}

export interface ExternalList {
  source: string;
  items: ExternalItem[];
}

export const GENRE_TAGS = [
  { tag: 'pop', label: 'Pop' },
  { tag: 'rock', label: 'Rock' },
  { tag: 'hiphop', label: 'Hip-Hop' },
  { tag: 'electronic', label: 'Electronic' },
  { tag: 'dance', label: 'Dance' },
  { tag: 'indie', label: 'Indie' },
  { tag: 'metal', label: 'Metal' },
  { tag: 'rnb', label: 'R&B' },
] as const;

export function discoverMeta() {
  return {
    genres: GENRE_TAGS,
  };
}

export async function annotate(items: ExternalItem[], userId: string): Promise<ExternalItem[]> {
  if (!items.length) return [];

  const keys = items.map((i) => matchKey(i.artist, i.title));

  const [existingTracks, activeDownloads] = await Promise.all([
    prisma.track.findMany({
      where: { ownerId: userId, matchKey: { in: keys } },
      select: { matchKey: true, id: true },
    }),
    prisma.playlistDownload.findMany({
      where: { userId, status: { in: ['PENDING', 'PROCESSING'] } },
      select: { artist: true, title: true },
    }),
  ]);

  const existingMap = new Map(existingTracks.map((t) => [t.matchKey, t.id]));
  const downloadingSet = new Set(activeDownloads.map((d) => matchKey(d.artist, d.title)));

  return items.map((item) => {
    const key = matchKey(item.artist, item.title);
    const libraryTrackId = existingMap.get(key);
    const downloading = downloadingSet.has(key);

    return {
      ...item,
      inLibrary: Boolean(libraryTrackId),
      libraryTrackId,
      downloading,
    };
  });
}

export async function getChart(_country: string): Promise<ExternalList> {
  return { source: 'chart', items: [] };
}

export async function getNewReleases(_country: string): Promise<ExternalList> {
  return { source: 'new', items: [] };
}

export async function getGenreTop(_tag: string): Promise<ExternalList> {
  return { source: 'genre', items: [] };
}

export async function resolvePreview(_artist: string, _title: string): Promise<{ previewUrl: string } | null> {
  return null;
}