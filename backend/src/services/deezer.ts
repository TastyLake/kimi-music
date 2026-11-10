import { fetchJson, mapLimit } from '../lib/fetch.js';
import { slugify } from '../lib/slug.js';

export interface DeezerTrack {
  artist: string;
  title: string;
  album?: string;
  coverUrl?: string;
  duration?: number;
  previewUrl?: string;
  externalUrl?: string;
  source: 'deezer';
}

const API = 'https://api.deezer.com';

interface DzArtist {
  name?: string;
}
interface DzAlbum {
  title?: string;
  cover_medium?: string;
  cover_big?: string;
}
interface DzTrack {
  title?: string;
  title_short?: string;
  duration?: number;
  link?: string;
  preview?: string;
  artist?: DzArtist;
  album?: DzAlbum;
}
interface DzAlbumFull extends DzAlbum {
  id: number;
  link?: string;
  artist?: DzArtist;
  tracks?: { data?: DzTrack[] };
}
interface DzPlaylist {
  id: number;
  fans?: number;
  nb_tracks?: number;
}

function mapTrack(t: DzTrack, album?: DzAlbum, artistName?: string): DeezerTrack | null {
  const artist = t.artist?.name?.trim() || artistName?.trim();
  const title = (t.title_short || t.title)?.trim();
  if (!artist || !title) return null;
  return {
    artist,
    title,
    duration: t.duration && t.duration > 0 ? Math.round(t.duration) : undefined,
    album: (t.album?.title || album?.title)?.trim() || undefined,
    coverUrl: t.album?.cover_big || t.album?.cover_medium || album?.cover_big || album?.cover_medium,
    previewUrl: t.preview || undefined,
    externalUrl: t.link,
    source: 'deezer',
  };
}

/** Мировой или жанровый чарт Deezer. genreId 0 — все жанры. */
export async function deezerChartTracks(genreId: number, limit = 50): Promise<DeezerTrack[]> {
  const data = await fetchJson<{ data?: DzTrack[] }>(`${API}/chart/${genreId}/tracks?limit=${limit}`);
  return (data.data ?? []).map((t) => mapTrack(t)).filter((t): t is DeezerTrack => t !== null);
}

/** Первые треки альбомов из чарта — ближайший публичный аналог «новинок» без ключа. */
export async function deezerNewTracks(limit = 12): Promise<DeezerTrack[]> {
  const chart = await fetchJson<{ data?: { id: number }[] }>(`${API}/chart/0/albums?limit=${limit}`);
  const albums = await mapLimit(chart.data ?? [], 4, (a) =>
    fetchJson<DzAlbumFull>(`${API}/album/${a.id}`).catch(() => null),
  );
  const tracks: DeezerTrack[] = [];
  for (const album of albums) {
    if (!album) continue;
    const lead = album.tracks?.data?.[0];
    const mapped = lead ? mapTrack(lead, album, album.artist?.name) : null;
    if (mapped) tracks.push(mapped);
  }
  return tracks;
}

/** Подборка из самого популярного плейлиста по запросу (для жанров без id у Deezer). */
export async function deezerPlaylistTracks(query: string, limit = 50): Promise<DeezerTrack[]> {
  const found = await fetchJson<{ data?: DzPlaylist[] }>(
    `${API}/search/playlist?q=${encodeURIComponent(query)}&limit=5`,
  );
  const pick = [...(found.data ?? [])].sort((a, b) => (b.fans ?? 0) - (a.fans ?? 0))[0];
  if (!pick) return [];
  const tracks = await fetchJson<{ data?: DzTrack[] }>(`${API}/playlist/${pick.id}/tracks?limit=${limit}`);
  return (tracks.data ?? []).map((t) => mapTrack(t)).filter((t): t is DeezerTrack => t !== null);
}

interface DzArtistHit {
  id: number;
  name?: string;
}

async function findDeezerArtist(name: string): Promise<DzArtistHit | null> {
  const found = await fetchJson<{ data?: DzArtistHit[] }>(`${API}/search/artist?q=${encodeURIComponent(name)}&limit=5`);
  const wanted = slugify(name);
  return (found.data ?? []).find((artist) => artist.name && slugify(artist.name) === wanted) ?? found.data?.[0] ?? null;
}

/** Поиск треков и исполнителей. Deezer нормально принимает кириллицу. */
export async function deezerSearch(query: string): Promise<{ tracks: DeezerTrack[]; artists: { name: string; imageUrl?: string }[] }> {
  const [tracks, artists] = await Promise.all([
    fetchJson<{ data?: DzTrack[] }>(`${API}/search?q=${encodeURIComponent(query)}&limit=8`),
    fetchJson<{ data?: { name?: string; picture_medium?: string }[] }>(`${API}/search/artist?q=${encodeURIComponent(query)}&limit=5`),
  ]);
  return {
    tracks: (tracks.data ?? []).map((t) => mapTrack(t)).filter((t): t is DeezerTrack => t !== null),
    artists: (artists.data ?? [])
      .filter((artist): artist is { name: string; picture_medium?: string } => Boolean(artist.name))
      .map((artist) => ({ name: artist.name, imageUrl: artist.picture_medium })),
  };
}

/** Топ треков исполнителя, как блок «Популярное». */
export async function deezerTopTracks(artist: string, limit = 10): Promise<DeezerTrack[]> {
  const hit = await findDeezerArtist(artist);
  if (!hit) return [];
  const top = await fetchJson<{ data?: DzTrack[] }>(`${API}/artist/${hit.id}/top?limit=${Math.max(limit, 20)}`);
  const seen = new Set<string>();
  const unique: DeezerTrack[] = [];
  for (const row of top.data ?? []) {
    const mapped = mapTrack(row, undefined, artist);
    if (!mapped) continue;
    const key = `${mapped.artist}\n${mapped.title}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(mapped);
    if (unique.length >= limit) break;
  }
  return unique;
}

/** Треки исполнителя и нескольких похожих. */
export async function deezerArtistMix(artist: string): Promise<DeezerTrack[]> {
  const hit = await findDeezerArtist(artist);
  if (!hit) return deezerTopTracks(artist, 10);
  const [own, related] = await Promise.all([
    fetchJson<{ data?: DzTrack[] }>(`${API}/artist/${hit.id}/top?limit=8`).catch(() => ({ data: [] as DzTrack[] })),
    fetchJson<{ data?: DzArtistHit[] }>(`${API}/artist/${hit.id}/related?limit=4`).catch(() => ({ data: [] as DzArtistHit[] })),
  ]);
  const tracks = (own.data ?? []).map((t) => mapTrack(t, undefined, artist)).filter((t): t is DeezerTrack => t !== null);
  for (const other of (related.data ?? []).slice(0, 3)) {
    const extra = await fetchJson<{ data?: DzTrack[] }>(`${API}/artist/${other.id}/top?limit=3`).catch(() => ({ data: [] as DzTrack[] }));
    for (const row of extra.data ?? []) {
      const mapped = mapTrack(row, undefined, other.name);
      if (mapped) tracks.push(mapped);
    }
  }
  return tracks;
}
