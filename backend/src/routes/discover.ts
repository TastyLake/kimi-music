import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { HttpError, parse } from '../lib/http.js';
import { matchKey } from '../lib/filename.js';
import {
  GENRE_TAGS,
  annotate,
  discoverMeta,
  getChart,
  getGenreTop,
  getNewReleases,
  resolvePreview,
  type ExternalList,
} from '../services/discover.js';
import { authenticate, me } from '../middleware/auth.js';

export const discoverRouter = Router();
discoverRouter.use(authenticate());

const countrySchema = z.object({
  country: z
    .string()
    .regex(/^[A-Za-z]{2}$/, 'нужен двухбуквенный код страны')
    .transform((s) => s.toUpperCase())
    .default('US'),
});

async function respond(userId: string, load: () => Promise<ExternalList>, extra: Record<string, unknown>) {
  let list: ExternalList;
  try {
    list = await load();
  } catch (e) {
    throw new HttpError(502, 'external_unavailable', `Внешний сервис недоступен: ${(e as Error).message}`);
  }
  return { ...extra, source: list.source, items: await annotate(list.items, userId) };
}

discoverRouter.get('/meta', (_req, res) => {
  res.json(discoverMeta());
});

discoverRouter.get('/charts', async (req, res) => {
  const { country } = parse(countrySchema, req.query);
  res.json(await respond(me(req).id, () => getChart(country), { kind: 'chart', country }));
});

discoverRouter.get('/new', async (req, res) => {
  const { country } = parse(countrySchema, req.query);
  res.json(await respond(me(req).id, () => getNewReleases(country), { kind: 'new', country }));
});

discoverRouter.get('/genre/:tag', async (req, res) => {
  const tag = String(req.params.tag);
  if (!GENRE_TAGS.some((g) => g.tag === tag)) throw new HttpError(404, 'unknown_genre', 'Неизвестный жанр');
  const genre = GENRE_TAGS.find((g) => g.tag === tag);
  res.json(await respond(me(req).id, () => getGenreTop(tag), { kind: 'genre', genre: tag, label: genre?.label }));
});

const downloadSchema = z.object({
  artist: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
});

discoverRouter.post('/download', async (req, res) => {
  const user = me(req);
  const body = parse(downloadSchema, req.body);
  const key = matchKey(body.artist, body.title);

  const existing = await prisma.track.findFirst({
    where: { ownerId: user.id, matchKey: key },
    select: { id: true },
  });
  if (existing) {
    return res.status(200).json({ status: 'in_library', trackId: existing.id });
  }

  // Создаём универсальный плейлист "Discover" для пользователя, если его нет
  let playlist = await prisma.playlist.findFirst({
    where: { userId: user.id, name: 'Загрузки из обзора' },
    select: { id: true },
  });
  if (!playlist) {
    playlist = await prisma.playlist.create({
      data: { userId: user.id, name: 'Загрузки из обзора' },
      select: { id: true },
    });
  }

  const count = await prisma.playlistDownload.count({ where: { playlistId: playlist.id } });

  const download = await prisma.playlistDownload.create({
    data: {
      playlistId: playlist.id,
      userId: user.id,
      artist: body.artist,
      title: body.title,
      matchKey: key,
      position: count + 1,
      status: 'PENDING',
    },
  });

  res.status(202).json({ status: 'queued', downloadId: download.id });
});

const previewSchema = z.object({ artist: z.string().trim().min(1).max(200), title: z.string().trim().min(1).max(200) });

discoverRouter.get('/preview', async (req, res) => {
  const { artist, title } = parse(previewSchema, req.query);
  let found;
  try {
    found = await resolvePreview(artist, title);
  } catch (e) {
    throw new HttpError(502, 'external_unavailable', `Внешний сервис недоступен: ${(e as Error).message}`);
  }
  if (!found) throw new HttpError(404, 'not_found', 'Превью не найдено');
  res.json(found);
});