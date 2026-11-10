import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { userMusicDir } from '../lib/access.js';
import { isAudioFile } from '../lib/filename.js';
import { HttpError } from '../lib/http.js';
import { authenticate, me } from '../middleware/auth.js';
import { ingestFile } from '../services/ingest.js';

export const uploadRouter = Router();

/** Multer читает имя из multipart как latin1, хотя браузер прислал UTF-8. */
function decodeOriginalName(name: string): string {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? name : decoded;
}

async function uniqueDest(dir: string, fileName: string): Promise<string> {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let dest = path.join(dir, fileName);
  let n = 2;
  while (true) {
    try {
      await fs.access(dest);
      dest = path.join(dir, `${base} (${n})${ext}`);
      n += 1;
    } catch {
      return dest;
    }
  }
}

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
    await fs.copyFile(from, to);
    await fs.unlink(from);
  }
}

const upload = multer({
  dest: path.resolve(config.TMP_DIR),
  limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024 },
}).any();

uploadRouter.post('/', authenticate(), (req, res, next) => {
  upload(req, res, async (err: unknown) => {
    try {
      if (err) {
        const tooBig = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
        throw new HttpError(tooBig ? 413 : 400, tooBig ? 'file_too_large' : 'upload_error', tooBig ? 'Файл слишком большой' : (err as Error).message);
      }

      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) throw new HttpError(400, 'no_files', 'Файлы не были переданы');

      const userId = me(req).id;
      const dir = userMusicDir(userId);
      await fs.mkdir(dir, { recursive: true });

      const results = [];
      for (const file of files) {
        const decodedName = path.basename(decodeOriginalName(file.originalname));
        if (!isAudioFile(decodedName)) {
          await fs.unlink(file.path).catch(() => undefined);
          results.push({ fileName: decodedName, status: 'error', error: 'Неподдерживаемый формат' });
          continue;
        }

        const dest = await uniqueDest(dir, decodedName);
        await moveFile(file.path, dest);
        const ingested = await ingestFile(dest, { ownerId: userId });
        if (ingested.status === 'duplicate' || ingested.status === 'error') {
          await fs.unlink(dest).catch(() => undefined);
        }
        results.push({
          fileName: decodedName,
          status: ingested.status === 'updated' || ingested.status === 'skipped' ? 'created' : ingested.status,
          trackId: ingested.trackId,
          id: ingested.trackId,
          error: ingested.error,
        });
      }

      res.json({ results, success: true });
    } catch (error) {
      next(error);
    }
  });
});
