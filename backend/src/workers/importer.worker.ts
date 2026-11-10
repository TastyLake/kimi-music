import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Worker, type Job } from 'bullmq';
import { connection } from '../jobs/queue.js';
import { userMusicDir } from '../lib/access.js';
import { indexImportedDirectory } from '../services/scanner.js';
import { SPOTIFY_IMPORT_QUEUE, type SpotifyImportJobData } from '../queues/importer.queue.js';

const log = {
  info: (message: string) => console.log(`[spotify-import] ${message}`),
  error: (message: string) => console.error(`[spotify-import] ${message}`),
};

export class ImportExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportExecutionError';
  }
}

function workDir(jobId: string): string {
  const safe = jobId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(os.tmpdir(), 'loral-imports', safe);
}

function outputDir(data: SpotifyImportJobData, fallback: string): string {
  if (!data.targetDir) return fallback;
  const resolved = path.resolve(data.targetDir);
  const library = userMusicDir(data.userId) + path.sep;
  if (resolved === userMusicDir(data.userId) || resolved.startsWith(library)) return resolved;
  log.error('targetDir вне медиатеки пользователя, используется временная папка');
  return fallback;
}

function noteProgress(text: string, job: Job): number | undefined {
  let value: number | undefined;
  for (const match of text.matchAll(/(\d{1,3})\s*%/g)) {
    const n = Number(match[1]);
    if (n >= 0 && n <= 100) value = n;
  }
  for (const match of text.matchAll(/(\d+)\s*\/\s*(\d+)/g)) {
    const total = Number(match[2]);
    if (total > 0) value = Math.min(100, Math.round((Number(match[1]) / total) * 100));
  }
  if (value != null) void job.updateProgress(value).catch(() => undefined);
  return value;
}

function stopProcess(child: ChildProcess): void {
  child.stdout?.destroy();
  child.stderr?.destroy();
  if (child.exitCode != null || child.killed) return;
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    child.kill();
  }
}

function runZotify(url: string, dir: string, job: Job): Promise<void> {
  const bin = process.env.ZOTIFY_PATH?.trim() || 'zotify';
  const credentials = process.env.ZOTIFY_CREDENTIALS_PATH?.trim();
  const args = [url, '--output', path.join(dir, '{artist} - {track_name}.{ext}'), '--download-format', 'mp3'];
  if (credentials) args.push('--credentials-location', credentials);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };
    const child = spawn(bin, args, {
      cwd: dir,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        ...(credentials ? { ZOTIFY_CREDENTIALS_PATH: credentials, ZOTIFY_CREDENTIALS_LOCATION: credentials } : {}),
      },
    });
    let stderr = '';
    const take = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      noteProgress(text, job);
      return text;
    };
    child.stdout?.on('data', (chunk: Buffer) => take(chunk));
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + take(chunk)).slice(-4000);
    });
    child.on('error', (err) => {
      stopProcess(child);
      finish(new ImportExecutionError(`Не удалось запустить zotify: ${err.message}`));
    });
    child.on('exit', (code) => {
      stopProcess(child);
      if (code === 0) finish();
      else {
        const message = stderr.trim() || `zotify завершился с кодом ${code ?? 'null'}`;
        log.error(message);
        finish(new ImportExecutionError(message));
      }
    });
  });
}

async function handle(job: Job<SpotifyImportJobData>): Promise<{ indexed: number }> {
  const fallback = workDir(job.id ?? 'job');
  const dir = outputDir(job.data, fallback);
  const ephemeral = dir === fallback;
  await fs.mkdir(dir, { recursive: true });
  try {
    log.info(`старт ${job.id} для пользователя ${job.data.userId}`);
    await runZotify(job.data.url, dir, job);
    const result = await indexImportedDirectory(dir, job.data.userId);
    if (result.indexed === 0) {
      throw new ImportExecutionError(result.errors[0] ?? 'zotify не сохранил аудиофайлы');
    }
    if (result.errors.length) log.error(result.errors.join('; '));
    await job.updateProgress(100);
    log.info(`готово ${job.id}: ${result.indexed}`);
    return { indexed: result.indexed };
  } finally {
    if (ephemeral) {
      await fs.rm(dir, { recursive: true, force: true }).catch((err: Error) => log.error(`не удалось удалить ${dir}: ${err.message}`));
    }
  }
}

export function startImporterWorker(): Worker<SpotifyImportJobData> {
  const worker = new Worker<SpotifyImportJobData>(SPOTIFY_IMPORT_QUEUE, handle, { connection, concurrency: 1 });
  worker.on('failed', (job, err) => log.error(`задача ${job?.id} не удалась: ${err.message}`));
  worker.on('error', (err) => log.error(err.message));
  log.info('воркер запущен');
  return worker;
}
