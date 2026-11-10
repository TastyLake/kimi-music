import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { config } from './config.js';
import { errorHandler } from './lib/http.js';
import { ensureAdmin, ensureDirs } from './services/bootstrap.js';
import { repairStoredMetadata } from './services/ingest.js';
import { startDownloadQueue } from './services/downloadWorker.js';
import { runScan } from './services/scanner.js';
import { startWorker } from './jobs/worker.js';
import { resumeTrackDownloads, startTrackDownloadWorker } from './jobs/trackDownloadWorker.js';
import { startImporterWorker } from './workers/importer.worker.js';

import { authRouter } from './routes/auth.js';
import { tracksRouter } from './routes/tracks.js';
import { playlistsRouter } from './routes/playlists.js';
import { uploadRouter } from './routes/upload.js';
import { adminRouter } from './routes/admin.js';
import { discoverRouter } from './routes/discover.js';
import { importRouter } from './routes/import.js';
import { spotifyRouter } from './routes/spotify.js';
import { downloadsRouter } from './routes/downloads.js';
import { favoritesRouter } from './routes/favorites.js';
import { searchRouter } from './routes/search.js';
import { albumsRouter, artistsRouter } from './routes/catalog.js';
import { externalRouter } from './routes/external.js';
import { homeRouter, mixRouter, playsRouter } from './routes/home.js';

const app = express();

app.use((req, res, next) => {
  res.on('finish', () => {
    console.log(`[HTTP] ${req.method} ${req.url} -> ${res.statusCode}`);
  });
  next();
});

const origins = config.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin: origins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range'],
}));

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

const mediaPath = path.join(process.cwd(), 'media');
app.use('/media', express.static(mediaPath));
app.use('/api/media', express.static(mediaPath));
app.use('/covers', express.static(config.COVERS_DIR));
app.use('/api/covers', express.static(config.COVERS_DIR));

const uploadsPath = path.join(process.cwd(), 'uploads');
app.use('/uploads', express.static(uploadsPath));
app.use('/api/uploads', express.static(uploadsPath));

app.get('/', (_req, res) => res.json({ message: 'Kima Music Server API' }));
app.get('/api', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

const mount = (router: express.Router, prefix: string) => {
  app.use(`/api/${prefix}`, router);
  app.use(`/${prefix}`, router);
};

mount(authRouter, 'auth');
mount(uploadRouter, 'upload');
mount(adminRouter, 'admin');
mount(discoverRouter, 'discover');
mount(importRouter, 'import');
mount(spotifyRouter, 'spotify');
mount(playlistsRouter, 'playlists');
mount(downloadsRouter, 'downloads');
mount(favoritesRouter, 'favorites');
mount(searchRouter, 'search');
mount(artistsRouter, 'artists');
mount(albumsRouter, 'albums');
mount(externalRouter, 'external');
mount(homeRouter, 'home');
mount(mixRouter, 'mixes');
mount(playsRouter, 'plays');

app.use('/api', tracksRouter);
app.use('/', tracksRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'not_found', message: 'Not Found' });
});

app.use(errorHandler);

async function main() {
  await ensureDirs();
  await ensureAdmin();
  repairStoredMetadata().catch((e) => console.error('[meta] не удалось дочитать теги:', e));
  if (config.SCAN_ON_START) {
    runScan().catch((e) => console.error('[scan] не удалось просканировать медиатеку:', e));
  }
  startDownloadQueue().catch((e) => console.error('[download] очередь не запущена:', e));
  if (config.RUN_WORKER_IN_PROCESS) {
    startImporterWorker();
    startWorker().catch((e) => console.error('[worker] воркер не запущен:', e));
    startTrackDownloadWorker();
    resumeTrackDownloads().catch((e) => console.error('[download] не удалось восстановить очередь:', e));
  }
  app.listen(config.PORT, '0.0.0.0', () => {
    console.log(`[api] http://0.0.0.0:${config.PORT}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
