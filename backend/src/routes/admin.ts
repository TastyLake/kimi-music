import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { HttpError, cleanQuery, parse, uuid } from '../lib/http.js';
import { matchKey } from '../lib/filename.js';
import { setTrackGenres } from '../lib/genres.js';
import { serializeTrack, serializeUser, trackInclude } from '../lib/serialize.js';
import { authenticate, me, requireAdmin } from '../middleware/auth.js';
import { enrichQueue } from '../jobs/queue.js';
import { isScanRunning, runScan, scanState, userLibraryDir } from '../services/scanner.js';
import { onTrackReady } from '../services/trackEvents.js';
import { runCleanup } from '../services/maintenance.js';

export const adminRouter = Router();
adminRouter.use(authenticate(), requireAdmin);

/* ---------- Сводка для бейджей ---------- */

adminRouter.get('/summary', async (_req, res) => {
  const needsReview = await prisma.track.count({ where: { status: 'NEEDS_REVIEW' } });
  res.json({ needsReview });
});

/* ---------- Запуск ручной очистки (Maintenance) ---------- */

adminRouter.post('/cleanup', async (_req, res) => {
  const result = await runCleanup();
  res.json(result);
});

/* ---------- Пользователи ---------- */

adminRouter.get('/users', async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { playlists: true, favorites: true } } },
  });
  res.json({
    items: users.map((u) => ({
      ...serializeUser(u),
      canUpload: u.canUpload,
      isBlocked: u.isBlocked,
      createdAt: u.createdAt,
      playlists: u._count.playlists,
      favorites: u._count.favorites,
    })),
  });
});

const userPatch = z.object({
  isBlocked: z.boolean().optional(),
  canUpload: z.boolean().optional(),
  role: z.enum(['ADMIN', 'USER']).optional(),
});

adminRouter.patch('/users/:id', async (req, res) => {
  const id = uuid(req.params.id);
  const body = parse(userPatch, req.body);
  if (id === me(req).id && (body.isBlocked === true || body.role === 'USER')) {
    throw new HttpError(400, 'self_action', 'Нельзя заблокировать или разжаловать самого себя');
  }
  const user = await prisma.user.update({ where: { id }, data: body }).catch(() => {
    throw new HttpError(404, 'not_found', 'Пользователь не найден');
  });
  if (body.isBlocked) await prisma.refreshToken.deleteMany({ where: { userId: id } }); // выкидываем из всех сессий
  res.json({ ...serializeUser(user), canUpload: user.canUpload, isBlocked: user.isBlocked });
});

adminRouter.delete('/users/:id', async (req, res) => {
  const id = uuid(req.params.id);
  if (id === me(req).id) throw new HttpError(400, 'self_action', 'Нельзя удалить самого себя');
  await prisma.user.deleteMany({ where: { id } }); // треки удаляются каскадом
  await fs.rm(userLibraryDir(id), { recursive: true, force: true }); // и файлы его медиатеки
  res.status(204).end();
});