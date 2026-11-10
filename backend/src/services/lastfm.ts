import { config } from '../config.js';
import { fetchJson } from '../lib/fetch.js';

const BASE = 'https://ws.audioscrobbler.com/2.0/';
const PLACEHOLDER_IMG = '2a96cbd8b46e442fc41c2b86b821562f';

export const lastfmEnabled = () => Boolean(config.LASTFM_API_KEY);

interface LfmImage {
  '#text': string;
  size: string;
}

async function call<T>(params: Record<string, string>): Promise<T> {
  if (!config.LASTFM_API_KEY) throw new Error('LASTFM_API_KEY не задан');
  const qs = new URLSearchParams({ ...params, api_key: config.LASTFM_API_KEY, format: 'json' });
  const data = await fetchJson<T & { error?: number; message?: string }>(`${BASE}?${qs}`);
  if (data.error) throw new Error(`Last.fm ${data.error}: ${data.message}`);
  return data;
}

const asArray = <T>(v: T | T[] | undefined): T[] => (Array.isArray(v) ? v : v ? [v] : []);

function bestImage(images: LfmImage[] | undefined): string | undefined {
  const real = asArray(images).filter((i) => i['#text'] && !i['#text'].includes(PLACEHOLDER_IMG));
  const pick = real.find((i) => i.size === 'extralarge') ?? real.at(-1);
  return pick?.['#text'];
}

export async function trackTopTags(artist: string, title: string): Promise<{ name: string; count: number }[]> {
  const data = await call<{ toptags?: { tag?: { name: string; count: number }[] } }>({
    method: 'track.getTopTags',
    artist,
    track: title,
    autocorrect: '1',
  });
  return asArray(data.toptags?.tag);
}

export async function trackInfo(
  artist: string,
  title: string,
): Promise<{ album?: string; coverUrl?: string; durationSec?: number }> {
  const data = await call<{
    track?: { duration?: string; album?: { title?: string; image?: LfmImage[] } };
  }>({ method: 'track.getInfo', artist, track: title, autocorrect: '1' });
  const t = data.track;
  const ms = Number(t?.duration ?? 0);
  return {
    album: t?.album?.title,
    coverUrl: bestImage(t?.album?.image),
    durationSec: ms > 0 ? Math.round(ms / 1000) : undefined,
  };
}

export interface ChartEntry {
  artist: string;
  title: string;
  url?: string;
}

interface LfmTrack {
  name: string;
  url?: string;
  artist: { name: string } | string;
}

const toEntry = (t: LfmTrack): ChartEntry => ({
  artist: typeof t.artist === 'string' ? t.artist : t.artist.name,
  title: t.name,
  url: t.url,
});

// Last.fm ждёт названия стран по ISO 3166-1; Intl иногда отдаёт другой вариант
const COUNTRY_OVERRIDES: Record<string, string> = {
  RU: 'Russian Federation',
  KR: 'Korea, Republic of',
  VN: 'Viet Nam',
  MD: 'Moldova, Republic of',
  TW: 'Taiwan',
  IR: 'Iran, Islamic Republic of',
};

export function lastfmCountryName(code: string): string {
  return COUNTRY_OVERRIDES[code] ?? new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
}

/** Топ треков страны за последнюю неделю (geo.getTopTracks). */
export async function geoTopTracks(countryCode: string, limit = 50): Promise<ChartEntry[]> {
  const data = await call<{ tracks?: { track?: LfmTrack[] } }>({
    method: 'geo.getTopTracks',
    country: lastfmCountryName(countryCode),
    limit: String(limit),
  });
  return asArray(data.tracks?.track).map(toEntry);
}

export async function tagTopTracks(tag: string, limit = 50): Promise<ChartEntry[]> {
  const data = await call<{ tracks?: { track?: LfmTrack[] } }>({
    method: 'tag.getTopTracks',
    tag,
    limit: String(limit),
  });
  return asArray(data.tracks?.track).map(toEntry);
}
