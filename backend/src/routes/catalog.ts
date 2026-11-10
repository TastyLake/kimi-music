import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { HttpError, parse } from '../lib/http.js';
import { matchKey } from '../lib/filename.js';
import { slugify } from '../lib/slug.js';
import { favoriteSet, serializeTrack, trackInclude } from '../lib/serialize.js';
import { authenticate, me } from '../middleware/auth.js';
import { upsertAlbum, upsertArtist } from '../services/catalog.js';
import { deezerTopTracks } from '../services/deezer.js';
import { hiresArtwork, itunesQuery } from '../services/itunes.js';
import { albumTracklist } from '../services/musicbrainz.js';

const nameQuery = z.object({
  name: z.string().trim().min(1).max(200).optional(),
});

const albumQuery = z.object({
  artist: z.string().trim().min(1).max(200).optional(),
  title: z.string().trim().min(1).max(200).optional(),
});

export const artistsRouter = Router();
artistsRouter.use(authenticate());

artistsRouter.get('/:slug', async (req, res) => {
  const slug = String(req.params.slug);
  const { name } = parse(nameQuery, req.query);
  const user = me(req);

  let artist = await prisma.artist.findUnique({ where: { slug } });
  if (!artist) {
    if (!name || slugify(name) !== slug) throw new HttpError(404, 'not_found', 'Исполнитель не найден');
    artist = await upsertArtist({ name });
  }

  await prisma.track.updateMany({
    where: { artist: { equals: artist.name, mode: 'insensitive' }, artistId: null },
    data: { artistId: artist.id },
  });

  const [albums, tracks, topTracks, remoteAlbums, active] = await Promise.all([
    prisma.album.findMany({ where: { artistId: artist.id }, orderBy: { year: 'desc' } }),
    prisma.track.findMany({
      where: { ownerId: user.id, OR: [{ artistId: artist.id }, { artist: { equals: artist.name, mode: 'insensitive' } }] },
      include: trackInclude,
      orderBy: { title: 'asc' },
    }),
    deezerTopTracks(artist.name, 10).catch(() => []),
    itunesQuery(artist.name, 'album', 12).catch(() => []),
    prisma.trackDownload.findMany({
      where: { userId: user.id, status: { in: ['PENDING', 'PROCESSING'] } },
      select: { matchKey: true },
    }),
  ]);

  if (!artist.imageUrl) {
    const art = topTracks[0]?.coverUrl ?? hiresArtwork(remoteAlbums[0]?.artworkUrl100, 600);
    if (art) {
      artist = await prisma.artist.update({ where: { id: artist.id }, data: { imageUrl: art } });
    }
  }

  const knownAlbums = new Map(albums.map((a) => [a.slug, a]));
  for (const row of remoteAlbums) {
    if (!row.collectionName || slugify(row.artistName ?? '') !== artist.slug) continue;
    const albumSlug = slugify(row.collectionName);
    if (knownAlbums.has(albumSlug)) continue;
    knownAlbums.set(albumSlug, {
      id: '',
      artistId: artist.id,
      title: row.collectionName,
      slug: albumSlug,
      year: yearOf(row.releaseDate),
      coverUrl: hiresArtwork(row.artworkUrl100, 600) ?? null,
      itunesId: row.collectionId ? String(row.collectionId) : null,
      createdAt: new Date(),
    });
  }

  const favs = await favoriteSet(user.id, tracks.map((t) => t.id));
  const owned = new Set(tracks.map((t) => t.matchKey));
  const downloading = new Set(active.map((d) => d.matchKey));

  res.json({
    artist: { id: artist.id, name: artist.name, slug: artist.slug, imageUrl: artist.imageUrl },
    albums: [...knownAlbums.values()].map((a) => ({
      title: a.title,
      slug: a.slug,
      artist: artist.name,
      year: a.year,
      coverUrl: a.coverUrl,
    })),
    tracks: tracks.map((t) => serializeTrack(t, { favorites: favs })),
    remoteTracks: topTracks.slice(0, 10).map((s) => {
      const key = matchKey(s.artist, s.title);
      return {
        title: s.title,
        artist: s.artist,
        album: s.album ?? null,
        coverUrl: s.coverUrl ?? null,
        duration: s.duration ?? 0,
        inLibrary: owned.has(key),
        downloading: downloading.has(key),
      };
    }),
  });
});

export const albumsRouter = Router();
albumsRouter.use(authenticate());

albumsRouter.get('/:artistSlug/:albumSlug', async (req, res) => {
  const artistSlug = String(req.params.artistSlug);
  const albumSlug = String(req.params.albumSlug);
  const query = parse(albumQuery, req.query);
  const user = me(req);

  let artist = await prisma.artist.findUnique({ where: { slug: artistSlug } });
  if (!artist) {
    if (!query.artist || slugify(query.artist) !== artistSlug) throw new HttpError(404, 'not_found', 'Исполнитель не найден');
    artist = await upsertArtist({ name: query.artist });
  }

  let album = await prisma.album.findUnique({ where: { artistId_slug: { artistId: artist.id, slug: albumSlug } } });
  if (!album) {
    if (!query.title || slugify(query.title) !== albumSlug) throw new HttpError(404, 'not_found', 'Альбом не найден');
    album = await upsertAlbum({ artistId: artist.id, title: query.title });
  }

  await prisma.track.updateMany({
    where: { artist: { equals: artist.name, mode: 'insensitive' }, artistId: null },
    data: { artistId: artist.id },
  });
  await prisma.track.updateMany({
    where: { artistId: artist.id, album: { equals: album.title, mode: 'insensitive' }, albumId: null },
    data: { albumId: album.id },
  });

  const albumTitle = album.title;
  const [tracks, releaseTracks, remoteSongs, active] = await Promise.all([
    prisma.track.findMany({
      where: {
        ownerId: user.id,
        OR: [
          { albumId: album.id },
          { artist: { equals: artist.name, mode: 'insensitive' }, album: { equals: album.title, mode: 'insensitive' } },
        ],
      },
      include: trackInclude,
      orderBy: { title: 'asc' },
    }),
    albumTracklist(artist.name, albumTitle).catch(() => []),
    itunesQuery(`${artist.name} ${albumTitle}`, 'song', 25).catch(() => []),
    prisma.trackDownload.findMany({
      where: { userId: user.id, status: { in: ['PENDING', 'PROCESSING'] } },
      select: { matchKey: true },
    }),
  ]);

  if (!album.coverUrl) {
    const albumSlug = album.slug;
    const art = hiresArtwork(remoteSongs.find((s) => s.collectionName && slugify(s.collectionName) === albumSlug)?.artworkUrl100, 600);
    if (art) album = await prisma.album.update({ where: { id: album.id }, data: { coverUrl: art } });
  }

  const favs = await favoriteSet(user.id, tracks.map((t) => t.id));
  const owned = new Set(tracks.map((t) => t.matchKey));
  const downloading = new Set(active.map((d) => d.matchKey));

  res.json({
    album: {
      id: album.id,
      title: album.title,
      slug: album.slug,
      year: album.year,
      coverUrl: album.coverUrl,
      artist: { name: artist.name, slug: artist.slug },
    },
    tracks: tracks.map((t) => serializeTrack(t, { favorites: favs })),
    remoteTracks: (releaseTracks.length >= 2
      ? releaseTracks.map((row) => {
          const key = matchKey(row.artist, row.title);
          return {
            title: row.title,
            artist: row.artist,
            album: albumTitle,
            coverUrl: album.coverUrl,
            duration: row.duration,
            inLibrary: owned.has(key),
            downloading: downloading.has(key),
          };
        })
      : remoteSongs
          .filter((s) => s.trackName && s.artistName && s.collectionName && slugify(s.collectionName) === album.slug)
          .map((s) => {
            const key = matchKey(s.artistName, s.trackName);
            return {
              title: s.trackName,
              artist: s.artistName,
              album: s.collectionName ?? albumTitle,
              coverUrl: hiresArtwork(s.artworkUrl100, 300) ?? null,
              duration: s.trackTimeMillis ? Math.round(s.trackTimeMillis / 1000) : 0,
              inLibrary: owned.has(key),
              downloading: downloading.has(key),
            };
          })),
  });
});

function yearOf(releaseDate?: string): number | null {
  const year = Number(releaseDate?.slice(0, 4));
  return year >= 1900 && year <= 2100 ? year : null;
}
