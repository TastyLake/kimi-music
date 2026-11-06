// Чистый модуль без зависимостей: используется и в тестах.

export const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.opus'];

export interface ParsedName {
  artist: string;
  title: string;
}

/** Убирает расширение (только последнее) и возвращает [база, расширение в нижнем регистре]. */
export function splitExtension(fileName: string): { base: string; ext: string } {
  const name = fileName.split(/[\\/]/).pop() ?? fileName;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, dot), ext: name.slice(dot).toLowerCase() };
}

export function isAudioFile(fileName: string): boolean {
  return AUDIO_EXTENSIONS.includes(splitExtension(fileName).ext);
}

/**
 * Правило именования: «Исполнитель - Название.расширение».
 * Делим по ПЕРВОМУ вхождению « - » (дефис с пробелами с обеих сторон), чтобы не ломать
 * исполнителей вроде «Jay-Z» или «AC-DC», а название могло содержать дефисы.
 */
export function parseFileName(fileName: string): ParsedName | null {
  const { base } = splitExtension(fileName);
  const clean = base.replace(/\s+/g, ' ').trim();
  const idx = clean.indexOf(' - ');
  if (idx <= 0) return null;
  const artist = clean.slice(0, idx).trim();
  const title = clean.slice(idx + 3).trim();
  if (!artist || !title) return null;
  return { artist, title };
}

export const NAMING_HINT = 'Переименуйте файл в формат «Исполнитель - Название.mp3» (дефис с пробелами по бокам).';

export type NameCheck = { ok: true; parsed: ParsedName } | { ok: false; error: string };

export function validateUploadName(fileName: string): NameCheck {
  if (!isAudioFile(fileName)) {
    return { ok: false, error: `Неподдерживаемый формат. Допустимо: ${AUDIO_EXTENSIONS.join(', ')}` };
  }
  const parsed = parseFileName(fileName);
  if (!parsed) return { ok: false, error: `Имя файла «${fileName}» не соответствует правилу. ${NAMING_HINT}` };
  return { ok: true, parsed };
}

function norm(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function primaryArtist(artist: string): string {
  return artist.split(/\s+(?:feat\.?|ft\.?|featuring|x|&)\s+|\s*[,;/]\s*/i)[0] ?? artist;
}

function cleanTitle(title: string): string {
  return title
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ') // (feat. X), [Remastered]
    .replace(/\s+-\s+.*$/, '') // «Song - Remastered 2011»
    .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i, '');
}

/** Нормализованный ключ «исполнитель|название» для сопоставления внешних чартов с локальной базой. */
export function matchKey(artist: string, title: string): string {
  return `${norm(primaryArtist(artist))}|${norm(cleanTitle(title))}`;
}
