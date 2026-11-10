import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { HttpError, parse, uuid } from '../lib/http.js';
import { matchKey } from '../lib/filename.js';
import { authenticate, me } from '../middleware/auth.js';
import { enqueueTrackDownload } from '../jobs/downloadQueue.js';

export const downloadsRouter = Router();
downloadsRouter.use(authenticate());

const createSchema = z.object({
  artist: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  album: z.string().trim().min(1).max(200).optional(),
  coverUrl: z.string().trim().max(500).optional(),
});

downloadsRouter.post('/', async (req, res) => {
  const user = me(req);
  const body = parse(createSchema, req.body);
  const key = matchKey(body.artist, body.title);

  const existing = await prisma.track.findFirst({
    where: { ownerId: user.id, matchKey: key },
    select: { id: true },
  });
  if (existing) return res.json({ status: 'in_library', trackId: existing.id });

  const active = await prisma.trackDownload.findFirst({
    where: { userId: user.id, matchKey: key, status: { in: ['PENDING', 'PROCESSING'] } },
    select: { id: true, status: true },
  });
  if (active) return res.status(202).json({ status: 'queued', downloadId: active.id });

  const download = await prisma.trackDownload.create({
    data: {
      userId: user.id,
      artist: body.artist,
      title: body.title,
      album: body.album,
      coverUrl: body.coverUrl,
      matchKey: key,
      status: 'PENDING',
    },
  });
  await enqueueTrackDownload(download.id).catch((e) => console.error('[download] очередь недоступна:', (e as Error).message));
  res.status(202).json({ status: 'queued', downloadId: download.id });
});

downloadsRouter.get('/:id', async (req, res) => {
  const user = me(req);
  const id = uuid(req.params.id, 'id');
  const row = await prisma.trackDownload.findFirst({
    where: { id, userId: user.id },
    select: { id: true, status: true, progress: true, error: true, trackId: true, artist: true, title: true },
  });
  if (!row) throw new HttpError(404, 'not_found', 'Загрузка не найдена');
  res.json(row);
});

downloadsRouter.delete('/errors', async (req, res) => {
  const user = me(req);
  const result = await prisma.playlistDownload.deleteMany({ where: { userId: user.id, status: 'FAILED' } });
  res.json({ deleted: result.count });
});

downloadsRouter.delete('/errors/:jobId', async (req, res) => {
  const user = me(req);
  const id = uuid(req.params.jobId, 'jobId');
  const row = await prisma.playlistDownload.findFirst({ where: { id, userId: user.id, status: 'FAILED' }, select: { id: true } });
  if (!row) throw new HttpError(404, 'not_found', 'Ошибка не найдена');
  await prisma.playlistDownload.delete({ where: { id } });
  res.status(204).end();
});
