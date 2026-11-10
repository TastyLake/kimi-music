import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { parse } from '../lib/http.js';
import { matchKey } from '../lib/filename.js';
import { slugify } from '../lib/slug.js';
import { searchVariants } from '../lib/translit.js';
import { cached } from '../lib/fetch.js';
import { favoriteSet, serializeTrack, trackInclude } from '../lib/serialize.js';
import { authenticate, me } from '../middleware/auth.js';
import { deezerSearch } from '../services/deezer.js';
import { hiresArtwork, itunesQuery, type ItunesSong } from '../services/itunes.js';

export const searchRouter = Router();
searchRouter.use(authenticate());

const querySchema = z.object({
  q: z.string().trim().min(1).max(120),
});

searchRouter.get('/', async (req, res) => {
  const { q } = parse(querySchema, req.query);
  const user = me(req);
  const variants = searchVariants(q);
  const textMatch = variants.flatMap((variant) => [
    { title: { contains: variant, mode: 'insensitive' as const } },
    { artist: { contains: variant, mode: 'insensitive' as const } },
    { album: { contains: variant, mode: 'insensitive' as const } },
  ]);

  const [tracks, artists, catalogArtists, albums, catalogAlbums, remote] = await Promise.all([
    prisma.track.findMany({
      where: {
        ownerId: user.id,
        OR: textMatch,
      },
      include: trackInclude,
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
    prisma.track.findMany({
      where: { ownerId: user.id, OR: variants.map((variant) => ({ artist: { contains: variant, mode: 'insensitive' as const } })) },
      distinct: ['artist'],
      select: { artist: true, coverImageUrl: true },
      take: 6,
    }),
    prisma.artist.findMany({
      where: { OR: variants.map((variant) => ({ name: { contains: variant, mode: 'insensitive' as const } })) },
      select: { name: true, imageUrl: true },
      take: 6,
    }),
    prisma.track.findMany({
      where: { ownerId: user.id, OR: variants.map((variant) => ({ album: { contains: variant, mode: 'insensitive' as const } })) },
      distinct: ['artist', 'album'],
      select: { artist: true, album: true, coverImageUrl: true, year: true },
      take: 6,
    }),
    prisma.album.findMany({
      where: { OR: variants.map((variant) => ({ title: { contains: variant, mode: 'insensitive' as const } })) },
      include: { artist: { select: { name: true } } },
      take: 6,
    }),
    cached(`search:v2:${q.toLowerCase()}`, 60_000, () => externalSearch(q)).catch(() => emptyExternal()),
  ]);

  const favs = await favoriteSet(user.id, tracks.map((t) => t.id));
  const ownedKeys = new Set(tracks.map((t) => t.matchKey));
  const extraOwned = await prisma.track.findMany({
    where: { ownerId: user.id, matchKey: { in: remote.songs.map((s) => matchKey(s.artistName, s.trackName)) } },
    select: { matchKey: true, id: true },
  });
  for (const row of extraOwned) ownedKeys.add(row.matchKey);

  const artistSlugs = new Set([...artists.map((a) => slugify(a.artist)), ...catalogArtists.map((a) => slugify(a.name))]);
  const albumKeys = new Set([
    ...albums.filter((a) => a.album).map((a) => `${slugify(a.artist)}|${slugify(a.album!)}`),
    ...catalogAlbums.map((a) => `${slugify(a.artist.name)}|${slugify(a.title)}`),
  ]);

  res.json({
    query: q,
    tracks: tracks.map((t) => ({ ...serializeTrack(t, { favorites: favs }), inLibrary: true, source: 'library' as const })),
    artists: [
      ...catalogArtists.map((a) => ({ name: a.name, slug: slugify(a.name), imageUrl: a.imageUrl, source: 'library' as const })),
      ...artists
        .filter((a) => !catalogArtists.some((c) => slugify(c.name) === slugify(a.artist)))
        .map((a) => ({ name: a.artist, slug: slugify(a.artist), imageUrl: a.coverImageUrl, source: 'library' as const })),
      ...remote.artists
        .filter((a) => a.artistName && !artistSlugs.has(slugify(a.artistName)))
        .map((a) => ({ name: a.artistName, slug: slugify(a.artistName), imageUrl: hiresArtwork(a.artworkUrl100, 300) ?? null, source: 'itunes' as const })),
    ].slice(0, 8),
    albums: [
      ...catalogAlbums.map((a) => ({
        title: a.title,
        artist: a.artist.name,
        slug: a.slug,
        artistSlug: slugify(a.artist.name),
        coverUrl: a.coverUrl,
        year: a.year,
        source: 'library' as const,
      })),
      ...albums
        .filter((a) => a.album && !catalogAlbums.some((c) => c.slug === slugify(a.album!) && slugify(c.artist.name) === slugify(a.artist)))
        .filter((a) => a.album)
        .map((a) => ({
          title: a.album!,
          artist: a.artist,
          slug: slugify(a.album!),
          artistSlug: slugify(a.artist),
          coverUrl: a.coverImageUrl,
          year: a.year,
          source: 'library' as const,
        })),
      ...remote.albums
        .filter((a) => a.collectionName && a.artistName && !albumKeys.has(`${slugify(a.artistName)}|${slugify(a.collectionName)}`))
        .map((a) => ({
          title: a.collectionName!,
          artist: a.artistName,
          slug: slugify(a.collectionName!),
          artistSlug: slugify(a.artistName),
          coverUrl: hiresArtwork(a.artworkUrl100, 300) ?? null,
          year: yearOf(a.releaseDate),
          source: 'itunes' as const,
        })),
    ].slice(0, 8),
    remoteTracks: remote.songs
      .filter((s) => s.artistName && s.trackName)
      .map((s) => {
        const key = matchKey(s.artistName, s.trackName);
        return {
          title: s.trackName,
          artist: s.artistName,
          album: s.collectionName ?? null,
          coverUrl: hiresArtwork(s.artworkUrl100, 300) ?? null,
          duration: s.trackTimeMillis ? Math.round(s.trackTimeMillis / 1000) : 0,
          inLibrary: ownedKeys.has(key),
          source: 'itunes' as const,
        };
      })
      .filter((s) => !s.inLibrary)
      .slice(0, 8),
  });
});

function yearOf(releaseDate?: string): number | null {
  const year = Number(releaseDate?.slice(0, 4));
  return year >= 1900 && year <= 2100 ? year : null;
}

function emptyExternal() {
  return { songs: [] as ItunesSong[], artists: [] as ItunesSong[], albums: [] as ItunesSong[] };
}

async function externalSearch(q: string) {
  const terms = searchVariants(q).slice(0, 2);
  let batches: { songs: ItunesSong[]; artists: ItunesSong[]; albums: ItunesSong[] }[] = [];
  try {
  batches = await Promise.all(
    terms.map(async (term) => {
      const [songs, artists, albums] = await Promise.all([
        itunesQuery(term, 'song', 8, 4_000),
        itunesQuery(term, 'musicArtist', 5, 4_000),
        itunesQuery(term, 'album', 5, 4_000),
      ]);
      return { songs, artists, albums };
    }),
  );
  } catch (err) {
    console.warn(`[search] iTunes: ${err instanceof Error ? err.message : err}`);
  }
  const merge = (key: 'songs' | 'artists' | 'albums') => {
    const seen = new Set<string>();
    const out: ItunesSong[] = [];
    for (const batch of batches) {
      for (const row of batch[key]) {
        const id = String(row.trackId ?? row.collectionId ?? row.artistId ?? `${row.artistName}-${row.trackName ?? row.collectionName}`);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(row);
      }
    }
    return out;
  };
  const songs = merge('songs');
  const artists = merge('artists');
  const albums = merge('albums');
  if (songs.length > 0 || artists.length > 0) return { songs, artists, albums };

  const deezer = await deezerSearch(q).catch(() => null);
  if (!deezer) return { songs, artists, albums };
  return {
    songs: deezer.tracks.map((track) => ({
      artistName: track.artist,
      trackName: track.title,
      collectionName: track.album,
      artworkUrl100: track.coverUrl,
      trackTimeMillis: track.duration ? track.duration * 1000 : undefined,
    })),
    artists: deezer.artists.map((artist) => ({ artistName: artist.name, artworkUrl100: artist.imageUrl })),
    albums,
  };
}
