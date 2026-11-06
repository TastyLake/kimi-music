import { fetchJson, mapLimit } from '../lib/fetch.js';

export interface DeezerTrack {
  artist: string;
  title: string;
  album?: string;
  coverUrl?: string;
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
