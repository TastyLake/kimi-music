// Чистый модуль: разбор HTTP Range для стриминга (206 Partial Content).

export type RangeResult = { start: number; end: number } | 'unsatisfiable' | null;

/**
 * null            — заголовка нет или он некорректен → отдаём файл целиком (200)
 * 'unsatisfiable' — диапазон за пределами файла → 416
 * {start,end}     — включительные границы байтов → 206
 * Несколько диапазонов («bytes=0-1,5-6») не поддерживаются: берём первый.
 */
export function parseRange(header: string | undefined, size: number): RangeResult {
  if (!header) return null;
  const first = header.split(',')[0]?.trim() ?? '';
  const m = /^bytes=(\d*)-(\d*)$/.exec(first);
  if (!m) return null;
  const [, s, e] = m;
  if (s === '' && e === '') return null;
  if (size <= 0) return 'unsatisfiable';

  let start: number;
  let end: number;
  if (s === '') {
    const suffix = parseInt(e!, 10);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = parseInt(s!, 10);
    end = e === '' ? size - 1 : Math.min(parseInt(e!, 10), size - 1);
  }
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

export const MIME_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg; codecs=opus',
  '.m4a': 'audio/mp4',
};
