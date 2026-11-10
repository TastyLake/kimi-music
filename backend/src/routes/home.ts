import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { HttpError, parse } from '../lib/http.js';
import { authenticate, me } from '../middleware/auth.js';
import { upsertArtist } from '../services/catalog.js';
import { deezerArtistMix } from '../services/deezer.js';
import { itunesQuery, hiresArtwork } from '../services/itunes.js';
import { splitArtists } from '../lib/artists.js';
import { slugify } from '../lib/slug.js';

export const homeRouter = Router();
homeRouter.use(authenticate());

const playSchema = z.object({ trackId: z.string().uuid() });

export const mixRouter = Router();

mixRouter.get('/:slug', authenticate(), async (req, res) => {
  const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const title = typeof req.query.title === 'string' ? req.query.title.trim() : '';
  const artistName = name || title;
  if (!artistName && !query) throw new HttpError(400, 'bad_request', 'Не указан артист');
  const user = me(req);
  const remote = query
    ? (await itunesQuery(query, 'song', 20).catch(() => [])).map((row) => ({
        title: row.trackName,
        artist: row.artistName,
        album: row.collectionName ?? null,
        coverUrl: hiresArtwork(row.artworkUrl100, 300),
      }))
    : (await deezerArtistMix(artistName).catch(() => [])).map((row) => ({
        title: row.title,
        artist: row.artist,
        album: row.album ?? null,
        coverUrl: row.coverUrl ?? null,
      }));
  const local = await prisma.track.findMany({
    where: { ownerId: user.id, artist: { contains: artistName || remote[0]?.artist || '', mode: 'insensitive' } },
    orderBy: { createdAt: 'desc' },
    take: 12,
  });
  const owned = new Set(local.map((t) => `${t.artist.toLowerCase()}\n${t.title.toLowerCase()}`));
  res.json({
    title: query ? title || query : `Микс: ${artistName} и похожие`,
    tracks: [
      ...local.map((t) => ({ id: t.id, title: t.title, artist: t.artist, album: t.album, coverUrl: t.coverImageUrl, local: true })),
      ...remote
        .filter((t) => !owned.has(`${t.artist.toLowerCase()}\n${t.title.toLowerCase()}`))
        .map((t) => ({ ...t, local: false })),
    ],
  });
});

export const playsRouter = Router();
playsRouter.use(authenticate());

playsRouter.post('/', async (req, res) => {
  const user = me(req);
  const { trackId } = parse(playSchema, req.body);
  const track = await prisma.track.findFirst({
    where: { id: trackId, ownerId: user.id },
    select: { artist: true },
  });
  if (!track) throw new HttpError(404, 'not_found', 'Трек не найден');
  await prisma.play.create({ data: { userId: user.id, trackId, artist: track.artist } });
  res.status(204).end();
});

homeRouter.get('/', async (req, res) => {
  const user = me(req);
  const grouped = await prisma.play.groupBy({
    by: ['artist'],
    where: { userId: user.id },
    _count: { artist: true },
    orderBy: { _count: { artist: 'desc' } },
    take: 5,
  });

  const counts = new Map<string, number>();
  const addRows = (rows: { artist: string; _count: { artist: number } }[]) => {
    for (const row of rows) {
      for (const name of splitArtists(row.artist)) {
        counts.set(name, (counts.get(name) ?? 0) + row._count.artist);
      }
    }
  };
  addRows(grouped);
  if (counts.size === 0) {
    const owned = await prisma.track.groupBy({
      by: ['artist'],
      where: { ownerId: user.id },
      _count: { artist: true },
    });
    addRows(owned);
  }
  const artists = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, plays]) => ({ name, plays }));

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const releases: { artist: string; title: string; coverUrl: string | null; date: string }[] = [];
  for (const artist of artists) {
    const albums = await itunesQuery(artist.name, 'album', 6, 5_000).catch(() => []);
    for (const album of albums) {
      if (!album.collectionName || !album.releaseDate) continue;
      if (slugify(album.artistName || '') !== slugify(artist.name)) continue;
      const time = Date.parse(album.releaseDate);
      if (!Number.isFinite(time) || time < weekAgo) continue;
      releases.push({
        artist: artist.name,
        title: album.collectionName,
        coverUrl: hiresArtwork(album.artworkUrl100, 400) ?? null,
        date: album.releaseDate.slice(0, 10),
      });
    }
  }

  let mixes: { title: string; tracks: { artist: string; title: string; album: string | null; coverUrl: string | null; duration: number }[] }[] | null = null;
  if (releases.length === 0 && artists.length > 0) {
    const seeds = artists.map((a) => a.name);
    const recipes = [
      { title: 'Поп', query: `${seeds[0]} pop` },
      { title: 'Новая школа рэпа', query: `${seeds[1] ?? seeds[0]} hip hop` },
      { title: 'Микс для качалки', query: `${seeds[0]} workout` },
    ];
    mixes = [];
    for (const recipe of recipes) {
      const songs = await itunesQuery(recipe.query, 'song', 8, 5_000).catch(() => []);
      mixes.push({
        title: recipe.title,
        tracks: songs
          .filter((s) => s.artistName && s.trackName)
          .map((s) => ({
            artist: s.artistName,
            title: s.trackName,
            album: s.collectionName ?? null,
            coverUrl: hiresArtwork(s.artworkUrl100, 300) ?? null,
            duration: s.trackTimeMillis ? Math.round(s.trackTimeMillis / 1000) : 0,
          })),
      });
    }
  }

  const cards = await Promise.all(artists.map(async (row) => {
    const existing = await prisma.artist.findUnique({ where: { slug: slugify(row.name) } });
    let imageUrl = existing?.imageUrl ?? null;
    if (!imageUrl) {
      const cover = await prisma.track.findFirst({
        where: { ownerId: user.id, artist: { contains: row.name, mode: 'insensitive' }, coverImageUrl: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { coverImageUrl: true },
      });
      if (cover?.coverImageUrl) {
        const saved = await upsertArtist({ name: row.name, imageUrl: cover.coverImageUrl });
        imageUrl = saved.imageUrl;
      }
    }
    return { ...row, imageUrl };
  }));

  res.json({ artists: cards, releases: releases.slice(0, 12), mixes });
});
