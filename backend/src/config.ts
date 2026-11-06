import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

// Пустые значения в .env (`KEY=`) считаем «не задано»
const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ''));

const bool = (def: boolean) =>
  z
    .enum(['true', 'false'])
    .default(def ? 'true' : 'false')
    .transform((v) => v === 'true');

const schema = z.object({
  PORT: z.coerce.number().int().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  MUSIC_DIR: z.string().default('./media/music'),
  DATA_DIR: z.string().default('./data'),
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET должен быть не короче 16 символов'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET должен быть не короче 16 символов'),
  ACCESS_TTL: z.string().default('15m'),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  ALLOW_REGISTRATION: bool(true),
  ADMIN_USERNAME: z.string().default('admin'),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  LASTFM_API_KEY: z.string().optional(),
  // Spotify: Client ID приложения из developer.spotify.com (секрет не нужен, используется PKCE)
  SPOTIFY_CLIENT_ID: z.string().optional(),
  // SoundCloud api-v2: публичный client_id для поиска недостающих треков при импорте
  SOUNDCLOUD_CLIENT_ID: z.string().optional(),
  MUSICBRAINZ_CONTACT: z.string().default('admin@example.com'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(300),
  RUN_WORKER_IN_PROCESS: bool(true),
  SCAN_ON_START: bool(false),
});

const parsed = schema.safeParse(raw);
if (!parsed.success) {
  console.error('Ошибка конфигурации (.env):');
  for (const issue of parsed.error.issues) console.error(` - ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  ...env,
  MUSIC_DIR: path.resolve(env.MUSIC_DIR),
  DATA_DIR: path.resolve(env.DATA_DIR),
  COVERS_DIR: path.resolve(env.DATA_DIR, 'covers'),
  TMP_DIR: path.resolve(env.DATA_DIR, 'tmp'),
  DOWNLOAD_DIR: path.resolve(env.DATA_DIR, 'media'),
  AUDIO_EXTENSIONS: ['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.opus'] as const,
};
