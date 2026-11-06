import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { downloadCover } from '../lib/covers.js';
import { matchKey } from '../lib/filename.js';
import { prisma } from '../lib/prisma.js';
import { hiresArtwork, itunesSearch } from './itunes.js';
import { ingestFile, readMeta } from './ingest.js';
import { formatDownloadError, TrackDownloader } from './trackDownloader.js';

const execFileAsync = promisify(execFile);
const ytdlpPath = process.env.YTDLP_PATH || 'yt-dlp';
const ffmpegPath = process.env.FFMPEG_PATH;
const CONCURRENCY = 2;
const YTDLP_TIMEOUT_MS = 180_000;
const MIN_DURATION_SEC = 30;
const DURATION_TOLERANCE_SEC = 60;
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.webm', '.opus', '.ogg', '.aac', '.flac', '.wav']);

let active = 0;
let filling = false;
let queuedKick = false;
const running = new Map<string, ChildProcess>();

class DownloadCancelled extends Error {
  constructor() {
    super('Отменено');
    this.name = 'DownloadCancelled';
  }
}

export async function startDownloadQueue(): Promise<void> {
  const expired = await purgeExpiredFailures();
  if (expired > 0) console.log(`[download] скрыты старые ошибки: ${expired}`);
  const reset = await prisma.playlistDownload.updateMany({
    where: { status: { in: ['PROCESSING', 'FAILED'] } },
    data: { status: 'PENDING', error: null, progress: null },
  });
  if (reset.count > 0) console.log(`[download] возвращено в очередь: ${reset.count}`);
  kickDownloadQueue();
}

const FAILURE_TTL_MS = 60 * 60 * 1000;

export async function purgeExpiredFailures(userId?: string): Promise<number> {
  const cutoff = new Date(Date.now() - FAILURE_TTL_MS);
  const result = await prisma.playlistDownload.deleteMany({
    where: { status: 'FAILED', updatedAt: { lt: cutoff }, ...(userId ? { userId } : {}) },
  });
  return result.count;
}

export async function retryFailedDownloads(playlistId?: string): Promise<number> {
  const reset = await prisma.playlistDownload.updateMany({
    where: { status: 'FAILED', ...(playlistId ? { playlistId } : {}) },
    data: { status: 'PENDING', error: null, progress: null },
  });
  if (reset.count > 0) kickDownloadQueue();
  return reset.count;
}

export async function cancelDownload(id: string): Promise<boolean> {
  const row = await prisma.playlistDownload.findUnique({ where: { id }, select: { status: true } });
  if (!row || (row.status !== 'PENDING' && row.status !== 'PROCESSING')) return false;
  const child = running.get(id);
  if (child) stopChild(child);
  await prisma.playlistDownload.update({
    where: { id },
    data: { status: 'CANCELLED', error: 'Отменено', progress: null },
  });
  return true;
}

export function kickDownloadQueue(): void {
  if (filling) {
    queuedKick = true;
    return;
  }
  filling = true;
  fill()
    .catch((e) => console.error('[download] ошибка очереди:', e instanceof Error ? e.message : e))
    .finally(() => {
      filling = false;
      if (queuedKick) {
        queuedKick = false;
        kickDownloadQueue();
      }
    });
}

async function fill(): Promise<void> {
  while (active < CONCURRENCY) {
    const task = await claimNext();
    if (!task) return;
    active += 1;
    void finish(task);
  }
}

async function finish(task: Claimed): Promise<void> {
  try {
    await processTask(task);
  } finally {
    active -= 1;
    kickDownloadQueue();
  }
}

interface Claimed {
  id: string;
  playlistId?: string | null;
  userId: string;
  artist: string;
  title: string;
  position: number;
}

interface ResolvedTrack {
  artist: string;
  title: string;
  album?: string;
  year?: number;
  durationMs?: number;
  artworkUrl?: string;
}

async function claimNext(): Promise<Claimed | null> {
  const next = await prisma.playlistDownload.findFirst({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, playlistId: true, userId: true, artist: true, title: true, position: true },
  });
  if (!next) return null;
  const taken = await prisma.playlistDownload.updateMany({
    where: { id: next.id, status: 'PENDING' },
    data: { status: 'PROCESSING', error: null, progress: 0 },
  });
  if (taken.count === 0) return claimNext();
  return next;
}

async function processTask(task: Claimed): Promise<void> {
  const tmp = path.join(config.DOWNLOAD_DIR, '_tmp', task.id);
  let orphanPath: string | undefined;
  try {
    if (await isCancelled(task.id)) throw new DownloadCancelled();
    await fs.rm(tmp, { recursive: true, force: true });
    await fs.mkdir(tmp, { recursive: true });

    const track = await resolveTrack(task.artist, task.title);
    const staged = path.join(tmp, `${fileBase(track.artist, track.title)}.mp3`);
    const youtubeTitle = await downloadFromYoutubeMusic(task.id, track.artist, track.title, tmp, staged);
    await assertPlayable(staged, track.durationMs, youtubeTitle);

    const finalPath = await uniqueDest(path.basename(staged));
    await fs.rename(staged, finalPath);
    orphanPath = finalPath;

    const ingested = await ingestFile(finalPath, { ownerId: task.userId });
    if (!ingested.trackId) throw new Error(ingested.error ?? 'Не удалось добавить файл в медиатеку');
    orphanPath = undefined;

    await applyItunesTags(ingested.trackId, track);

    // Если загрузка привязана к плейлисту — добавляем трек в него
    if (task.playlistId) {
      await prisma.playlistTrack.createMany({
        data: [{ playlistId: task.playlistId, trackId: ingested.trackId, position: task.position }],
        skipDuplicates: true,
      });
      await prisma.playlist.update({ where: { id: task.playlistId }, data: { updatedAt: new Date() } });
    }

    await prisma.playlistDownload.update({
      where: { id: task.id },
      data: { status: 'COMPLETED', trackId: ingested.trackId, error: null, progress: 100 },
    });
    console.log(`[download] успешно скачано и добавлено: ${track.artist} — ${track.title}`);
  } catch (err) {
    if (err instanceof DownloadCancelled || (await isCancelled(task.id))) {
      console.log(`[download] отменено: ${task.artist} — ${task.title}`);
      await prisma.playlistDownload
        .updateMany({ where: { id: task.id, status: { not: 'CANCELLED' } }, data: { status: 'CANCELLED', error: 'Отменено', progress: null } })
        .catch(() => undefined);
      if (orphanPath) await fs.rm(orphanPath, { force: true }).catch(() => undefined);
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
      return;
    }
    const raw = rawError(err);
    console.error(`[download] ошибка ${task.artist} — ${task.title}: ${raw.slice(0, 500)}`);
    const message = formatDownloadError(raw);
    if (orphanPath) await fs.rm(orphanPath, { force: true }).catch(() => undefined);
    await prisma.playlistDownload
      .updateMany({ where: { id: task.id, status: 'PROCESSING' }, data: { status: 'FAILED', error: message, progress: null } })
      .catch(() => undefined);
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function resolveTrack(artist: string, title: string): Promise<ResolvedTrack> {
  try {
    const [hit] = await itunesSearch(artist, title, 1);
    if (hit?.artistName && hit.trackName) {
      const year = Number(hit.releaseDate?.slice(0, 4));
      return {
        artist: hit.artistName,
        title: hit.trackName,
        album: hit.collectionName?.trim() || undefined,
        year: year >= 1900 && year <= 2100 ? year : undefined,
        durationMs: hit.trackTimeMillis,
        artworkUrl: hiresArtwork(hit.artworkUrl100, 600),
      };
    }
  } catch (err) {
    console.warn(`[download] iTunes: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { artist, title };
}

const YTDLP_MAX_RETRIES = 2;

async function downloadFromYoutubeMusic(taskId: string, artist: string, title: string, tmp: string, dest: string): Promise<string> {
  const queryStr = `${artist} - ${title}`;
  try {
    return await withBlockRetries(taskId, tmp, () => runYtdlp(taskId, queryStr, 'web,mweb', tmp, dest));
  } catch (err) {
    if (err instanceof DownloadCancelled) throw err;
    console.warn(`[yt-dlp] «${queryStr}» повтор только по названию трека`);
    await fs.rm(tmp, { recursive: true, force: true });
    await fs.mkdir(tmp, { recursive: true });
    return await runYtdlp(taskId, title, 'mweb', tmp, dest);
  }
}

async function withBlockRetries(taskId: string, tmp: string, run: () => Promise<string>): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= YTDLP_MAX_RETRIES; attempt++) {
    if (await isCancelled(taskId)) throw new DownloadCancelled();
    if (attempt > 0) {
      const waitMs = Math.floor(Math.random() * 2000 + 3000);
      console.log(`[yt-dlp] Повтор ${attempt}/${YTDLP_MAX_RETRIES} через ${Math.round(waitMs / 1000)} с`);
      await new Promise((r) => setTimeout(r, waitMs));
      if (await isCancelled(taskId)) throw new DownloadCancelled();
      await fs.rm(tmp, { recursive: true, force: true });
      await fs.mkdir(tmp, { recursive: true });
    }
    try {
      return await run();
    } catch (err) {
      lastError = err;
      if (err instanceof DownloadCancelled || !isYoutubeBlock(err) || attempt === YTDLP_MAX_RETRIES) throw err;
    }
  }
  throw lastError;
}

async function runYtdlp(taskId: string, query: string, clients: string, tmp: string, dest: string): Promise<string> {
  let lastProgressAt = 0;
  let stdout = '';
  try {
    stdout = await new TrackDownloader(process.env.YTDLP_COOKIES_PATH).downloadAudioBySearch(query, tmp, {
      timeoutMs: YTDLP_TIMEOUT_MS,
      onSpawn: (child) => running.set(taskId, child),
      isCancelled: () => isCancelled(taskId),
      onProgress: (pct) => {
        const now = Date.now();
        if (pct < 100 && now - lastProgressAt < 1500) return;
        lastProgressAt = now;
        void prisma.playlistDownload
          .updateMany({ where: { id: taskId, status: 'PROCESSING' }, data: { progress: pct } })
          .catch(() => undefined);
      },
    }, clients);
  } catch (err) {
    if (err && typeof err === 'object' && 'cancelled' in err) throw new DownloadCancelled();
    throw err;
  } finally {
    running.delete(taskId);
  }
  await ensureMp3(tmp, dest);
  return (
    stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('[') && !line.includes('%'))
      .at(-1) ?? ''
  );
}

function stopChild(child: ChildProcess): void {
  if (child.pid && process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  child.kill();
}

async function isCancelled(id: string): Promise<boolean> {
  const row = await prisma.playlistDownload.findUnique({ where: { id }, select: { status: true } });
  return row?.status === 'CANCELLED';
}

function isYoutubeBlock(err: unknown): boolean {
  const raw = rawError(err);
  return /403|forbidden|sign in to confirm/i.test(raw);
}

async function ensureMp3(tmp: string, dest: string): Promise<void> {
  if (existsSync(dest)) return;
  const files = await fs.readdir(tmp);
  const audio = files.filter((name) => AUDIO_EXT.has(path.extname(name).toLowerCase()) && existsSync(path.join(tmp, name)));
  const mp3 = audio.find((name) => name.toLowerCase().endsWith('.mp3'));
  if (mp3) {
    if (path.join(tmp, mp3) !== dest) await fs.rename(path.join(tmp, mp3), dest);
    return;
  }
  const source = audio[0];
  if (!source) throw new Error('yt-dlp не сохранил файл');
  await execFileAsync(
    ffmpegBin(),
    ['-y', '-i', path.join(tmp, source), '-vn', '-codec:a', 'libmp3lame', '-q:a', '0', dest],
    { timeout: YTDLP_TIMEOUT_MS, windowsHide: true },
  );
  if (!existsSync(dest)) throw new Error('yt-dlp не сохранил mp3');
}

function ffmpegBin(): string {
  if (!ffmpegPath) return 'ffmpeg';
  const base = path.basename(ffmpegPath).toLowerCase();
  if (base === 'ffmpeg' || base === 'ffmpeg.exe') return ffmpegPath;
  return path.join(ffmpegPath, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
}

async function assertPlayable(filePath: string, expectedMs: number | undefined, youtubeTitle: string): Promise<void> {
  const stat = await fs.stat(filePath);
  if (stat.size < 1024) throw new Error('Скачанный файл слишком маленький');
  const meta = await readMeta(filePath);
  const seconds = meta?.format.duration ?? 0;
  if (seconds < MIN_DURATION_SEC) throw new Error('Файл короче допустимого минимума');
  if (!expectedMs || expectedMs <= 0) return;
  const itunesSec = expectedMs / 1000;
  const diff = Math.abs(seconds - itunesSec);
  if (diff < DURATION_TOLERANCE_SEC || diff < itunesSec * 0.3) return;
  if (trustedYoutubeTitle(youtubeTitle)) return;
}

function trustedYoutubeTitle(title: string): boolean {
  return /official audio|\btopic\b|\baudio\b/i.test(title);
}

async function applyItunesTags(trackId: string, track: ResolvedTrack): Promise<void> {
  const coverImageUrl = track.artworkUrl ? await downloadCover(track.artworkUrl).catch(() => null) : null;
  await prisma.track.update({
    where: { id: trackId },
    data: {
      artist: track.artist,
      title: track.title,
      matchKey: matchKey(track.artist, track.title),
      ...(track.album ? { album: track.album } : {}),
      ...(track.year ? { year: track.year } : {}),
      ...(coverImageUrl ? { coverImageUrl } : {}),
    },
  });
}

function fileBase(artist: string, title: string): string {
  const raw = `${artist} - ${title}`.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  const cleaned = raw.replace(/[. ]+$/g, '').slice(0, 120);
  return cleaned || 'track';
}

async function uniqueDest(fileName: string): Promise<string> {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  for (let i = 0; i < 50; i++) {
    const name = i === 0 ? fileName : `${base} (${i + 1})${ext}`;
    const full = path.join(config.DOWNLOAD_DIR, name);
    try {
      await fs.access(full);
    } catch {
      return full;
    }
  }
  return path.join(config.DOWNLOAD_DIR, `${base}-${Date.now()}${ext}`);
}

function rawError(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'ENOENT') {
    return `yt-dlp не найден: ${ytdlpPath}`;
  }
  if (err && typeof err === 'object' && 'stderr' in err) {
    const stderr = String((err as { stderr?: string }).stderr ?? '').trim();
    const line = stderr.split(/\r?\n/).findLast((row) => row.trim());
    if (line) return line.slice(0, 500);
  }
  if (err instanceof Error && err.message) return err.message;
  return 'неизвестная ошибка';
}