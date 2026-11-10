/** Совпадает с backend/src/lib/slug.ts — адрес карточки можно собрать до того, как запись появится в базе. */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return slug || 'item';
}

export function artistHref(name: string): string {
  return `/artist/${slugify(name)}?name=${encodeURIComponent(name)}`;
}

export function albumHref(artist: string, album: string): string {
  return `/album/${slugify(artist)}/${slugify(album)}?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(album)}`;
}
