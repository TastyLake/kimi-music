import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http.js';
import { createLimiter } from '../lib/limit.js';
import { validateUploadName } from '../lib/filename.js';
import { serializeTrack, trackInclude } from '../lib/serialize.js';
import { authenticate, me, requireUploader } from '../middleware/auth.js';
import { hashFile, ingestFile, readMeta } from '../services/ingest.js';
import { userLibraryDir } from '../services/scanner.js';

export const uploadRouter = Router();

// Ограничение: не более 3 тяжелых обработок файлов одновременно
const limit = createLimiter(3);

function fixEncoding(name: string): string {
  try {
    // Если строка содержит битые символы (знаки ISO-8859-1 вместо кириллицы)
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    return name;
  }
}

function safeFileName(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  const ext = path.extname(cleaned);
  const stem = cleaned.slice(0, cleaned.length - ext.length).slice(0, 180);
  return `${stem}${ext}`;
}

const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

async function uniqueDest(dir: string, name: string): Promise<string> {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  for (let n = 1; await exists(candidate); n++) candidate = path.join(dir, `${stem} (${n})${ext}`);
  return candidate;
}

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
    await fs.copyFile(from, to);
  }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdir(config.TMP_DIR, { recursive: true }).then(
        () => cb(null, config.TMP_DIR),
        (e: Error) => cb(e, config.TMP_DIR),
      );
    },
    filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.upload`),
  }),
  fileFilter: (_req, file, cb) => {
    const check = validateUploadName(fixEncoding(file.originalname));
    if (!check.ok) return cb(new HttpError(422, 'invalid_filename', check.error));
    cb(null, true);
  },
  limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 20 },
});

type UploadResult =
  | { fileName: string; status: 'created'; track: ReturnType<typeof serializeTrack> }
  | { fileName: string; status: 'duplicate' | 'error'; error: string; trackId?: string };

async function processOne(tmpPath: string, originalName: string, ownerId: string): Promise<UploadResult> {
  const fileName = originalName;
  const hash = await hashFile(tmpPath);
  const dup = await prisma.track.findUnique({
    where: { ownerId_fileHash: { ownerId, fileHash: hash } },
    select: { id: true, artist: true, title: true },
  });
  if (dup) {
    return {
      fileName,
      status: 'duplicate',
      trackId: dup.id,
      error: `Такой файл уже есть в медиатеке: ${dup.artist} - ${dup.title}`,
    };
  }
  if (!(await readMeta(tmpPath))) {
    return { fileName, status: 'error', error: 'Файл повреждён или не является аудио' };
  }

  const dir = userLibraryDir(ownerId);
  await fs.mkdir(dir, { recursive: true });
  const dest = await uniqueDest(dir, safeFileName(fileName));
  await moveFile(tmpPath, dest);
  const r = await ingestFile(dest, { ownerId, knownHash: hash });
  if (r.status !== 'created' || !r.trackId) {
    await fs.rm(dest, { force: true });
    return { fileName, status: r.status === 'duplicate' ? 'duplicate' : 'error', error: r.error ?? 'Не удалось добавить трек' };
  }
  const track = await prisma.track.findUniqueOrThrow({ where: { id: r.trackId }, include: trackInclude });
  return { fileName, status: 'created', track: serializeTrack(track) };
}

uploadRouter.post('/upload', authenticate(), requireUploader, (req, res, next) => {
  req.on('aborted', () => {
    console.warn('[upload] Соединение разорвано клиентом');
  });

  upload.array('files', 20)(req, res, async (err) => {
    // Перехватываем сброс сокета Multer
    if (err) {
      if (err.message === 'Request aborted' || (err as { code?: string }).code === 'ECONNRESET') {
        console.warn('[upload] Клиент отменил передачу файла');
        return;
      }
      return next(err);
    }

    const user = me(req);
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const ownerId = user.id;

    if (files.length === 0) return next(new HttpError(400, 'no_files', 'Файлы не получены'));

    const results: UploadResult[] = [];
    for (const f of files) {
      const name = fixEncoding(f.originalname);
      try {
        const resItem = await limit(() => processOne(f.path, name, ownerId));
        results.push(resItem);
      } catch (e) {
        results.push({ fileName: name, status: 'error', error: (e as Error).message });
      } finally {
        await fs.rm(f.path, { force: true });
      }
    }

    if (!res.headersSent && !req.aborted) {
      res.status(results.some((r) => r.status === 'created') ? 201 : 200).json({ results });
    }
  });
});