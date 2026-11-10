import { config } from '../config.js';

export const USER_AGENT = `MusicServer/1.0 (${config.MUSICBRAINZ_CONTACT})`;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(init.headers as Record<string, string>) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} от ${new URL(url).host}`);
  return (await res.json()) as T;
}

/** Простейший ограничитель параллелизма */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

/** Мини-кеш в памяти с TTL */
const cache = new Map<string, { exp: number; value: unknown }>();
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value as T;
  const value = await fn();
  cache.set(key, { exp: Date.now() + ttlMs, value });
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache) if (v.exp < now) cache.delete(k);
  }
  return value;
}
