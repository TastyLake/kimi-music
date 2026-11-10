const SPLIT = /\s*(?:,|&|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\sx\s)\s*/i;

/** «Alessia Cara, Logic» и «Song feat. Name» → отдельные имена. */
export function splitArtists(input: string): string[] {
  const parts = input
    .split(SPLIT)
    .map((part) => part.trim())
    .filter(Boolean);
  const unique: string[] = [];
  for (const part of parts) {
    if (!unique.some((name) => name.toLowerCase() === part.toLowerCase())) unique.push(part);
  }
  return unique.length > 0 ? unique : [input.trim()].filter(Boolean);
}
