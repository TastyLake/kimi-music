/** Стабильный адрес карточки. Та же функция есть на фронтенде в lib/entity.ts. */
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
