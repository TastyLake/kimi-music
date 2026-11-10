import type { Prisma } from '@prisma/client';
import { splitArtists } from './artists.js';
import { prisma } from './prisma.js';

export const trackInclude = { genres: { include: { genre: true } } } satisfies Prisma.TrackInclude;
export type TrackFull = Prisma.TrackGetPayload<{ include: typeof trackInclude }>;

export function serializeTrack(t: TrackFull, opts: { admin?: boolean; favorites?: Set<string> } = {}) {
  const genres = [...t.genres]
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
    .map((g) => ({ name: g.genre.name, primary: g.isPrimary }));
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    artists: splitArtists(t.artist),
    album: t.album,
    year: t.year,
    duration: t.duration,
    coverUrl: t.coverImageUrl,
    status: t.status,
    genres,
    createdAt: t.createdAt,
    isFavorite: opts.favorites ? opts.favorites.has(t.id) : undefined,
    ...(opts.admin
      ? { filePath: t.filePath, fileSize: Number(t.fileSize), fileHash: t.fileHash, enrichedAt: t.enrichedAt }
      : {}),
  };
}

export async function favoriteSet(userId: string, trackIds: string[]): Promise<Set<string>> {
  if (trackIds.length === 0) return new Set();
  const rows = await prisma.userFavorite.findMany({
    where: { userId, trackId: { in: trackIds } },
    select: { trackId: true },
  });
  return new Set(rows.map((r) => r.trackId));
}

export function serializeUser(u: { id: string; username: string; email: string; role: string; canUpload: boolean }) {
  return { id: u.id, username: u.username, email: u.email, role: u.role, canUpload: u.canUpload || u.role === 'ADMIN' };
}
