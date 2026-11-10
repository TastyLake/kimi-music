import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { purgeExpiredFailures } from './downloadWorker.js';

const DAY = 86_400_000;
const exists = (p: string) => fs.access(p).then(() => true, () => false);

let running = false;

export async function runCleanup() {
  if (running) return { skipped: true as const };
  running = true;

  try {
    const now = Date.now();

    // 1. Устаревшие Refresh Tokens
    const refreshTokens = (
      await prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      })
    ).count;

    // 2. Ошибки скачивания
    const failed = await purgeExpiredFailures();

    // 3. Завершенные/отмененные скачивания старше 7 дней
    const doneDownloads = (
      await prisma.playlistDownload.deleteMany({
        where: {
          status: { in: ['COMPLETED', 'CANCELLED'] },
          updatedAt: { lt: new Date(now - 7 * DAY) },
        },
      })
    ).count;

    // 4. Жанры без единого трека
    const genres = Number(
      await prisma.$executeRaw`DELETE FROM "genres" g WHERE NOT EXISTS (SELECT 1 FROM "track_genres" tg WHERE tg."genre_id" = g."id")`,
    );

    // 5. Треки, физические файлы которых пропали с диска
    let missingTracks = 0;
    const rootsOk = (await exists(config.MUSIC_DIR)) && (await exists(config.DOWNLOAD_DIR));

    if (rootsOk) {
      let cursor: string | undefined;
      for (;;) {
        const batch = await prisma.track.findMany({
          select: { id: true, filePath: true },
          orderBy: { id: 'asc' },
          take: 500,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });

        if (!batch.length) break;
        cursor = batch.at(-1)!.id;

        const gone: string[] = [];
        for (const t of batch) {
          if (!(await exists(t.filePath))) gone.push(t.id);
        }

        if (gone.length) {
          missingTracks += (await prisma.track.deleteMany({ where: { id: { in: gone } } })).count;
        }
      }
    }

    // 6. Неиспользуемые обложки старше 24 часов
    const used = new Set<string>();
    for (const r of await prisma.track.findMany({ where: { coverImageUrl: { not: null } }, select: { coverImageUrl: true } })) {
      used.add(path.basename(r.coverImageUrl!));
    }
    for (const r of await prisma.playlist.findMany({ where: { coverImage: { not: null } }, select: { coverImage: true } })) {
      used.add(path.basename(r.coverImage!));
    }

    let covers = 0;
    for (const name of await fs.readdir(config.COVERS_DIR).catch(() => [] as string[])) {
      const full = path.join(config.COVERS_DIR, name);
      const st = await fs.stat(full).catch(() => null);
      if (st && !used.has(name) && now - st.mtimeMs > DAY) {
        await fs.rm(full, { force: true });
        covers++;
      }
    }

    // 7. Хвосты временных файлов
    for (const dir of [config.TMP_DIR, path.join(config.DOWNLOAD_DIR, '_tmp')]) {
      for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
        const full = path.join(dir, name);
        const st = await fs.stat(full).catch(() => null);
        if (st && now - st.mtimeMs > DAY) {
          await fs.rm(full, { recursive: true, force: true });
        }
      }
    }

    return { refreshTokens, failed, doneDownloads, genres, missingTracks, covers };
  } finally {
    running = false;
  }
}