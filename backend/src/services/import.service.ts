import { Router } from 'express';
import { z } from 'zod';
import { HttpError, parse } from '../lib/http.js';
import { authenticate, me, requireUploader } from '../middleware/auth.js';
import { spotifyImportQueue, type SpotifyImportJobData } from '../queues/importer.queue.js';

function isSpotifyUrl(value: string): boolean {
  if (/^spotify:(playlist|album|track):[A-Za-z0-9]+$/.test(value)) return true;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com') return false;
    const parts = url.pathname.split('/').filter(Boolean);
    const localized = parts[0] === 'intl' || parts[0]?.startsWith('intl-');
    const kind = localized ? parts[1] : parts[0];
    const id = localized ? parts[2] : parts[1];
    return (kind === 'playlist' || kind === 'album' || kind === 'track') && /^[A-Za-z0-9]+$/.test(id ?? '');
  } catch {
    return false;
  }
}

const spotifyUrl = z.string().trim().max(500).refine(isSpotifyUrl, 'Нужна ссылка Spotify на плейлист, альбом или трек');

export async function enqueueSpotifyImport(data: SpotifyImportJobData): Promise<{ jobId: string; status: 'queued' }> {
  const job = await spotifyImportQueue.add('import-spotify', data);
  if (!job.id) throw new HttpError(503, 'queue_unavailable', 'Не удалось поставить импорт в очередь');
  return { jobId: job.id, status: 'queued' };
}

export const spotifyImportRouter = Router();

spotifyImportRouter.post('/spotify', authenticate(), requireUploader, async (req, res) => {
  const body = parse(z.object({ playlistUrl: spotifyUrl }), req.body);
  const result = await enqueueSpotifyImport({ url: body.playlistUrl, userId: me(req).id });
  res.status(202).json(result);
});

/* ---------------- Вспомогательные функции для Spotify API ---------------- */

export function spotifyConfigured(): boolean {
  return false;
}

export function spotifyRedirectUri(): string {
  return '';
}

export async function isConnected(_userId: string): Promise<boolean> {
  return false;
}

export function authUrl(_userId: string): string {
  return '';
}

export function verifyOAuthState(_state: string, _userId: string): boolean {
  return false;
}

export async function exchangeCode(_userId: string, _code: string): Promise<void> {}

export async function disconnect(_userId: string): Promise<void> {}

export async function listMyPlaylists(_userId: string): Promise<unknown[]> {
  return [];
}

export async function tracksFromSource(
  _userId: string,
  _body: unknown,
): Promise<{ name?: string; tracks: { artist: string; title: string }[] }> {
  return { tracks: [] };
}

export async function matchUserTracks(
  _userId: string,
  _tracks: { artist: string; title: string }[],
): Promise<{ matched: { trackId: string }[]; missing: number }> {
  return { matched: [], missing: 0 };
}