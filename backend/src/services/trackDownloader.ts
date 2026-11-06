import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface DownloadHooks {
  onSpawn?: (child: ChildProcess) => void;
  onProgress?: (percent: number) => void;
  isCancelled?: () => Promise<boolean>;
  timeoutMs?: number;
}

/**
 * Скачивает один трек через yt-dlp по строке «исполнитель - название».
 * Cookies ищутся в YTDLP_COOKIES_PATH, затем в корне бэкенда, затем в data/.
 */
export class TrackDownloader {
  private readonly bin: string;
  private readonly cookiesPath?: string;

  constructor(cookiesPath?: string) {
    this.bin = process.env.YTDLP_PATH?.trim() || 'yt-dlp';
    this.cookiesPath = cookiesPath;
  }

  async downloadAudioBySearch(query: string, outputDir: string, hooks: DownloadHooks = {}, clients = 'mweb,web'): Promise<string> {
    const searchTarget = `ytsearch1:${query}`;
    const args = [
      searchTarget,
      '-f',
      'ba/ba*/b/best',
      '-x',
      '--audio-format',
      'mp3',
      '--audio-quality',
      '0',
      '--no-playlist',
      '--embed-metadata',
      '--newline',
      '--progress',
      '--print',
      'after_move:%(title)s',
      '-o',
      path.join(outputDir, '%(artist)s - %(title)s.%(ext)s'),
      '--user-agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      '--extractor-args',
      `youtube:player_client=${clients}`,
      '--no-check-certificates',
      '--force-ipv4',
      '--js-runtimes',
      jsRuntime(),
    ];

    const cookies = await this.existingCookies();
    const browser = process.env.YTDLP_COOKIES_FROM_BROWSER?.trim();
    if (cookies) args.push('--cookies', cookies);
    else if (browser) args.push('--cookies-from-browser', browser);
    const ffmpeg = process.env.FFMPEG_PATH?.trim();
    if (ffmpeg) args.push('--ffmpeg-location', ffmpeg);
    console.log(`[yt-dlp] Запуск скачивания с аргументами куки: ${cookies ? 'файл cookies.txt' : browser ? `браузер ${browser}` : 'нет'}`);

    return spawnYtdlp(this.bin, args, hooks);
  }

  private async existingCookies(): Promise<string | null> {
    const candidates = [
      this.cookiesPath,
      process.env.YTDLP_COOKIES_PATH,
      path.join(backendRoot, 'cookies.txt'),
      path.resolve(process.cwd(), 'cookies.txt'),
      path.join(config.DATA_DIR, 'cookies.txt'),
    ];
    for (const candidate of candidates) {
      const file = candidate?.trim();
      if (!file) continue;
      try {
        await fs.access(path.resolve(file));
        return path.resolve(file);
      } catch {
        // следующий кандидат
      }
    }
    return null;
  }
}

let runtime: string | undefined;

/** Короткий текст для интерфейса. Сырой вывод yt-dlp наружу не отдаётся. */
export function formatDownloadError(rawError: string): string {
  const raw = rawError.replace(/\s+/g, ' ').trim();
  if (/sign in to confirm your age/i.test(raw)) return 'Требуется подтверждение возраста (проверьте cookies.txt)';
  if (/HTTP Error 403|\bForbidden\b|sign in to confirm/i.test(raw)) return 'Доступ заблокирован YouTube (обновите cookies.txt)';
  if (/Video unavailable|Cannot find/i.test(raw)) return 'Трек не найден на YouTube';
  if (/traceback|^ERROR:|yt-dlp/i.test(raw) || raw.length > 180) return 'Ошибка скачивания';
  return raw || 'Ошибка скачивания';
}

function jsRuntime(): string {
  if (runtime) return runtime;
  const probe = spawnSync('where', ['deno'], { windowsHide: true, stdio: 'ignore', shell: true });
  runtime = probe.status === 0 ? 'deno,node' : 'node';
  return runtime;
}

function spawnYtdlp(bin: string, args: string[], hooks: DownloadHooks): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    hooks.onSpawn?.(child);
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeoutMs = hooks.timeoutMs ?? 180_000;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      stopChild(child);
      finish(() => reject(Object.assign(new Error('yt-dlp: превышено время ожидания'), { stderr })));
    }, timeoutMs);

    const take = (chunk: string, into: 'out' | 'err') => {
      if (into === 'out') stdout += chunk;
      else stderr += chunk;
      const match = [...chunk.matchAll(/\[download\]\s+(\d+(?:\.\d+)?)%/g)].at(-1);
      if (match) hooks.onProgress?.(Math.max(0, Math.min(100, Math.round(Number(match[1])))));
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => take(chunk, 'out'));
    child.stderr.on('data', (chunk: string) => take(chunk, 'err'));
    child.on('error', (err) => finish(() => reject(err)));
    child.on('close', (code) => {
      void Promise.resolve(hooks.isCancelled?.() ?? false).then((cancelled) => {
        if (cancelled) {
          finish(() => reject(Object.assign(new Error('Отменено'), { cancelled: true })));
          return;
        }
        if (code === 0) finish(() => resolve(stdout));
        else {
          const line = stderr.trim().split(/\r?\n/).findLast((row) => row.trim()) || `yt-dlp завершился с кодом ${code}`;
          finish(() => reject(Object.assign(new Error(line.slice(0, 500)), { stderr })));
        }
      });
    });
  });
}

function stopChild(child: ChildProcess): void {
  if (child.pid && process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  child.kill();
}
