// Чистый модуль без зависимостей: разбор списков треков для импорта плейлиста.

export interface ImportTrack {
  artist: string;
  title: string;
}

export const MAX_IMPORT_TRACKS = 5000;

/** Разбор CSV с кавычками, запятыми и переводами строк внутри полей (RFC 4180). Разделитель определяется по заголовку. */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

const norm = (s: string) => s.replace(/^﻿/, '').trim().toLowerCase();

function fromCsv(text: string): ImportTrack[] | null {
  const rows = parseCsv(text);
  const header = rows[0]?.map(norm);
  if (!header) return null;

  // Exportify: «Track Name», «Artist Name(s)»; обобщённо: artist + (track | title | song | name)
  const artistCol = header.findIndex((h) => /^artist/.test(h));
  const titleCol = header.findIndex((h) => /^(track name|track|title|song|song name|name)$/.test(h));
  if (artistCol < 0 || titleCol < 0) return null;

  const out: ImportTrack[] = [];
  for (const r of rows.slice(1)) {
    // В Exportify несколько исполнителей разделены «;» — берём первого
    const artist = (r[artistCol] ?? '').split(';')[0]!.trim();
    const title = (r[titleCol] ?? '').trim();
    if (artist && title) out.push({ artist, title });
  }
  return out;
}

function fromLines(text: string): ImportTrack[] {
  const out: ImportTrack[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw
      .replace(/^﻿/, '')
      .replace(/^\s*(?:\d+[.)]\s+|[-*•]\s+)/, '') // нумерация и маркеры списка
      .replace(/\.(mp3|flac|wav|ogg|m4a|opus)\s*$/i, '') // можно вставить и имена файлов
      .trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(line); // «Исполнитель - Название» (первое вхождение)
    if (m) out.push({ artist: m[1]!.trim(), title: m[2]!.trim() });
  }
  return out;
}

/** Определяет формат (CSV с заголовком или строки «Исполнитель - Название») и возвращает уникальные треки по порядку. */
export function parseImportText(text: string): ImportTrack[] {
  const tracks = fromCsv(text) ?? fromLines(text);
  const seen = new Set<string>();
  const out: ImportTrack[] = [];
  for (const t of tracks) {
    const k = `${t.artist.toLowerCase()}|${t.title.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= MAX_IMPORT_TRACKS) break;
  }
  return out;
}
