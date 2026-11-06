import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { HttpError, cleanQuery, parse, uuid } from '../lib/http.js';
import { MIME_BY_EXT, parseRange } from '../lib/range.js';
import { favoriteSet, serializeTrack, trackInclude } from '../lib/serialize.js';
import { authenticate, me } from '../middleware/auth.js';

export const tracksRouter = Router();

const listSchema = z.object({
  q: z.string().trim().max(200).optional(),
  genre: z.string().trim().max(60).optional(),
  artist: z.string().trim().max(200).optional(),
  year: z.coerce.number().int().optional(),
  yearFrom: z.coerce.number().int().optional(),
  yearTo: z.coerce.number().int().optional(),
  addedFrom: z.coerce.date().optional(),
  addedTo: z.coerce.date().optional(),
  status: z.enum(['PARSED', 'NEEDS_REVIEW']).optional(),
  sort: z.enum(['added', 'artist', 'title', 'year', 'duration']).default('added'),
  order: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type TrackListQuery = z.output<typeof listSchema>;

/** Медиатека личная: в выборку попадают только треки владельца. */
export function buildTrackWhere(q: TrackListQuery, ownerId: string, isAdmin: boolean): Prisma.TrackWhereInput {
  const and: Prisma.TrackWhereInput[] = [{ ownerId }, { status: (isAdmin && q.status) || 'PARSED' }];

  // Поиск по исполнителю и названию: каждое слово должно встретиться в одном из полей
  for (const token of (q.q ?? '').split(/\s+/).filter(Boolean).slice(0, 6)) {
    and.push({
      OR: [
        { artist: { contains: token, mode: 'insensitive' } },
        { title: { contains: token, mode: 'insensitive' } },
      ],
    });
  }
  if (q.genre) and.push({ genres: { some: { genre: { name: { equals: q.genre, mode: 'insensitive' } } } } });
  if (q.artist) and.push({ artist: { equals: q.artist, mode: 'insensitive' } });
  if (q.year != null) and.push({ year: q.year });
  if (q.yearFrom != null) and.push({ year: { gte: q.yearFrom } });
  if (q.yearTo != null) and.push({ year: { lte: q.yearTo } });
  if (q.addedFrom) and.push({ createdAt: { gte: q.addedFrom } });
  if (q.addedTo) and.push({ createdAt: { lte: q.addedTo } });
  return { AND: and };
}

export function buildTrackOrder(q: TrackListQuery): Prisma.TrackOrderByWithRelationInput[] {
  const dir = q.order ?? (q.sort === 'added' ? 'desc' : 'asc');
  const orderBy: Prisma.TrackOrderByWithRelationInput[] =
    q.sort === 'artist'
      ? [{ artist: dir }, { title: dir }]
      : q.sort === 'title'
        ? [{ title: dir }, { artist: dir }]
        : q.sort === 'year'
          ? [{ year: { sort: dir, nulls: 'last' } }, { artist: 'asc' }]
          : q.sort === 'duration'
            ? [{ duration: dir }]
            : [{ createdAt: dir }];
  orderBy.push({ id: 'asc' }); // стабильная пагинация
  return orderBy;
}

tracksRouter.get('/tracks', authenticate(), async (req, res) => {
  const user = me(req);
  const q = parse(listSchema, cleanQuery(req));
  const isAdmin = user.role === 'ADMIN';
  const where = buildTrackWhere(q, user.id, isAdmin);

  const [total, rows] = await Promise.all([
    prisma.track.count({ where }),
    prisma.track.findMany({
      where,
      orderBy: buildTrackOrder(q),
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      include: trackInclude,
    }),
  ]);
  const favs = await favoriteSet(user.id, rows.map((r) => r.id));
  res.json({
    items: rows.map((r) => serializeTrack(r, { admin: isAdmin, favorites: favs })),
    total,
    page: q.page,
    limit: q.limit,
  });
});

/** Динамические данные для фильтров из личной медиатеки: жанры (с количеством треков) и диапазон годов. */
tracksRouter.get('/filters', authenticate(), async (req, res) => {
  const ownerId = me(req).id;
  const trackWhere = { ownerId, status: 'PARSED' as const };
  const [perGenre, years] = await Promise.all([
    prisma.trackGenre.groupBy({ by: ['genreId'], where: { track: trackWhere }, _count: { _all: true } }),
    prisma.track.aggregate({ where: trackWhere, _min: { year: true }, _max: { year: true } }),
  ]);
  const names = await prisma.genre.findMany({
    where: { id: { in: perGenre.map((g) => g.genreId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(names.map((g) => [g.id, g.name]));
  res.json({
    genres: perGenre
      .map((g) => ({ name: nameById.get(g.genreId) ?? '', count: g._count._all }))
      .filter((g) => g.name)
      .sort((a, b) => a.name.localeCompare(b.name)),
    years: { min: years._min.year, max: years._max.year },
  });
});

tracksRouter.get('/tracks/:id', authenticate(), async (req, res) => {
  const user = me(req);
  const track = await prisma.track.findUnique({ where: { id: uuid(req.params.id) }, include: trackInclude });
  const isAdmin = user.role === 'ADMIN';
  if (!track || (track.ownerId !== user.id && !isAdmin) || (track.status !== 'PARSED' && !isAdmin)) {
    throw new HttpError(404, 'not_found', 'Трек не найден');
  }
  const favs = await favoriteSet(user.id, [track.id]);
  res.json(serializeTrack(track, { admin: isAdmin, favorites: favs }));
});

/**
 * Удаление трека из своей медиатеки (админ может удалить любой). Файл с диска удаляется тоже,
 * иначе следующее сканирование вернуло бы трек обратно.
 */
tracksRouter.delete('/tracks/:id', authenticate(), async (req, res) => {
  const user = me(req);
  const id = uuid(req.params.id);
  const track = await prisma.track.findUnique({ where: { id }, select: { ownerId: true, filePath: true } });
  if (!track || (track.ownerId !== user.id && user.role !== 'ADMIN')) {
    throw new HttpError(404, 'not_found', 'Трек не найден');
  }
  await prisma.track.delete({ where: { id } });
  // Файлы вне музыкальной папки не трогаем
  const ownedDir = [config.MUSIC_DIR, config.DOWNLOAD_DIR].some((dir) => track.filePath.startsWith(dir + path.sep));
  if (ownedDir) {
    await fs.rm(track.filePath, { force: true }).catch((e: Error) => console.warn('[tracks] файл не удалён:', e.message));
  }
  res.status(204).end();
});

/**
 * Стриминг с поддержкой HTTP Range: 206 Partial Content позволяет перематывать трек
 * без полной загрузки. Токен можно передать в ?token= (элемент <audio> не умеет заголовки).
 * Слушать можно только свои треки (админ — любые, для проверки нераспознанных файлов).
 */
tracksRouter.get('/tracks/:id/stream', authenticate({ forStreaming: true }), async (req, res) => {
  const user = me(req);
  const id = uuid(req.params.id);
  const track = await prisma.track.findUnique({ where: { id }, select: { filePath: true, ownerId: true } });
  if (!track || (track.ownerId !== user.id && user.role !== 'ADMIN')) throw new HttpError(404, 'not_found', 'Трек не найден');

  let stat;
  try {
    stat = await fs.stat(track.filePath);
  } catch {
    throw new HttpError(404, 'file_missing', 'Файл не найден на диске');
  }

  const size = stat.size;
  res.setHeader('Content-Type', MIME_BY_EXT[path.extname(track.filePath).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Last-Modified', stat.mtime.toUTCString());
  res.setHeader('Cache-Control', 'private, max-age=3600');

  const range = parseRange(req.headers.range, size);
  if (range === 'unsatisfiable') {
    res.status(416);
    res.setHeader('Content-Range', `bytes */${size}`);
    res.end();
    return;
  }

  let start = 0;
  let end = size - 1;
  if (range) {
    ({ start, end } = range);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  } else {
    res.status(200);
  }
  res.setHeader('Content-Length', String(Math.max(end - start + 1, 0)));

  if (req.method === 'HEAD' || size === 0) {
    res.end();
    return;
  }

  const stream = createReadStream(track.filePath, { start, end });
  res.on('close', () => stream.destroy());
  await pipeline(stream, res).catch(() => undefined); // обрыв соединения клиентом — нормальная ситуация
});
