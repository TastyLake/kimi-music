import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { USER_AGENT } from './fetch.js';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const MAX_COVER_BYTES = 8 * 1024 * 1024;

/** Сохраняет обложку в DATA_DIR/covers под именем-хэшем и возвращает публичный URL. */
export async function saveCoverBuffer(buf: Buffer, mime: string): Promise<string | null> {
  const ext = EXT_BY_MIME[mime.toLowerCase().split(';')[0]!.trim()];
  if (!ext || buf.length === 0 || buf.length > MAX_COVER_BYTES) return null;
  const name = `${crypto.createHash('sha1').update(buf).digest('hex')}.${ext}`;
  const dest = path.join(config.COVERS_DIR, name);
  try {
    await fs.access(dest);
  } catch {
    await fs.mkdir(config.COVERS_DIR, { recursive: true });
    await fs.writeFile(dest, buf);
  }
  return `/api/covers/${name}`;
}

export async function downloadCover(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15_000),
    redirect: 'follow',
  });
  if (!res.ok) return null;
  const mime = res.headers.get('content-type') ?? '';
  if (!mime.startsWith('image/')) return null;
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_COVER_BYTES) return null;
  return saveCoverBuffer(Buffer.from(await res.arrayBuffer()), mime);
}
