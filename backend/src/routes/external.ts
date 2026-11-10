import { Readable } from 'node:stream';
import { Router } from 'express';
import { z } from 'zod';
import { HttpError, parse } from '../lib/http.js';
import { authenticate } from '../middleware/auth.js';
import { resolveStreamUrl } from '../services/streamUrl.js';

export const externalRouter = Router();

const streamQuery = z.object({
  artist: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
});

let active = 0;

externalRouter.get('/resolve', authenticate({ forStreaming: true }), async (req, res) => {
  const { artist, title } = parse(streamQuery, req.query);
  try {
    const url = await resolveStreamUrl(artist, title);
    res.json({ url });
  } catch (err) {
    console.warn(`[stream] ${err instanceof Error ? err.message : err}`);
    throw new HttpError(502, 'stream_failed', err instanceof Error ? err.message : 'Поток не найден');
  }
});

/** Запасной прокси, если прямой URL не играет в браузере. Отдаёт байты по мере прихода, без сохранения файла. */
externalRouter.get('/stream', authenticate({ forStreaming: true }), async (req, res) => {
  const { artist, title } = parse(streamQuery, req.query);
  if (active >= 3) throw new HttpError(429, 'busy', 'Уже играет слишком много внешних треков');
  active += 1;
  const release = () => {
    active = Math.max(0, active - 1);
  };
  try {
    const url = await resolveStreamUrl(artist, title);
    const upstream = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!upstream.ok || !upstream.body) throw new Error(`Источник ответил ${upstream.status}`);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mp4');
    res.setHeader('Cache-Control', 'no-store');
    const stream = Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream);
    res.on('close', () => {
      stream.destroy();
      release();
    });
    stream.pipe(res);
  } catch (err) {
    release();
    if (!res.headersSent) throw new HttpError(502, 'stream_failed', err instanceof Error ? err.message : 'Не удалось открыть поток');
    res.end();
  }
});
