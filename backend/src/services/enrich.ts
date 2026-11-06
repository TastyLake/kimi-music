import { prisma } from '../lib/prisma.js';
import { downloadCover } from '../lib/covers.js';
import { cleanTags, normalizeGenre, setTrackGenres } from '../lib/genres.js';
import { bestMatch, hiresArtwork, itunesSearch } from './itunes.js';
import { lastfmEnabled, trackInfo, trackTopTags } from './lastfm.js';
import { coverArtArchiveUrl, musicbrainzLookup } from './musicbrainz.js';

const warn = (src: string, e: unknown) => console.warn(`[enrich] ${src}: ${(e as Error).message}`);

interface Found {
  genres: string[];
  year?: number;
  album?: string;
  coverUrl?: string;
  duration?: number;
}

/**
 * Дополняет трек недостающими данными (жанры, год, альбом, обложка, длительность).
 * Источники по очереди: iTunes (без ключа) → Last.fm (теги-поджанры) → MusicBrainz (год, теги, обложка).
 * Уже заполненные поля не перезаписываются — ручные правки админа в безопасности.
 */
export async function enrichTrack(trackId: string): Promise<{ filled: string[] }> {
  const t = await prisma.track.findUnique({ where: { id: trackId }, include: { genres: true } });
  if (!t || t.status !== 'PARSED') return { filled: [] };

  const need = {
    genre: t.genres.length === 0,
    cover: !t.coverImageUrl,
    year: t.year == null,
    album: !t.album,
    duration: t.duration === 0,
  };
  const found: Found = { genres: [] };
  const missing = () =>
    (need.genre && found.genres.length === 0) ||
    (need.cover && !found.coverUrl) ||
    (need.year && !found.year) ||
    (need.album && !found.album);

  if (Object.values(need).some(Boolean)) {
    // 1. iTunes Search API
    try {
      const m = bestMatch(await itunesSearch(t.artist, t.title), t.artist, t.title);
      if (m) {
        const g = m.primaryGenreName ? normalizeGenre(m.primaryGenreName) : null;
        if (g) found.genres.push(g);
        const y = Number(m.releaseDate?.slice(0, 4));
        if (y > 1800) found.year = y;
        found.album = m.collectionName;
        found.coverUrl = hiresArtwork(m.artworkUrl100, 600);
        if (m.trackTimeMillis) found.duration = Math.round(m.trackTimeMillis / 1000);
      }
    } catch (e) {
      warn('iTunes', e);
    }

    // 2. Last.fm — пользовательские теги дают поджанры
    if (lastfmEnabled()) {
      try {
        const tags = cleanTags(await trackTopTags(t.artist, t.title), t.artist, 3);
        for (const g of tags) if (!found.genres.includes(g)) found.genres.push(g);
        if (need.cover && !found.coverUrl) {
          const info = await trackInfo(t.artist, t.title);
          found.coverUrl ??= info.coverUrl;
          found.album ??= info.album;
          found.duration ??= info.durationSec;
        }
      } catch (e) {
        warn('Last.fm', e);
      }
    }

    // 3. MusicBrainz — если чего-то всё ещё нет
    if (missing()) {
      try {
        const mb = await musicbrainzLookup(t.artist, t.title);
        if (mb) {
          found.year ??= mb.year;
          found.album ??= mb.album;
          if (found.genres.length === 0) found.genres.push(...cleanTags(mb.tags, t.artist, 3));
          if (need.cover && !found.coverUrl && mb.releaseId) found.coverUrl = coverArtArchiveUrl(mb.releaseId);
        }
      } catch (e) {
        warn('MusicBrainz', e);
      }
    }
  }

  const filled: string[] = [];
  const data: { year?: number; album?: string; coverImageUrl?: string; duration?: number } = {};

  if (need.year && found.year) {
    data.year = found.year;
    filled.push('year');
  }
  if (need.album && found.album) {
    data.album = found.album;
    filled.push('album');
  }
  if (need.duration && found.duration) {
    data.duration = found.duration;
    filled.push('duration');
  }
  if (need.cover && found.coverUrl) {
    try {
      const local = await downloadCover(found.coverUrl);
      if (local) {
        data.coverImageUrl = local;
        filled.push('cover');
      }
    } catch (e) {
      warn('cover', e);
    }
  }
  if (need.genre && found.genres.length) {
    await setTrackGenres(t.id, found.genres.slice(0, 4));
    filled.push('genres');
  }

  // enrichedAt ставим всегда: ночной проход не будет долбить API по трекам, которых там нет
  await prisma.track.update({ where: { id: t.id }, data: { ...data, enrichedAt: new Date() } });
  return { filled };
}
