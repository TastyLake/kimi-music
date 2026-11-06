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
      return restored.includes('') ? trimmed : restored;
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

    const tagGenres = (meta?.common.genre?.map((g) => fixEncodingText(g)).filter(Boolean) as string[]) ?? [];
    if (tagGenres.length) await setTrackGenres(track.id, tagGenres);

    if (status === 'PARSED') onTrackReady(track.id);
    return { status: 'created', trackId: track.id, needsReview: status === 'NEEDS_REVIEW' };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { status: 'duplicate' }; // гонка: тот же файл добавлен параллельным потоком
    }
    return { status: 'error', error: `${path.basename(absPath)}: ${(e as Error).message}` };
  }
}