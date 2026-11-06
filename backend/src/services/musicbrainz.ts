import { fetchJson, sleep } from '../lib/fetch.js';
import { matchKey } from '../lib/filename.js';

// Правила MusicBrainz: не чаще 1 запроса в секунду. Выстраиваем все вызовы в одну цепочку.
let tail: Promise<void> = Promise.resolve();
function schedule<T>(fn: () => Promise<T>): Promise<T> {
  const result = tail.then(fn);
  tail = result.then(
    () => sleep(1100),
    () => sleep(1100),
  );
  return result;
}

interface MbRecording {
  id: string;
  title: string;
  score?: number;
  'first-release-date'?: string;
  'artist-credit'?: { name: string }[];
  tags?: { name: string; count: number }[];
  releases?: { id: string; title?: string }[];
}

export interface MbResult {
  year?: number;
  tags: { name: string; count: number }[];
  releaseId?: string;
  album?: string;
}

const esc = (s: string) => s.replace(/(["\\])/g, '\\$1');

export function musicbrainzLookup(artist: string, title: string): Promise<MbResult | null> {
  return schedule(async () => {
    const query = `recording:"${esc(title)}" AND artist:"${esc(artist)}"`;
    const qs = new URLSearchParams({ query, fmt: 'json', limit: '5' });
    const data = await fetchJson<{ recordings?: MbRecording[] }>(`https://musicbrainz.org/ws/2/recording/?${qs}`);
    const key = matchKey(artist, title);
    const rec = (data.recordings ?? []).find(
      (r) => (r.score ?? 0) >= 85 && matchKey(r['artist-credit']?.[0]?.name ?? '', r.title) === key,
    );
    if (!rec) return null;
    const year = Number(rec['first-release-date']?.slice(0, 4));
    return {
      year: Number.isFinite(year) && year > 1800 ? year : undefined,
      tags: rec.tags ?? [],
      releaseId: rec.releases?.[0]?.id,
      album: rec.releases?.[0]?.title,
    };
  });
}

export const coverArtArchiveUrl = (releaseId: string) => `https://coverartarchive.org/release/${releaseId}/front-500`;
