import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { HttpError, cleanQuery, parse, uuid } from '../lib/http.js';
import { serializeTrack, trackInclude } from '../lib/serialize.js';
import { authenticate, me } from '../middleware/auth.js';

export const favoritesRouter = Router();
favoritesRouter.use(authenticate());

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

favoritesRouter.get('/', async (req, res) => {
  const user = me(req);
  const { page, limit } = parse(pageSchema, cleanQuery(req));
  const where = { userId: user.id, track: { status: 'PARSED' as const, ownerId: user.id } };
  const [total, rows] = await Promise.all([
    prisma.userFavorite.count({ where }),
    prisma.userFavorite.findMany({
      where,
      orderBy: { addedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { track: { include: trackInclude } },
    }),
  ]);
  const all = new Set(rows.map((r) => r.trackId));
  res.json({ items: rows.map((r) => serializeTrack(r.track, { favorites: all })), total, page, limit });
});

favoritesRouter.put('/:trackId', async (req, res) => {
  const trackId = uuid(req.params.trackId, 'trackId');
  const exists = await prisma.track.findFirst({ where: { id: trackId, ownerId: me(req).id }, select: { id: true } });
  if (!exists) throw new HttpError(404, 'not_found', 'Трек не найден');
  await prisma.userFavorite.upsert({
    where: { userId_trackId: { userId: me(req).id, trackId } },
    create: { userId: me(req).id, trackId },
    update: {},
  });
  res.status(204).end();
});

favoritesRouter.delete('/:trackId', async (req, res) => {
  await prisma.userFavorite.deleteMany({ where: { userId: me(req).id, trackId: uuid(req.params.trackId, 'trackId') } });
  res.status(204).end();
});
