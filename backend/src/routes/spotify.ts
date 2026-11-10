import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { HttpError, parse } from '../lib/http.js';
import { authenticate, me } from '../middleware/auth.js';
import {
  authUrl,
  disconnect,
  exchangeCode,
  isConnected,
  listMyPlaylists,
  matchUserTracks,
  spotifyConfigured,
  spotifyRedirectUri,
  tracksFromSource,
  verifyOAuthState,
} from '../services/import.service.js';

export const spotifyRouter = Router();
spotifyRouter.use(authenticate());

spotifyRouter.get('/status', async (req, res) => {
  const user = me(req);
  res.json({
    configured: spotifyConfigured(),
    connected: await isConnected(user.id),
    redirectUri: spotifyRedirectUri(),
  });
});

spotifyRouter.get('/login', (req, res) => {
  res.json({ url: authUrl(me(req).id) });
});

spotifyRouter.post('/callback', async (req, res) => {
  const user = me(req);
  const { code, state } = parse(
    z.object({ code: z.string().min(1), state: z.string().min(1) }),
    req.body,
  );
  if (!verifyOAuthState(state, user.id)) throw new HttpError(400, 'bad_state', 'Сессия Spotify не совпала, попробуйте ещё раз');
  await exchangeCode(user.id, code);
  res.json({ connected: true });
});

spotifyRouter.delete('/disconnect', async (req, res) => {
  await disconnect(me(req).id);
  res.status(204).end();
});

spotifyRouter.get('/playlists', async (req, res) => {
  res.json({ items: await listMyPlaylists(me(req).id) });
});

const importSchema = z.object({
  playlistId: z.string().min(1).max(64).optional(),
  url: z.string().trim().min(1).max(500).optional(),
  rawText: z.string().trim().min(1).max(400_000).optional(),
  name: z.string().trim().min(1).max(100).optional(),
  isPublic: z.boolean().optional(),
});

spotifyRouter.post('/import', async (req, res) => {
  const user = me(req);
  const body = parse(importSchema, req.body);
  const source = await tracksFromSource(user.id, body);
  const { matched, missing } = await matchUserTracks(user.id, source.tracks);
  if (matched.length === 0) {
    throw new HttpError(
      422,
      'no_matches',
      'Ни один трек Spotify не найден в вашей библиотеке Loral. Сначала загрузите файлы, затем повторите импорт.',
      { missing, total: source.tracks.length },
    );
  }

  const name = body.name?.trim() || source.name || 'Spotify';
  const playlist = await prisma.playlist.create({
    data: {
      userId: user.id,
      name,
      isPublic: body.isPublic ?? false,
      tracks: {
        create: matched.map((t: { trackId: string }, position: number) => ({ trackId: t.trackId, position })),
      },
    },
  });

  res.status(201).json({
    playlistId: playlist.id,
    name: playlist.name,
    matched: matched.length,
    missing,
    total: source.tracks.length,
  });
});