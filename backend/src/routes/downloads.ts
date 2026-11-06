import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { HttpError, uuid } from '../lib/http.js';
import { authenticate, me } from '../middleware/auth.js';

export const downloadsRouter = Router();
downloadsRouter.use(authenticate());

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
