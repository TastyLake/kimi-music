import { TrackDownloader } from './trackDownloader.js';

const cache = new Map<string, { exp: number; url: string }>();

interface PlayFormat {
  url?: string;
  mimeType?: string;
  bitrate?: number;
  audioQuality?: string;
}

async function fromPlayDl(query: string): Promise<string | null> {
  const play = (await import('play-dl')) as {
    search: (q: string, opt: { limit: number }) => Promise<{ url?: string }[]>;
    video_info: (url: string) => Promise<{ format?: PlayFormat[] }>;
  };
  const found = await play.search(query, { limit: 1 });
  const page = found[0]?.url;
  if (!page) return null;
  const info = await play.video_info(page);
  const formats = (info.format ?? []).filter((fmt) => fmt.url);
  const audio = formats
    .filter((fmt) => /audio/i.test(fmt.mimeType ?? '') || fmt.audioQuality)
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
  return audio?.url ?? formats.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0]?.url ?? null;
}

/** Прямой URL аудиопотока. Сначала play-dl, затем yt-dlp -g без скачивания файла. */
export async function resolveStreamUrl(artist: string, title: string): Promise<string> {
  const key = `${artist}\n${title}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.url;

  const query = `${artist} - ${title}`;
  let url: string | null = null;
  try {
    url = await fromPlayDl(query);
  } catch (err) {
    console.warn(`[stream] play-dl: ${err instanceof Error ? err.message : err}`);
  }
  if (!url) url = await new TrackDownloader(process.env.YTDLP_COOKIES_PATH).resolveAudioUrl(query);
  cache.set(key, { exp: Date.now() + 10 * 60 * 1000, url });
  return url;
}
