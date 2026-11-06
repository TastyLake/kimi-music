'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/* ---------------- Типы ---------------- */

interface ImportTrack {
  artist: string;
  title: string;
}
interface ImportResult {
  playlist: { id: string; name: string };
  total: number;
  matched: number;
  missing: ImportTrack[];
}
interface SpPlaylist {
  id: string;
  name: string;
  total: number;
}

/* ---------------- Spotify: OAuth Authorization Code + PKCE (всё происходит в браузере) ---------------- */

const SCOPES = 'playlist-read-private playlist-read-collaborative';
const TOKEN_KEY = 'loral-sp-token';
const VERIFIER_KEY = 'loral-sp-verifier';
const STATE_KEY = 'loral-sp-state';
const PENDING_KEY = 'loral-pending-import';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';

function randomString(len = 64): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

class SpotifyError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function loadToken(): string | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const { token, exp } = JSON.parse(raw) as { token: string; exp: number };
    return Date.now() < exp ? token : null;
  } catch {
    return null;
  }
}

async function spotify<T>(token: string, urlOrPath: string): Promise<T> {
  const url = urlOrPath.startsWith('http') ? urlOrPath : `https://api.spotify.com/v1${urlOrPath}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.ok) return (await res.json()) as T;
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  throw new SpotifyError(res.status, body?.error?.message ?? `Ошибка Spotify ${res.status}`);
}

interface Paging<T> {
  items: T[];
  next: string | null;
}

async function fetchAll<T>(token: string, firstUrl: string, limit = 5000): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = firstUrl;
  while (next && out.length < limit) {
    const page: Paging<T> = await spotify<Paging<T>>(token, next);
    out.push(...page.items);
    next = page.next;
  }
  return out;
}

interface RawPlaylist {
  id: string;
  name: string;
  // Spotify переименовал tracks → items (февраль 2026); поддерживаем оба варианта
  items?: { total?: number };
  tracks?: { total?: number };
}
interface RawEntry {
  item?: RawTrack | null;
  track?: RawTrack | null;
}
interface RawTrack {
  name?: string;
  type?: string;
  artists?: { name: string }[];
}

async function fetchPlaylistTracks(token: string, id: string): Promise<ImportTrack[]> {
  let entries: RawEntry[];
  try {
    entries = await fetchAll<RawEntry>(token, `/playlists/${id}/items?limit=100&additional_types=track`);
  } catch (e) {
    if (!(e instanceof SpotifyError) || e.status !== 404) throw e;
    entries = await fetchAll<RawEntry>(token, `/playlists/${id}/tracks?limit=100`); // старое название эндпоинта
  }
  const out: ImportTrack[] = [];
  for (const e of entries) {
    const t = e.item ?? e.track;
    if (!t?.name || (t.type && t.type !== 'track')) continue; // пропускаем подкасты и пустые записи
    const artist = t.artists?.[0]?.name;
    if (artist) out.push({ artist, title: t.name });
  }
  return out;
}

/* ---------------- Страница ---------------- */

export default function ImportPage() {
  const router = useRouter();
  const [tab, setTab] = useState<'spotify' | 'file'>('spotify');
  const [clientId, setClientId] = useState<string | null | undefined>(undefined);
  const [redirectUri, setRedirectUri] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<SpPlaylist[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // файл / текст
  const [fileName, setFileName] = useState('');
  const [text, setText] = useState('');
  const [plName, setPlName] = useState('');

  const isLocalhost = typeof window !== 'undefined' && window.location.hostname === 'localhost';

  const logoutSpotify = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setPlaylists(null);
  }, []);

  const loadPlaylists = useCallback(
    async (tk: string) => {
      setBusy('Загружаю ваши плейлисты из Spotify…');
      try {
        const raw = await fetchAll<RawPlaylist>(tk, '/me/playlists?limit=50');
        setPlaylists(raw.filter(Boolean).map((p) => ({ id: p.id, name: p.name, total: p.items?.total ?? p.tracks?.total ?? 0 })));
      } catch (e) {
        if (e instanceof SpotifyError && e.status === 401) {
          logoutSpotify();
          setError('Сессия Spotify истекла. Войдите снова.');
        } else if (e instanceof SpotifyError && e.status === 403) {
          setError(
            `Spotify отказал в доступе (${e.message}). Приложение в режиме разработки доступно только добавленным пользователям — добавьте свой аккаунт в User Management в панели разработчика Spotify.`,
          );
        } else setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [logoutSpotify],
  );

  // Инициализация: настройки сервера, возврат из Spotify с ?code=…
  useEffect(() => {
    setRedirectUri(`${window.location.origin}/import`);
    let cancelled = false;

    (async () => {
      const cfg = await api<{ spotifyClientId: string | null }>('/import/config').catch(() => ({ spotifyClientId: null }));
      if (cancelled) return;
      setClientId(cfg.spotifyClientId);

      // параметры возврата: из адресной строки или сохранённые, если пользователь успел залогиниться в Loral
      const search = sessionStorage.getItem(PENDING_KEY) ?? window.location.search;
      sessionStorage.removeItem(PENDING_KEY);
      const params = new URLSearchParams(search);
      const code = params.get('code');
      const spError = params.get('error');
      if (code || spError) window.history.replaceState({}, '', '/import');

      if (spError) {
        setError(spError === 'access_denied' ? 'Вы отклонили доступ в Spotify.' : `Spotify: ${spError}`);
        return;
      }
      if (code && cfg.spotifyClientId) {
        setBusy('Завершаю вход в Spotify…');
        try {
          if (params.get('state') !== sessionStorage.getItem(STATE_KEY)) throw new Error('Не совпал параметр state — начните вход заново.');
          const verifier = sessionStorage.getItem(VERIFIER_KEY);
          if (!verifier) throw new Error('Потерян code_verifier — начните вход заново.');
          const res = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: cfg.spotifyClientId,
              grant_type: 'authorization_code',
              code,
              redirect_uri: `${window.location.origin}/import`,
              code_verifier: verifier,
            }),
          });
          const data = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
          if (!res.ok || !data.access_token) throw new Error(data.error_description ?? 'Spotify не выдал токен');
          sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token: data.access_token, exp: Date.now() + (data.expires_in ?? 3600) * 1000 - 30_000 }));
          sessionStorage.removeItem(VERIFIER_KEY);
          sessionStorage.removeItem(STATE_KEY);
          if (!cancelled) {
            setToken(data.access_token);
            await loadPlaylists(data.access_token);
          }
        } catch (e) {
          if (!cancelled) setError((e as Error).message);
        } finally {
          if (!cancelled) setBusy(null);
        }
        return;
      }

      const saved = loadToken();
      if (saved) {
        setToken(saved);
        void loadPlaylists(saved);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadPlaylists]);

  const connect = async () => {
    if (!clientId) return;
    setError(null);
    const verifier = randomString(64);
    const state = randomString(16);
    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(STATE_KEY, state);
    const url = new URL('https://accounts.spotify.com/authorize');
    url.search = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: SCOPES,
      state,
      code_challenge_method: 'S256',
      code_challenge: await challengeFor(verifier),
    }).toString();
    window.location.href = url.toString();
  };

  const importFromSpotify = async (p: SpPlaylist) => {
    if (!token) return;
    setError(null);
    setBusy(`Читаю треки «${p.name}»…`);
    try {
      const tracks = await fetchPlaylistTracks(token, p.id);
      if (tracks.length === 0) throw new Error('В плейлисте не нашлось треков.');
      setBusy('Сопоставляю с вашей медиатекой…');
      const created = await api<ImportResult>('/import/playlist', { method: 'POST', body: { name: p.name, tracks } });
      router.push(`/playlists/${created.playlist.id}`);
    } catch (e) {
      if (e instanceof SpotifyError && e.status === 401) {
        logoutSpotify();
        setError('Сессия Spotify истекла. Войдите снова.');
      } else if (e instanceof SpotifyError && e.status === 403) {
        setError('Spotify не отдаёт содержимое этого плейлиста: доступны только плейлисты, которые вы создали или ведёте совместно. Для остальных используйте импорт из CSV (вкладка «Файл или текст»).');
      } else if (e instanceof SpotifyError && e.status === 429) {
        setError('Spotify ограничил число запросов. Подождите минуту и повторите.');
      } else setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setFileName(f.name);
    setText(await f.text());
    if (!plName) setPlName(f.name.replace(/\.[^.]+$/, ''));
  };

  const importFromText = async () => {
    setError(null);
    setBusy('Импортирую…');
    try {
      const created = await api<ImportResult>('/import/playlist', { method: 'POST', body: { name: plName.trim() || 'Импортированный плейлист', text } });
      router.push(`/playlists/${created.playlist.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Импорт плейлиста</h1>
        <p className="text-sm text-zinc-500">
          Loral создаст плейлист сразу. Треки, которых нет в медиатеке, скачиваются в фоне и появляются в плейлисте по мере готовности.
        </p>
      </div>

      <div className="flex gap-1 rounded-lg bg-zinc-900 p-1 text-sm w-fit">
        {(
          [
            ['spotify', 'Spotify'],
            ['file', 'Файл или текст'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={cn('rounded-md px-4 py-1.5', tab === id ? 'bg-accent font-semibold text-black' : 'text-zinc-400 hover:text-white')}>
            {label}
          </button>
        ))}
      </div>

      {error && <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}
      {busy && (
        <div className="flex items-center gap-2 text-sm text-zinc-300">
          <Loader2 size={16} className="animate-spin text-accent" /> {busy}
        </div>
      )}

      {tab === 'spotify' && (
        <div className="space-y-4">
          {clientId === undefined && <div className="text-sm text-zinc-500">Загрузка…</div>}

          {clientId === null && (
            <div className="card space-y-3 p-5 text-sm text-zinc-300">
              <div className="font-semibold text-white">Вход через Spotify ещё не настроен</div>
              <ol className="list-decimal space-y-1 pl-5">
                <li>
                  Откройте <b>developer.spotify.com/dashboard</b> и создайте приложение (потребуется аккаунт Spotify Premium).
                </li>
                <li>
                  В поле <b>Redirect URI</b> укажите: <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-yellow-300">{redirectUri || 'http://127.0.0.1:3000/import'}</code>
                </li>
                <li>
                  Скопируйте <b>Client ID</b> в <code className="rounded bg-zinc-800 px-1.5 py-0.5">backend/.env</code> (<code>SPOTIFY_CLIENT_ID=…</code>) и перезапустите сервер.
                </li>
              </ol>
              <p className="text-zinc-500">Без настройки можно импортировать плейлист из CSV-файла — вкладка «Файл или текст».</p>
            </div>
          )}

          {clientId && !token && !busy && (
            <div className="card space-y-4 p-5">
              {isLocalhost && (
                <div className="rounded-lg bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                  Spotify не принимает адрес <b>localhost</b>. Откройте Loral как <b>http://127.0.0.1:3000</b> (войдите там заново) и повторите.
                </div>
              )}
              <div className="text-sm text-zinc-300">
                Loral запросит у Spotify доступ только на чтение ваших плейлистов. Токен хранится в браузере до закрытия вкладки и на сервер не отправляется.
              </div>
              <div className="text-xs text-zinc-500">
                Redirect URI в настройках вашего Spotify-приложения должен быть: <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-yellow-300">{redirectUri}</code>
              </div>
              <button className="btn btn-primary" onClick={connect} disabled={isLocalhost}>
                Войти через Spotify
              </button>
            </div>
          )}

          {token && playlists && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">Ваши плейлисты в Spotify ({playlists.length})</span>
                <button className="text-zinc-500 hover:text-white" onClick={logoutSpotify}>
                  Выйти из Spotify
                </button>
              </div>
              {playlists.length === 0 && <div className="card p-6 text-center text-sm text-zinc-500">Плейлистов не найдено.</div>}
              <ul className="card divide-y divide-white/5">
                {playlists.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm">{p.name}</div>
                      <div className="text-xs text-zinc-500">{p.total} треков</div>
                    </div>
                    <button className="btn shrink-0" onClick={() => void importFromSpotify(p)} disabled={!!busy}>
                      Перенести
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === 'file' && (
        <div className="card space-y-4 p-5">
          <div className="space-y-2 text-sm text-zinc-300">
            <div className="flex items-center gap-2 font-semibold text-white">
              <FileText size={16} className="text-accent" /> Как получить список из Spotify без входа
            </div>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                Откройте <b>exportify.net</b>, войдите через Spotify и нажмите «Export» у нужного плейлиста — скачается CSV.
              </li>
              <li>Загрузите этот файл сюда. Подойдёт и обычный текстовый список, по строке на трек: «Исполнитель - Название».</li>
            </ol>
          </div>

          <input className="input" placeholder="Название плейлиста" value={plName} onChange={(e) => setPlName(e.target.value)} maxLength={100} />
          <label className="btn cursor-pointer">
            <FileText size={14} /> {fileName || 'Выбрать файл (.csv, .txt)'}
            <input type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          <textarea
            className="input min-h-40 font-mono text-xs"
            placeholder={'или вставьте список:\nLogic - 44 Bars\nJay-Z - 99 Problems'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="btn btn-primary" onClick={importFromText} disabled={!text.trim() || !!busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            Импортировать
          </button>
        </div>
      )}
    </div>
  );
}
