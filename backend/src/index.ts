import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';

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

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

// Логгер запросов для отладки
app.use((req, res, next) => {
  res.on('finish', () => {
    console.log(`[HTTP] ${req.method} ${req.url} -> ${res.statusCode}`);
  });
  next();
});

app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range']
}));

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Раздача статики (медиа и обложки)
const mediaPath = path.join(process.cwd(), 'media');
app.use('/media', express.static(mediaPath));
app.use('/api/media', express.static(mediaPath));

const uploadsPath = path.join(process.cwd(), 'uploads');
app.use('/uploads', express.static(uploadsPath));
app.use('/api/uploads', express.static(uploadsPath));

app.get('/', (req, res) => res.json({ message: 'Kima Music Server API' }));
app.get('/api', (req, res) => res.json({ status: 'ok' }));

// Универсальный монтировщик префиксов
const mount = (router: any, prefix: string) => {
  app.use(`/api/${prefix}`, router);
  app.use(`/${prefix}`, router);
};

mount(authRouter, 'auth');
mount(uploadRouter, 'upload'); // Теперь запрос на /upload и /api/upload идет прямо в uploadRouter
mount(adminRouter, 'admin');
mount(discoverRouter, 'discover');
mount(importRouter, 'import');
mount(spotifyRouter, 'spotify');
mount(playlistsRouter, 'playlists');
mount(downloadsRouter, 'downloads');
mount(favoritesRouter, 'favorites');

// Треки монтируются в корень, так как пути прописаны внутри файла tracks.ts
app.use('/api', tracksRouter);
app.use('/', tracksRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

app.listen(PORT, () => {
  console.log(`[api] http://0.0.0.0:${PORT}`);
});
