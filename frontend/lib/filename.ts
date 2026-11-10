// Клиентская копия правила именования (сервер всё равно проверяет повторно).

export const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.opus'];
export const NAMING_HINT = 'Переименуйте файл в формат «Исполнитель - Название.mp3» (дефис с пробелами по бокам).';

export function validateUploadName(fileName: string): { ok: true; artist: string; title: string } | { ok: false; error: string } {
  const dot = fileName.lastIndexOf('.');
  const ext = dot > 0 ? fileName.slice(dot).toLowerCase() : '';
  if (!AUDIO_EXTENSIONS.includes(ext)) {
    return { ok: false, error: `Неподдерживаемый формат. Допустимо: ${AUDIO_EXTENSIONS.join(', ')}` };
  }
  const base = fileName.slice(0, dot).replace(/\s+/g, ' ').trim();
  const idx = base.indexOf(' - ');
  const artist = idx > 0 ? base.slice(0, idx).trim() : '';
  const title = idx > 0 ? base.slice(idx + 3).trim() : '';
  if (!artist || !title) return { ok: false, error: `Имя файла не соответствует правилу. ${NAMING_HINT}` };
  return { ok: true, artist, title };
}
