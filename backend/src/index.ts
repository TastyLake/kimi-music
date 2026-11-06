import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { prisma } from './lib/prisma.js';
import { HttpError, errorHandler } from './lib/http.js';
import { authRouter } from './routes/auth.js';
import { tracksRouter } from './routes/tracks.js';
import { favoritesRouter } from './routes/favorites.js';
import { playlistsRouter } from './routes/playlists.js';
import { uploadRouter } from './routes/upload.js';
import { adminRouter } from './routes/admin.js';
import { discoverRouter } from './routes/discover.js';
import { runCleanup } from './services/maintenance.js';
import { importRouter } from './routes/import.js';
import { downloadsRouter } from './routes/downloads.js';
import { spotifyImportRouter } from './services/import.service.js';
import { ensureAdmin, ensureDirs } from './services/bootstrap.js';
import { runScan } from './services/scanner.js';
import { startWorker } from './jobs/worker.js';
import { startImporterWorker } from './workers/importer.worker.js';
import { startDownloadQueue } from './services/downloadWorker.js';

// Защита процесса от неперехваченных ошибок
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (error) => {
  console.error('[uncaughtException]', error);
});

async function main() {
  await ensureDirs();
  await ensureAdmin();

  const app = express();
  // За фронтом/прокси: доверяем только приватным сетям, чтобы лимитер видел реальный IP клиента
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.disable('x-powered-by');

  // CORP cross-origin: <audio>/<img> с другого origin должны иметь возможность загрузить ресурсы
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: config.CORS_ORIGIN.split(',').map((s) => s.trim()), exposedHeaders: ['Content-Range', 'Accept-Ranges'] }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Обложки: имена — хэши содержимого, поэтому кешируем «навсегда»
  app.use('/api/covers', express.static(config.COVERS_DIR, { maxAge: '30d', immutable: true, index: false }));

  app.use('/api/auth', authRouter);
  app.use('/api', tracksRouter); // /tracks, /filters, /tracks/:id/stream
  app.use('/api/favorites', favoritesRouter);
  app.use('/api/playlists', playlistsRouter);
  app.use('/api', uploadRouter); // /upload
  app.use('/api/discover', discoverRouter);
  app.use('/api/import', importRouter);
  app.use('/api/downloads', downloadsRouter);
  app.use('/api/v1/import', spotifyImportRouter);
  app.use('/api/admin', adminRouter);

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'not_found', 'Маршрут не найден')));
  app.use(errorHandler);

  const host = process.env.HOST || '0.0.0.0';
  const server = app.listen(config.PORT, host, () => {
  console.log(`[api] http://${host}:${config.PORT}`);
});

server.keepAliveTimeout = 300000; // 5 минут
server.headersTimeout = 305000;   // 5 минут + 5 сек

  const worker = config.RUN_WORKER_IN_PROCESS ? await startWorker() : null;
  const importer = config.RUN_WORKER_IN_PROCESS ? startImporterWorker() : null;
  await startDownloadQueue();
  if (config.SCAN_ON_START) void runScan();

  // Автоматическая чистка БД и диска
  const cleanup = () =>
    void runCleanup()
      .then((r) => console.log('[cleanup]', r))
      .catch((e) => console.error('[cleanup]', e));

  setTimeout(cleanup, 60_000).unref();
  setInterval(cleanup, 24 * 60 * 60 * 1000).unref();

  const shutdown = async (signal: string) => {
    console.log(`[api] ${signal}: останавливаюсь`);
    server.close();
    await worker?.close().catch(() => undefined);
    await importer?.close().catch(() => undefined);
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((e) => {
  console.error('Не удалось запустить сервер:', e);
  process.exit(1);
});