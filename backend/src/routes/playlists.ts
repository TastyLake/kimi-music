import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate as authMiddleware } from '../middleware/auth.js';
import type { Request, Response } from 'express';

const router = Router();

router.use(authMiddleware());

const createPlaylistSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().optional(),
});

const updatePlaylistSchema = createPlaylistSchema.partial();
const addTrackSchema = z.object({
  trackId: z.string().uuid(),
});

const formatCover = (img: string | null | undefined) => {
  if (!img) return null;
  if (img.startsWith('http://') || img.startsWith('https://') || img.startsWith('/')) return img;
  return `/media/${img}`;
};

/* ---------------- 1. Получить список плейлистов ---------------- */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const playlists = await prisma.playlist.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { tracks: true } },
        tracks: {
          take: 1,
          include: {
            track: { select: { coverImageUrl: true } },
          },
        },
      },
    });

    const items = playlists.map((p: any) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      isPublic: p.isPublic,
      coverUrl: formatCover(p.coverImage ?? p.tracks[0]?.track?.coverImageUrl),
      trackCount: p._count.tracks,
      owner: req.user!.username,
      isMine: true,
      updatedAt: p.updatedAt.toISOString(),
    }));

    return res.json({ items });
  } catch (error) {
    console.error('[Playlists GET Error]', error);
    return res.status(500).json({ error: 'internal_error', message: 'Ошибка при получении плейлистов' });
  }
});

/* ---------------- 2. Создать плейлист ---------------- */
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = createPlaylistSchema.parse(req.body);
    const userId = req.user!.id;

    const playlist = await prisma.playlist.create({
      data: {
        name: body.name,
        description: body.description,
        isPublic: body.isPublic ?? false,
        userId,
      },
    });

    return res.status(201).json({
      id: playlist.id,
      name: playlist.name,
      description: playlist.description,
      isPublic: playlist.isPublic,
      coverUrl: null,
      trackCount: 0,
      owner: req.user!.username,
      isMine: true,
      updatedAt: playlist.updatedAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'bad_request', message: error.errors[0]?.message ?? 'Неверные данные' });
    }
    return res.status(500).json({ error: 'internal_error', message: 'Не удалось создать плейлист' });
  }
});

/* ---------------- 3. Получить детали плейлиста (Защита от 400/404) ---------------- */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!id || id === 'undefined' || id === 'null') {
      return res.status(400).json({ error: 'bad_request', message: 'Некорректный ID плейлиста' });
    }

    const userId = req.user!.id;

    const playlist = await prisma.playlist.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, username: true } },
        tracks: {
          orderBy: { position: 'asc' },
          include: {
            track: {
              include: {
                genres: { include: { genre: true } },
              },
            },
          },
        },
        downloads: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!playlist) {
      return res.status(404).json({ error: 'not_found', message: 'Плейлист не найден' });
    }

    const isMine = playlist.userId === userId;
    if (!playlist.isPublic && !isMine && req.user!.role !== 'ADMIN') {
      return res.status(403).json({ error: 'forbidden', message: 'Нет доступа к этому плейлисту' });
    }

    const tracks = playlist.tracks.map((pt: any) => ({
      id: pt.track.id,
      title: pt.track.title,
      artist: pt.track.artist,
      album: pt.track.album,
      year: pt.track.year,
      duration: pt.track.duration,
      coverUrl: formatCover(pt.track.coverImageUrl),
      status: pt.track.status,
      createdAt: pt.track.createdAt.toISOString(),
      genres: pt.track.genres?.map((g: any) => ({ name: g.genre.name, primary: g.isPrimary })) ?? [],
    }));

    return res.json({
      id: playlist.id,
      name: playlist.name,
      description: playlist.description,
      isPublic: playlist.isPublic,
      isMine,
      owner: playlist.user?.username ?? req.user!.username,
      tracks,
      downloads: playlist.downloads.map((d: any) => ({
        id: d.id,
        artist: d.artist,
        title: d.title,
        status: d.status,
        progress: d.progress,
        error: d.error,
      })),
    });
  } catch (error) {
    console.error('[Playlist Detail Error]', error);
    return res.status(500).json({ error: 'internal_error', message: 'Ошибка получения плейлиста' });
  }
});

/* ---------------- 4. Обновить плейлист ---------------- */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const userId = req.user!.id;
    const body = updatePlaylistSchema.parse(req.body);

    const playlist = await prisma.playlist.findUnique({ where: { id } });
    if (!playlist) return res.status(404).json({ error: 'not_found', message: 'Плейлист не найден' });
    if (playlist.userId !== userId && req.user!.role !== 'ADMIN') {
      return res.status(403).json({ error: 'forbidden', message: 'Нет прав на редактирование' });
    }

    const updated = await prisma.playlist.update({
      where: { id },
      data: body,
    });

    return res.json({ id: updated.id, name: updated.name, isPublic: updated.isPublic });
  } catch (error) {
    return res.status(500).json({ error: 'internal_error', message: 'Не удалось обновить плейлист' });
  }
});

/* ---------------- 5. Удалить плейлист ---------------- */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!id || id === 'undefined') {
      return res.status(400).json({ error: 'bad_request', message: 'Некорректный ID' });
    }

    const userId = req.user!.id;

    const playlist = await prisma.playlist.findUnique({ where: { id } });
    if (!playlist) return res.status(404).json({ error: 'not_found', message: 'Плейлист не найден' });
    if (playlist.userId !== userId && req.user!.role !== 'ADMIN') {
      return res.status(403).json({ error: 'forbidden', message: 'Нет прав на удаление' });
    }

    // Сначала удаляем связи с треками
    await prisma.playlistTrack.deleteMany({ where: { playlistId: id } });
    await prisma.playlist.delete({ where: { id } });

    return res.status(204).send();
  } catch (error) {
    console.error('[Playlist Delete Error]', error);
    return res.status(500).json({ error: 'internal_error', message: 'Не удалось удалить плейлист' });
  }
});

/* ---------------- 6. Добавить трек в плейлист ---------------- */
router.post('/:id/tracks', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const userId = req.user!.id;
    const { trackId } = addTrackSchema.parse(req.body);

    const playlist = await prisma.playlist.findUnique({ where: { id } });
    if (!playlist) return res.status(404).json({ error: 'not_found', message: 'Плейлист не найден' });
    if (playlist.userId !== userId && req.user!.role !== 'ADMIN') {
      return res.status(403).json({ error: 'forbidden', message: 'Нет доступа' });
    }

    const last = await prisma.playlistTrack.aggregate({
      where: { playlistId: id },
      _max: { position: true },
    });

    const nextPosition = ((last && last._max && last._max.position) ?? 0) + 1;

    try {
      await prisma.playlistTrack.create({
        data: {
          playlistId: id,
          trackId,
          position: nextPosition,
        },
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        return res.json({ success: true, message: 'Трек уже в плейлисте' });
      }
      throw err;
    }

    await prisma.playlist.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    return res.status(201).json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'bad_request', message: error.errors[0]?.message ?? 'Неверный trackId' });
    }
    return res.status(500).json({ error: 'internal_error', message: 'Не удалось добавить трек' });
  }
});

/* ---------------- 7. Удалить трек из плейлиста ---------------- */
router.delete('/:id/tracks/:trackId', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const trackId = String(req.params.trackId);
    const userId = req.user!.id;

    const playlist = await prisma.playlist.findUnique({ where: { id } });
    if (!playlist) return res.status(404).json({ error: 'not_found', message: 'Плейлист не найден' });
    if (playlist.userId !== userId && req.user!.role !== 'ADMIN') {
      return res.status(403).json({ error: 'forbidden', message: 'Нет доступа' });
    }

    await prisma.playlistTrack.deleteMany({
      where: { playlistId: id, trackId },
    });

    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: 'internal_error', message: 'Не удалось убрать трек из плейлиста' });
  }
});

export const playlistsRouter = router;
export default router;
