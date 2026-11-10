import { cached, fetchJson, sleep } from '../lib/fetch.js';
import { matchKey } from '../lib/filename.js';
import { slugify } from '../lib/slug.js';

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

export interface AlbumTrackRow {
  title: string;
  artist: string;
  album: string;
  duration: number;
  position: number;
}

interface MbReleaseHit {
  id: string;
  title: string;
  score?: number;
  'track-count'?: number;
  'artist-credit'?: { name: string }[];
}

interface MbReleaseFull {
  media?: {
    tracks?: {
      position?: number;
      title?: string;
      length?: number;
      recording?: { title?: string };
      'artist-credit'?: { name: string }[];
    }[];
  }[];
}

/** Полный треклист релиза. Берётся выпуск с тем же названием и максимальным числом дорожек. */
export function albumTracklist(artist: string, album: string): Promise<AlbumTrackRow[]> {
  const key = `${slugify(artist)}|${slugify(album)}`;
  return cached(`mb-album:${key}`, 6 * 60 * 60 * 1000, () =>
    schedule(async () => {
      const query = `release:"${esc(album)}" AND artist:"${esc(artist)}"`;
      const qs = new URLSearchParams({ query, fmt: 'json', limit: '10' });
      const found = await fetchJson<{ releases?: MbReleaseHit[] }>(`https://musicbrainz.org/ws/2/release/?${qs}`, {}, 12_000);
      const wanted = slugify(album);
      const ranked = [...(found.releases ?? [])].sort((a, b) => (b['track-count'] ?? 0) - (a['track-count'] ?? 0));
      const hit = ranked.find((r) => slugify(r.title) === wanted) ?? ranked.find((r) => slugify(r.title).includes(wanted) || wanted.includes(slugify(r.title))) ?? ranked[0];
      if (!hit) return [];
      await sleep(1100);
      const full = await fetchJson<MbReleaseFull>(
        `https://musicbrainz.org/ws/2/release/${hit.id}?inc=recordings+artist-credits&fmt=json`,
        {},
        12_000,
      );
      const rows: AlbumTrackRow[] = [];
      for (const media of full.media ?? []) {
        for (const track of media.tracks ?? []) {
          const title = track.recording?.title || track.title;
          if (!title) continue;
          rows.push({
            title,
            artist: track['artist-credit']?.[0]?.name || artist,
            album,
            duration: track.length ? Math.round(track.length / 1000) : 0,
            position: track.position ?? rows.length + 1,
          });
        }
      }
      return rows;
    }),
  );
}
