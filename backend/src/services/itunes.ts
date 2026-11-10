import { fetchJson } from '../lib/fetch.js';
import { matchKey } from '../lib/filename.js';

export interface ItunesSong {
  trackId?: number;
  artistId?: number;
  artistName: string;
  trackName: string;
  collectionId?: number;
  collectionName?: string;
  primaryGenreName?: string;
  releaseDate?: string;
  artworkUrl100?: string;
  trackTimeMillis?: number;
  previewUrl?: string;
  trackViewUrl?: string;
  trackNumber?: number;
  kind?: string;
  wrapperType?: string;
}

export const hiresArtwork = (url: string | undefined, size = 600): string | undefined =>
  url?.replace(/\/\d+x\d+(bb|-\d+)?\./, `/${size}x${size}bb.`);

export async function itunesSearch(artist: string, title: string, limit = 5): Promise<ItunesSong[]> {
  return itunesQuery(`${artist} ${title}`, 'song', limit);
}

export async function itunesQuery(
  term: string,
  entity: 'song' | 'album' | 'musicArtist',
  limit = 8,
  timeoutMs = 8_000,
): Promise<ItunesSong[]> {
  const qs = new URLSearchParams({ term, media: 'music', entity, limit: String(limit), country: 'RU', lang: 'ru_ru' });
  const data = await fetchJson<{ results: ItunesSong[] }>(`https://itunes.apple.com/search?${qs}`, {}, timeoutMs);
  return data.results ?? [];
}

/** Строгое сопоставление: исполнитель и название должны совпасть по нормализованному ключу. */
export function bestMatch(results: ItunesSong[], artist: string, title: string): ItunesSong | null {
  const key = matchKey(artist, title);
  return results.find((r) => r.artistName && r.trackName && matchKey(r.artistName, r.trackName) === key) ?? null;
}

/** Пакетный lookup по id (один запрос на весь чарт — iTunes ограничивает частоту запросов). */
export async function itunesLookup(ids: (number | string)[], country: string, entity?: string): Promise<ItunesSong[]> {
  if (ids.length === 0) return [];
  const qs = new URLSearchParams({ id: ids.join(','), country, limit: '200' });
  if (entity) qs.set('entity', entity);
  const data = await fetchJson<{ results: ItunesSong[] }>(`https://itunes.apple.com/lookup?${qs}`);
  return data.results ?? [];
}
