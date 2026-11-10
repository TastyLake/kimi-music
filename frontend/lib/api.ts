import { useAuth } from '@/store/auth';
import type { Session } from '@/lib/types';

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public data?: Record<string, unknown>,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

function buildUrl(path: string, query?: Query): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return `${API_BASE}${path}${s ? `?${s}` : ''}`;
}

/** Обложки отдаются бэкендом как /api/covers/…; при прямом API_URL подставляем его origin. */
export function assetUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//.test(url)) return url;
  if (API_BASE.startsWith('http')) return API_BASE.replace(/\/api\/?$/, '') + url;
  return url;
}

export function streamUrl(trackId: string): string {
  const token = useAuth.getState().streamToken ?? '';
  return `${API_BASE}/tracks/${trackId}/stream?token=${encodeURIComponent(token)}`;
}

/** Прямая ссылка на аудиопоток. Если CDN недоступен браузеру, остаётся прокси /external/stream. */
export async function resolveExternalSrc(artist: string, title: string): Promise<string> {
  try {
    const data = await api<{ url: string }>('/external/resolve', { query: { artist, title } });
    if (data.url?.startsWith('http')) return data.url;
  } catch {
    /* запасной прокси */
  }
  return externalStreamUrl(artist, title);
}

/** Полный поток внешнего трека. В медиатеку не сохраняется. */
export function externalStreamUrl(artist: string, title: string): string {
  const token = useAuth.getState().streamToken || useAuth.getState().accessToken || '';
  const qs = new URLSearchParams({ artist, title, token });
  return `${API_BASE}/external/stream?${qs}`;
}

let refreshing: Promise<boolean> | null = null;

/** Обновляет пару токенов по refresh-токену (один запрос на всех параллельных вызовов). */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    const { refreshToken, logout } = useAuth.getState();
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) logout();
        return false;
      }
      const data = (await res.json().catch(() => null)) as Partial<Session> | null;
      const accessToken = data?.accessToken;
      if (!data || !accessToken) return false;
      // Не затираем user / streamToken, если бэкенд вернул только токены
      useAuth.setState((s) => ({
        user: data.user ?? s.user,
        accessToken,
        refreshToken: data.refreshToken ?? s.refreshToken,
        streamToken: data.streamToken ?? s.streamToken,
      }));
      return true;
    } catch {
      return false;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function refreshStreamToken(): Promise<void> {
  const r = await api<{ streamToken: string }>('/auth/stream-token');
  useAuth.getState().setStreamToken(r.streamToken);
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** объект → JSON; FormData отправляется как multipart/form-data */
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
  /** не пытаться обновлять сессию (для /auth/login и т.п.) */
  anonymous?: boolean;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const hasBody = opts.body !== undefined;
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;

  const doFetch = () => {
    const token = useAuth.getState().accessToken;
    return fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers: {
        // Для FormData Content-Type выставляет браузер (вместе с boundary)
        ...(hasBody && !isForm ? { 'Content-Type': 'application/json' } : {}),
        ...(token && !opts.anonymous ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: !hasBody ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  };

  let res: Response;
  try {
    res = await doFetch();
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'network', 'Нет связи с сервером');
  }

  if (res.status === 401 && !opts.anonymous && useAuth.getState().refreshToken) {
    if (await refreshSession()) res = await doFetch();
  }
  if (res.status === 204) return undefined as T;

  const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { error?: string; message?: string }) | null;
  if (!res.ok) {
    if (res.status === 401 && !opts.anonymous) useAuth.getState().logout();
    throw new ApiError(res.status, data?.error ?? 'error', data?.message ?? res.statusText, data ?? undefined);
  }
  return data as T;
}

export interface UploadOutcome {
  fileName: string;
  status: 'created' | 'duplicate' | 'error';
  error?: string;
}

/**
 * Загрузка одного файла в личную медиатеку с прогрессом и повторами при ошибках 5xx / сбоях сети.
 */
export function uploadFile(file: File, onProgress: (pct: number) => void): Promise<UploadOutcome> {
  const maxRetries = 3;

  const sendOnce = (canRetrySession: boolean): Promise<UploadOutcome> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/upload`);
      xhr.setRequestHeader('Authorization', `Bearer ${useAuth.getState().accessToken ?? ''}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };

      xhr.onerror = () => reject(new ApiError(0, 'network', 'Нет связи с сервером'));

      xhr.onload = async () => {
        if (xhr.status === 401 && canRetrySession && (await refreshSession())) {
          return sendOnce(false).then(resolve, reject);
        }
        let data: { results?: UploadOutcome[]; message?: string; error?: string } = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          /* пустой ответ */
        }
        if (xhr.status >= 400) {
          return reject(new ApiError(xhr.status, data.error ?? 'error', data.message ?? `Ошибка ${xhr.status}`));
        }
        resolve(data.results?.[0] ?? { fileName: file.name, status: 'error', error: 'Пустой ответ сервера' });
      };

      const fd = new FormData();
      fd.append('files', file, file.name);
      xhr.send(fd);
    });
  };

  return (async () => {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await sendOnce(true);
      } catch (err) {
        if (err instanceof ApiError) {
          // Ошибки клиента (4xx, кроме 429) не повторяем
          if (err.status >= 400 && err.status < 500 && err.status !== 429) {
            throw err;
          }
        }
        if (attempt === maxRetries - 1) throw err;
        // Пауза 2 секунды перед повтором при 5xx / сбое сети
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    throw new ApiError(0, 'network', 'Не удалось загрузить файл после нескольких попыток');
  })();
}
