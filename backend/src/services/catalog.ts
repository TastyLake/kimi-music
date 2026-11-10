import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { splitArtists } from '../lib/artists.js';
import { slugify } from '../lib/slug.js';

export async function upsertArtist(input: { name: string; imageUrl?: string | null; itunesId?: string | null }) {
  const name = input.name.trim();
  if (!name) throw new Error('Пустое имя исполнителя');
  const slug = slugify(name);
  const existing = await prisma.artist.findUnique({ where: { slug } });
  if (existing) {
    const data: Prisma.ArtistUpdateInput = {};
    if (input.imageUrl && !existing.imageUrl) data.imageUrl = input.imageUrl;
    if (input.itunesId && !existing.itunesId) data.itunesId = input.itunesId;
    if (Object.keys(data).length === 0) return existing;
    return prisma.artist.update({ where: { id: existing.id }, data });
  }
  try {
    return await prisma.artist.create({
      data: { name, slug, imageUrl: input.imageUrl ?? null, itunesId: input.itunesId ?? null },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const again = await prisma.artist.findUnique({ where: { slug } });
      if (again) return again;
    }
    throw e;
  }
}

export async function upsertAlbum(input: {
  artistId: string;
  title: string;
  year?: number | null;
  coverUrl?: string | null;
  itunesId?: string | null;
}) {
  const title = input.title.trim();
  if (!title) throw new Error('Пустое название альбома');
  const slug = slugify(title);
  const existing = await prisma.album.findUnique({ where: { artistId_slug: { artistId: input.artistId, slug } } });
  if (existing) {
    const data: Prisma.AlbumUpdateInput = {};
    if (input.coverUrl && !existing.coverUrl) data.coverUrl = input.coverUrl;
    if (input.year && !existing.year) data.year = input.year;
    if (input.itunesId && !existing.itunesId) data.itunesId = input.itunesId;
    if (Object.keys(data).length === 0) return existing;
    return prisma.album.update({ where: { id: existing.id }, data });
  }
  try {
    return await prisma.album.create({
      data: {
        artistId: input.artistId,
        title,
        slug,
        year: input.year ?? null,
        coverUrl: input.coverUrl ?? null,
        itunesId: input.itunesId ?? null,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const again = await prisma.album.findUnique({ where: { artistId_slug: { artistId: input.artistId, slug } } });
      if (again) return again;
    }
    throw e;
  }
}

/** Привязывает уже сохранённый трек к карточке исполнителя и альбома, создавая их при необходимости. */
export async function attachTrack(trackId: string): Promise<void> {
  const track = await prisma.track.findUnique({
    where: { id: trackId },
    select: { id: true, artist: true, album: true, year: true, coverImageUrl: true, artistId: true, albumId: true },
  });
  if (!track?.artist.trim()) return;

  const names = splitArtists(track.artist);
  const artists = [];
  for (const name of names) {
    artists.push(await upsertArtist({ name, imageUrl: names[0] === name ? track.coverImageUrl : null }));
  }
  const artist = artists[0];
  if (!artist) return;

  let albumId = track.albumId;
  const albumTitle = track.album?.trim();
  if (albumTitle) {
    const album = await upsertAlbum({
      artistId: artist.id,
      title: albumTitle,
      year: track.year,
      coverUrl: track.coverImageUrl,
    });
    albumId = album.id;
  }

  await prisma.trackArtist.deleteMany({ where: { trackId: track.id } });
  await prisma.trackArtist.createMany({
    data: artists.map((row, position) => ({ trackId: track.id, artistId: row.id, position })),
    skipDuplicates: true,
  });

  if (track.artistId !== artist.id || track.albumId !== albumId) {
    await prisma.track.update({ where: { id: track.id }, data: { artistId: artist.id, albumId } });
  }

  await prisma.track.updateMany({
    where: { artist: { equals: artist.name, mode: 'insensitive' }, artistId: null },
    data: { artistId: artist.id },
  });
  if (albumId && albumTitle) {
    await prisma.track.updateMany({
      where: { artistId: artist.id, album: { equals: albumTitle, mode: 'insensitive' }, albumId: null },
      data: { albumId },
    });
  }
}
