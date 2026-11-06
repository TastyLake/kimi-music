/** Разбор ссылки Spotify и списка «исполнитель — название» для импорта плейлиста. */

export function parseSpotifyPlaylistId(input: string): string | null {
  const s = input.trim();
  const m =
    s.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?playlist\/([A-Za-z0-9]+)/i) ||
    s.match(/^spotify:playlist:([A-Za-z0-9]+)$/i) ||
    s.match(/^([A-Za-z0-9]{22})$/);
  return m?.[1] ?? null;
}

export interface NamedTrack {
  artist: string;
  title: string;
}

function unquote(cell: string): string {
  const t = cell.trim();
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).replace(/""/g, '"').trim();
  return t;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',' || ch === '\t' || ch === ';') {
      out.push(unquote(cur));
      cur = '';
    } else cur += ch;
  }
  out.push(unquote(cur));
  return out;
}

function fromDash(line: string): NamedTrack | null {
  const parts = line.split(/\s+-\s+/);
  if (parts.length < 2) return null;
  const artist = parts[0]!.trim();
  const title = parts.slice(1).join(' - ').trim();
  if (!artist || !title) return null;
  return { artist, title };
}

/** Текст: CSV Spotify/Exportify или строки «Исполнитель - Название». */
export function parseTrackList(text: string): NamedTrack[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (lines.length === 0) return [];

  const header = splitCsvLine(lines[0]!).map((c) => c.toLowerCase());
  const titleIdx = header.findIndex((c) => /^(track name|track_name|title|название|track)$/.test(c));
  const artistIdx = header.findIndex((c) => /^(artist name|artist_name|artist|исполнитель|artists)$/.test(c));

  const out: NamedTrack[] = [];
  const seen = new Set<string>();
  const push = (t: NamedTrack | null) => {
    if (!t) return;
    const key = `${t.artist.toLowerCase()}\0${t.title.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };

  if (titleIdx >= 0 && artistIdx >= 0) {
    for (const line of lines.slice(1)) {
      const cols = splitCsvLine(line);
      const artist = (cols[artistIdx] ?? '').split(',')[0]?.trim() ?? '';
      const title = (cols[titleIdx] ?? '').trim();
      push(artist && title ? { artist, title } : fromDash(line));
    }
    return out;
  }

  for (const line of lines) push(fromDash(line.replace(/^[\d.]+\s+/, '')));
  return out;
}
