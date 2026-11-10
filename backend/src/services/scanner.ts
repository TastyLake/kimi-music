import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { isAudioFile } from '../lib/filename.js';
import { ingestFile } from './ingest.js';

/** Папка личной медиатеки пользователя. Сюда попадают его веб-загрузки. */
export const userLibraryDir = (userId: string) => path.join(config.MUSIC_DIR, 'users', userId);

/**
 * Владелец файла: если он лежит в MUSIC_DIR/users/<id>/…, это медиатека пользователя <id>;
 * все остальные файлы (общая папка на сервере) достаются тому, кто запустил сканирование.
 */
export function ownerForPath(file: string, defaultOwnerId: string, knownUsers: Set<string>): string {
  const rel = path.relative(config.MUSIC_DIR, file).split(path.sep);
  if (rel[0] === 'users' && rel.length > 2 && rel[1] && knownUsers.has(rel[1])) return rel[1];
  return defaultOwnerId;
}

export interface ScanState {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  total: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  duplicates: number;
  needsReview: number;
  errors: number;
  missing: number;
  pruned: number;
  errorSamples: string[];
}

const fresh = (): ScanState => ({
  running: false,
  startedAt: null,
  finishedAt: null,
  total: 0,
  processed: 0,
  created: 0,
  updated: 0,
  skipped: 0,
  duplicates: 0,
  needsReview: 0,
  errors: 0,
  missing: 0,
  pruned: 0,
  errorSamples: [],
});

export const scanState: ScanState = fresh();

async function collect(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    scanState.errors++;
    if (scanState.errorSamples.length < 10) scanState.errorSamples.push(`${dir}: ${(e as Error).message}`);
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collect(full, out);
    else if (entry.isFile() && isAudioFile(entry.name)) out.push(full);
  }
}

export function isScanRunning(): boolean {
  return scanState.running;
}

/** Рекурсивно сканирует MUSIC_DIR и синхронизирует БД. Вызывающий не обязан дожидаться завершения. */
export async function runScan(opts: { pruneMissing?: boolean; ownerId?: string } = {}): Promise<void> {
  if (scanState.running) return;
  Object.assign(scanState, fresh(), { running: true, startedAt: new Date().toISOString() });

  try {
    await fs.mkdir(config.MUSIC_DIR, { recursive: true });
    const users = await prisma.user.findMany({ select: { id: true, role: true }, orderBy: { createdAt: 'asc' } });
    const defaultOwner = opts.ownerId ?? users.find((u) => u.role === 'ADMIN')?.id;
    if (!defaultOwner) throw new Error('Нет администратора, которому достанутся найденные файлы');
    const knownUsers = new Set(users.map((u) => u.id));
    const files: string[] = [];
    await collect(config.MUSIC_DIR, files);
    scanState.total = files.length;

    let cursor = 0;
    const worker = async () => {
      while (cursor < files.length) {
        const file = files[cursor++]!;
        const r = await ingestFile(file, { ownerId: ownerForPath(file, defaultOwner, knownUsers) });
        scanState.processed++;
        switch (r.status) {
          case 'created':
            scanState.created++;
            if (r.needsReview) scanState.needsReview++;
            break;
          case 'updated':
            scanState.updated++;
            break;
          case 'skipped':
            scanState.skipped++;
            break;
          case 'duplicate':
            scanState.duplicates++;
            break;
          case 'error':
            scanState.errors++;
            if (scanState.errorSamples.length < 10 && r.error) scanState.errorSamples.push(r.error);
            break;
        }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));

    // Файлы, которые есть в БД, но пропали с диска
    const seen = new Set(files);
    const prefix = config.MUSIC_DIR + path.sep;
    const inDb = await prisma.track.findMany({
      where: { filePath: { startsWith: prefix } },
      select: { id: true, filePath: true },
    });
    const missing = inDb.filter((t) => !seen.has(t.filePath));
    scanState.missing = missing.length;
    if (opts.pruneMissing && missing.length) {
      const res = await prisma.track.deleteMany({ where: { id: { in: missing.map((t) => t.id) } } });
      scanState.pruned = res.count;
    }
  } catch (e) {
    scanState.errors++;
    scanState.errorSamples.push((e as Error).message);
  } finally {
    scanState.running = false;
    scanState.finishedAt = new Date().toISOString();
  }
}

/**
 * Индексирует одну папку в медиатеку конкретного пользователя.
 * Файлы вне его каталога переносятся в MUSIC_DIR/users/<id>/imports, затем разбираются теги.
 */
async function walkAudio(dir: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkAudio(full, out);
    else if (entry.isFile() && isAudioFile(entry.name)) out.push(full);
  }
}

export async function indexImportedDirectory(dir: string, ownerId: string): Promise<{ indexed: number; errors: string[] }> {
  const files: string[] = [];
  await walkAudio(dir, files);
  const library = userLibraryDir(ownerId);
  const destRoot = path.join(library, 'imports');
  await fs.mkdir(destRoot, { recursive: true });
  let indexed = 0;
  const errors: string[] = [];
  for (const file of files) {
    try {
      const stored = await placeInLibrary(file, destRoot);
      const result = await ingestFile(stored, { ownerId });
      if (result.status === 'error') errors.push(result.error ?? file);
      else indexed++;
    } catch (e) {
      errors.push(`${file}: ${(e as Error).message}`);
    }
  }
  return { indexed, errors };
}

async function placeInLibrary(file: string, destRoot: string): Promise<string> {
  const root = destRoot + path.sep;
  if (file.startsWith(root)) return file;
  const base = path.basename(file);
  let dest = path.join(destRoot, base);
  if (await fs.access(dest).then(() => true, () => false)) {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    dest = path.join(destRoot, `${stamp}-${base}`);
  }
  try {
    await fs.rename(file, dest);
  } catch {
    await fs.copyFile(file, dest);
    await fs.rm(file, { force: true });
  }
  return dest;
}
