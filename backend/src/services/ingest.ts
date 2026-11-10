import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Prisma, type TrackStatus } from '@prisma/client';
import { parseFile, type IAudioMetadata } from 'music-metadata';
import { prisma } from '../lib/prisma.js';
import { matchKey, parseFileName, splitExtension } from '../lib/filename.js';
import { saveCoverBuffer } from '../lib/covers.js';
import { setTrackGenres } from '../lib/genres.js';
import { attachTrack } from './catalog.js';
import { onTrackReady } from './trackEvents.js';

export type IngestStatus = 'created' | 'updated' | 'skipped' | 'duplicate' | 'error';

export interface IngestResult {
  status: IngestStatus;
  trackId?: string;
  needsReview?: boolean;
  error?: string;
}

/**
 * Нормализует строки с нарушенной кодировкой UTF-8 (модзибакэ Latin1 -> UTF8)
 */
function fixEncodingText(text?: string | null): string | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  // Проверяем наличие типичных символов битой кириллицы (Ð, Ñ и т.д.)
  if (/[ÐÑ]/.test(trimmed)) {
    try {
      const restored = Buffer.from(trimmed, 'latin1').toString('utf8');
      return restored.includes('\uFFFD') ? trimmed : restored;
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

export function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    createReadStream(filePath)
      .on('error', reject)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')));
  });
}

export async function readMeta(filePath: string): Promise<IAudioMetadata | null> {
  try {
    return await parseFile(filePath, { duration: true });
  } catch {
    return null;
  }
}

const USELESS_GENRES = new Set(['music', 'other', 'unknown', 'misc', 'general', 'soundtrack']);

function usefulGenres(names: Array<string | undefined>): string[] {
  return names.filter((name): name is string => !!name && !USELESS_GENRES.has(name.toLowerCase()));
}

const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

/**
 * Добавляет (или обновляет) один файл в библиотеке.
 *  1. имя «Исполнитель - Название» → PARSED
 *  2. иначе теги внутри файла (artist + title) → PARSED
 *  3. иначе → NEEDS_REVIEW (попадает в админ-панель на ручную правку)
 * Дубликаты определяются по SHA-256 содержимого (в пределах медиатеки одного пользователя) и по абсолютному пути.
 */
export async function ingestFile(absPath: string, opts: { ownerId: string; knownHash?: string }): Promise<IngestResult> {
  try {
    const stat = await fs.stat(absPath);
    const size = BigInt(stat.size);
    const mtime = BigInt(Math.floor(stat.mtimeMs));

    const existing = await prisma.track.findUnique({ where: { filePath: absPath } });
    // Быстрый путь: размер и mtime не изменились — файл не перечитываем и не хэшируем
    if (existing && existing.fileSize === size && existing.fileMtimeMs === mtime) {
      return { status: 'skipped', trackId: existing.id };
    }

    const hash = opts.knownHash ?? (await hashFile(absPath));

    if (existing) {
      if (existing.fileHash === hash) {
        await prisma.track.update({ where: { id: existing.id }, data: { fileSize: size, fileMtimeMs: mtime } });
        return { status: 'skipped', trackId: existing.id };
      }
      const clash = await prisma.track.findUnique({
        where: { ownerId_fileHash: { ownerId: opts.ownerId, fileHash: hash } },
      });
      if (clash && clash.id !== existing.id) return { status: 'duplicate', trackId: clash.id };
      const meta = await readMeta(absPath);
      await prisma.track.update({
        where: { id: existing.id },
        data: {
          fileHash: hash,
          fileSize: size,
          fileMtimeMs: mtime,
          duration: Math.round(meta?.format.duration ?? existing.duration),
        },
      });
      return { status: 'updated', trackId: existing.id };
    }

    const dup = await prisma.track.findUnique({
      where: { ownerId_fileHash: { ownerId: opts.ownerId, fileHash: hash } },
    });
    if (dup) {
      if (dup.filePath !== absPath && !(await exists(dup.filePath))) {
        // Файл переместили/переименовали — просто обновляем путь
        await prisma.track.update({
          where: { id: dup.id },
          data: { filePath: absPath, fileSize: size, fileMtimeMs: mtime },
        });
        return { status: 'updated', trackId: dup.id };
      }
      return { status: 'duplicate', trackId: dup.id };
    }

    const meta = await readMeta(absPath);
    const fileName = fixEncodingText(path.basename(absPath)) ?? path.basename(absPath);
    const fromName = parseFileName(fileName);
    
    // Прогоняем метаданные через функцию исправления кодировки
    const tagArtist = fixEncodingText(meta?.common.artist);
    const tagTitle = fixEncodingText(meta?.common.title);
    const tagAlbum = fixEncodingText(meta?.common.album);

    let artist: string;
    let title: string;
    let status: TrackStatus;
    if (fromName) {
      ({ artist, title } = fromName);
      status = 'PARSED';
    } else if (tagArtist && tagTitle) {
      artist = tagArtist;
      title = tagTitle;
      status = 'PARSED';
    } else {
      artist = tagArtist || 'Unknown Artist';
      title = tagTitle || splitExtension(fileName).base;
      status = 'NEEDS_REVIEW';
    }

    const pic = meta?.common.picture?.[0];
    const coverImageUrl = pic ? await saveCoverBuffer(Buffer.from(pic.data), pic.format) : null;

    const track = await prisma.track.create({
      data: {
        ownerId: opts.ownerId,
        filePath: absPath,
        fileHash: hash,
        fileSize: size,
        fileMtimeMs: mtime,
        title,
        artist,
        album: tagAlbum || null,
        year: meta?.common.year ?? null,
        duration: Math.round(meta?.format.duration ?? 0),
        coverImageUrl,
        matchKey: matchKey(artist, title),
        status,
      },
    });

    const tagGenres = usefulGenres(meta?.common.genre?.map((g) => fixEncodingText(g)) ?? []);
    if (tagGenres.length) await setTrackGenres(track.id, tagGenres);

    await attachTrack(track.id).catch((e) => console.warn('[catalog]', (e as Error).message));
    if (status === 'PARSED') onTrackReady(track.id);
    return { status: 'created', trackId: track.id, needsReview: status === 'NEEDS_REVIEW' };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { status: 'duplicate' }; // гонка: тот же файл добавлен параллельным потоком
    }
    return { status: 'error', error: `${path.basename(absPath)}: ${(e as Error).message}` };
  }
}

/** Дочитывает длительность, обложку, жанр и альбом у уже сохранённых файлов. Недостающее отдаёт в очередь обогащения. */
export async function repairStoredMetadata(): Promise<void> {
  const tracks = await prisma.track.findMany({
    where: {
      OR: [{ duration: 0 }, { coverImageUrl: null }, { genres: { none: {} } }],
    },
    include: { genres: { select: { trackId: true } } },
  });

  let updated = 0;
  for (const track of tracks) {
    try {
      await fs.access(track.filePath);
    } catch {
      continue;
    }

    const meta = await readMeta(track.filePath);
    const data: Prisma.TrackUpdateInput = {};
    if (meta) {
      const duration = Math.round(meta.format.duration ?? 0);
      if (track.duration === 0 && duration > 0) data.duration = duration;
      const album = fixEncodingText(meta.common.album);
      if (!track.album && album) data.album = album;
      if (track.year == null && meta.common.year) data.year = meta.common.year;
      if (!track.coverImageUrl) {
        const pic = meta.common.picture?.[0];
        if (pic) {
          const cover = await saveCoverBuffer(Buffer.from(pic.data), pic.format);
          if (cover) data.coverImageUrl = cover;
        }
      }
      if (track.genres.length === 0) {
        const tagGenres = usefulGenres(meta.common.genre?.map((g) => fixEncodingText(g)) ?? []);
        if (tagGenres.length) await setTrackGenres(track.id, tagGenres);
      }
    }

    if (Object.keys(data).length) {
      await prisma.track.update({ where: { id: track.id }, data });
      updated += 1;
    }

    const fresh = await prisma.track.findUnique({ where: { id: track.id }, include: { genres: true } });
    if (fresh?.status === 'PARSED' && (fresh.duration === 0 || !fresh.coverImageUrl || fresh.genres.length === 0)) {
      onTrackReady(fresh.id);
    }
  }

  const labeled = await prisma.track.findMany({
    where: { status: 'PARSED', genres: { some: {} } },
    select: { id: true, genres: { include: { genre: { select: { name: true } } } } },
  });
  let requeued = 0;
  for (const track of labeled) {
    const names = track.genres.map((g) => g.genre.name);
    if (names.length === 0 || names.some((name) => !USELESS_GENRES.has(name.toLowerCase()))) continue;
    await prisma.trackGenre.deleteMany({ where: { trackId: track.id } });
    onTrackReady(track.id);
    requeued += 1;
  }

  console.log(`[meta] проверено файлов: ${tracks.length}, обновлено из тегов: ${updated}, жанр отправлен на поиск: ${requeued}`);
}