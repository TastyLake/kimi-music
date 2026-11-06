import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { HttpError, parse } from '../lib/http.js';
import { matchKey } from '../lib/filename.js';
import { MAX_IMPORT_TRACKS, parseImportText, type ImportTrack } from '../lib/playlistImport.js';
import { authenticate, me } from '../middleware/auth.js';
import { kickDownloadQueue } from '../services/downloadWorker.js';

export const importRouter = Router();
importRouter.use(authenticate());

importRouter.get('/config', (_req, res) => {
  res.json({ spotifyClientId: config.SPOTIFY_CLIENT_ID ?? null });
});

const trackSchema = z.object({ artist: z.string().trim().min(1).max(200), title: z.string().trim().min(1).max(200) });

const importSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    /** Список, полученный в браузере (например, из Spotify API) */
    tracks: z.array(trackSchema).max(MAX_IMPORT_TRACKS).optional(),
    /** Или содержимое файла: CSV из Exportify либо строки «Исполнитель - Название» */
    text: z.string().max(2_000_000).optional(),
  })
  .refine((v) => v.tracks?.length || v.text?.trim(), { message: 'Передайте tracks или text' });

/**
 * Импорт плейлиста. Треки, которые уже есть в медиатеке, привязываются сразу.
 * Недостающие становятся задачами PENDING; скачивание идёт в фоне, ответ не ждёт файлов.
 */
importRouter.post('/playlist', async (req, res) => {
  const user = me(req);
  const body = parse(importSchema, req.body);

  const list: ImportTrack[] = body.tracks?.length ? body.tracks : parseImportText(body.text ?? '');
  if (list.length === 0) {
    throw new HttpError(422, 'nothing_to_import', 'Не удалось найти треки. Нужен CSV из Exportify или строки вида «Исполнитель - Название».');
  }

  const keyed = list.map((t, position) => ({ ...t, position, key: matchKey(t.artist, t.title) }));
  const found = await prisma.track.findMany({
    where: { ownerId: user.id, status: 'PARSED', matchKey: { in: [...new Set(keyed.map((k) => k.key))] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, matchKey: true },
  });
  const byKey = new Map<string, string>();
  for (const t of found) if (!byKey.has(t.matchKey)) byKey.set(t.matchKey, t.id);

  const canDownload = user.role === 'ADMIN' || user.canUpload;
  const linked: { trackId: string; position: number }[] = [];
  const pending: { artist: string; title: string; matchKey: string; position: number }[] = [];
  const seenTracks = new Set<string>();
  const seenMissing = new Set<string>();
  const tracks: { artist: string; title: string; status: 'matched' | 'pending' }[] = [];

  for (const k of keyed) {
    const id = byKey.get(k.key);
    if (id) {
      tracks.push({ artist: k.artist, title: k.title, status: 'matched' });
      if (!seenTracks.has(id)) {
        seenTracks.add(id);
        linked.push({ trackId: id, position: k.position });
      }
      continue;
    }
    tracks.push({ artist: k.artist, title: k.title, status: 'pending' });
    if (seenMissing.has(k.key)) continue;
    seenMissing.add(k.key);
    pending.push({ artist: k.artist, title: k.title, matchKey: k.key, position: k.position });
  }

  const playlist = await prisma.playlist.create({
    data: {
      userId: user.id,
      name: body.name,
      description: `Импорт: ${list.length} треков, в медиатеке ${linked.length}, к загрузке ${canDownload ? pending.length : 0}`,
      tracks: { create: linked },
      ...(canDownload && pending.length > 0
        ? {
            downloads: {
              create: pending.map((t) => ({
                userId: user.id,
                artist: t.artist,
                title: t.title,
                matchKey: t.matchKey,
                position: t.position,
              })),
            },
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      downloads: { select: { id: true, artist: true, title: true, status: true, error: true }, orderBy: { position: 'asc' } },
    },
  });

  if (playlist.downloads.length > 0) kickDownloadQueue();

  const missing = pending.map(({ artist, title }) => ({ artist, title }));
  res.status(201).json({
    playlist: { id: playlist.id, name: playlist.name },
    total: list.length,
    matched: linked.length,
    pending: playlist.downloads.length,
    missing,
    tracks,
    downloads: playlist.downloads,
  });
});
