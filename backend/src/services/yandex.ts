import { fetchJson } from '../lib/fetch.js';

export interface YandexTrack {
  artist: string;
  title: string;
  album?: string;
}

export interface YandexPlaylistInfo {
  owner: string;
  kind: string;
  title: string;
  trackCount: number;
}

const HOSTS = new Set(['music.yandex.ru', 'music.yandex.com', 'music.yandex.by', 'music.yandex.kz', 'music.yandex.uz']);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function readTrack(row: unknown): YandexTrack | null {
  const rec = asRecord(row);
  const nested = asRecord(rec?.track) ?? rec;
  if (!nested) return null;
  const title = typeof nested.title === 'string' ? nested.title.trim() : '';
  const artists = Array.isArray(nested.artists) ? nested.artists : [];
  const artist = artists
    .map((a) => (typeof asRecord(a)?.name === 'string' ? String(asRecord(a)?.name) : ''))
    .filter(Boolean)
    .join(', ');
  const albums = Array.isArray(nested.albums) ? nested.albums : [];
  const album = typeof asRecord(albums[0])?.title === 'string' ? String(asRecord(albums[0])?.title) : undefined;
  if (!title || !artist) return null;
  return { artist, title, album };
}

export function parseYandexPlaylistUrl(input: string): { owner: string; kind: string } | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (!HOSTS.has(url.hostname)) return null;
  const match = url.pathname.match(/\/users\/([^/]+)\/playlists\/([^/]+)/);
  if (!match?.[1] || !match[2]) return null;
  return { owner: decodeURIComponent(match[1]), kind: decodeURIComponent(match[2]) };
}

export async function yandexPublicPlaylist(input: string): Promise<{ title: string; tracks: YandexTrack[] }> {
  const parsed = parseYandexPlaylistUrl(input);
  if (!parsed) throw new Error('Нужна ссылка вида music.yandex.ru/users/…/playlists/…');
  const qs = new URLSearchParams({ owner: parsed.owner, kinds: parsed.kind, light: 'false' });
  const data = await fetchJson<unknown>(`https://music.yandex.ru/handlers/playlist.jsx?${qs}`, {}, 15_000);
  const playlist = asRecord(asRecord(data)?.playlist) ?? asRecord(data);
  const title = typeof playlist?.title === 'string' ? playlist.title : 'Плейлист Яндекс Музыки';
  const raw = Array.isArray(playlist?.tracks) ? playlist.tracks : [];
  const tracks = raw.map(readTrack).filter((t): t is YandexTrack => Boolean(t));
  if (tracks.length === 0) throw new Error('Плейлист пуст или закрыт');
  return { title, tracks };
}

async function yandexApi<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://api.music.yandex.net${path}`, {
    headers: {
      Authorization: `OAuth ${token.trim()}`,
      Accept: 'application/json',
      'User-Agent': 'Kima/1.0',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) throw new Error('Токен Яндекс Музыки не принят');
  if (!res.ok) throw new Error(`Яндекс Музыка ответила ${res.status}`);
  return (await res.json()) as T;
}

export async function yandexAccount(token: string): Promise<{ uid: string; playlists: YandexPlaylistInfo[] }> {
  const me = await yandexApi<{ result?: { account?: { uid?: number }; uid?: number } }>(`/account/status`, token);
  const uid = String(me.result?.account?.uid ?? me.result?.uid ?? '');
  if (!uid) throw new Error('Не удалось прочитать аккаунт');
  const list = await yandexApi<{ result?: { kind?: number; title?: string; trackCount?: number; owner?: { login?: string } }[] }>(
    `/users/${uid}/playlists/list`,
    token,
  );
  const playlists = (list.result ?? [])
    .filter((p) => p.kind != null && p.title)
    .map((p) => ({
      owner: p.owner?.login || uid,
      kind: String(p.kind),
      title: p.title || 'Плейлист',
      trackCount: p.trackCount ?? 0,
    }));
  return { uid, playlists };
}

export async function yandexLikedTracks(token: string, uid: string): Promise<YandexTrack[]> {
  const likes = await yandexApi<{ result?: { library?: { tracks?: { id?: string | number }[] } } }>(
    `/users/${uid}/likes/tracks`,
    token,
  );
  const ids = (likes.result?.library?.tracks ?? []).map((t) => String(t.id ?? '')).filter(Boolean).slice(0, 400);
  const tracks: YandexTrack[] = [];
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const body = await yandexApi<{ result?: unknown[] }>(`/tracks?track-ids=${chunk.join(',')}`, token);
    for (const row of body.result ?? []) {
      const track = readTrack(row);
      if (track) tracks.push(track);
    }
  }
  return tracks;
}

export async function yandexPlaylistTracks(token: string, owner: string, kind: string): Promise<{ title: string; tracks: YandexTrack[] }> {
  const data = await yandexApi<{ result?: { title?: string; tracks?: unknown[] } }>(`/users/${encodeURIComponent(owner)}/playlists/${encodeURIComponent(kind)}`, token);
  const title = data.result?.title || 'Плейлист Яндекс Музыки';
  const tracks = (data.result?.tracks ?? []).map(readTrack).filter((t): t is YandexTrack => Boolean(t));
  if (tracks.length === 0) throw new Error('В плейлисте нет треков');
  return { title, tracks };
}
