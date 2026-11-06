import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

const ALIASES: Record<string, string> = {
  'hip hop': 'Hip-Hop',
  'hip-hop': 'Hip-Hop',
  hiphop: 'Hip-Hop',
  'hip-hop/rap': 'Hip-Hop',
  'hip hop/rap': 'Hip-Hop',
  'r&b': 'R&B',
  rnb: 'R&B',
  'r and b': 'R&B',
  'r&b/soul': 'R&B',
  'rhythm and blues': 'R&B',
  electronica: 'Electronic',
  electronic: 'Electronic',
  'drum and bass': 'Drum & Bass',
  'drum & bass': 'Drum & Bass',
  dnb: 'Drum & Bass',
};

const cap = (w: string) => (w ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w);

export function normalizeGenre(name: string): string | null {
  const t = name.replace(/\s+/g, ' ').trim();
  if (!t || t.length > 40) return null;
  const alias = ALIASES[t.toLowerCase()];
  if (alias) return alias;
  return t
    .split(' ')
    .map((w) => w.split('-').map(cap).join('-'))
    .join(' ');
}

const JUNK_TAGS = new Set([
  'seen live', 'favorites', 'favourites', 'favorite', 'favourite', 'love', 'loved', 'awesome', 'beautiful',
  'cool', 'good', 'amazing', 'best', 'great', 'my favorite', 'albums i own', 'male vocalists', 'female vocalists',
  'all', 'music', 'songs', 'spotify', 'under 2000 listeners', 'check out', 'usa', 'american', 'british',
]);

/** Фильтрует «мусорные» пользовательские теги Last.fm/MusicBrainz и оставляет похожие на жанры. */
export function cleanTags(tags: { name: string; count?: number | string }[], artist: string, max = 3): string[] {
  const artistLower = artist.toLowerCase();
  const out: string[] = [];
  for (const t of tags) {
    const lower = t.name.trim().toLowerCase();
    const count = Number(t.count ?? 100);
    if (!lower || JUNK_TAGS.has(lower)) continue;
    if (count < 10) continue;
    if (/^\d{2,4}s?$/.test(lower)) continue; // «2010», «90s»
    if (lower.includes(artistLower) || artistLower.includes(lower)) continue;
    const g = normalizeGenre(t.name);
    if (g && !out.includes(g)) out.push(g);
    if (out.length >= max) break;
  }
  return out;
}

async function getOrCreateGenre(name: string) {
  const found = await prisma.genre.findUnique({ where: { name } });
  if (found) return found;
  try {
    return await prisma.genre.create({ data: { name } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return prisma.genre.findUniqueOrThrow({ where: { name } }); // гонка воркеров
    }
    throw e;
  }
}

/** Первый жанр в списке считается основным, остальные — поджанры. */
export async function setTrackGenres(trackId: string, names: string[], replace = false): Promise<void> {
  const normalized = [...new Set(names.map(normalizeGenre).filter((g): g is string => !!g))];
  const ids: string[] = [];
  for (let i = 0; i < normalized.length; i++) {
    const genre = await getOrCreateGenre(normalized[i]!);
    ids.push(genre.id);
    await prisma.trackGenre.upsert({
      where: { trackId_genreId: { trackId, genreId: genre.id } },
      create: { trackId, genreId: genre.id, isPrimary: i === 0 },
      update: { isPrimary: i === 0 },
    });
  }
  if (replace) {
    await prisma.trackGenre.deleteMany({ where: { trackId, genreId: { notIn: ids } } });
  }
}
