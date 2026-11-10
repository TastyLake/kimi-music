const TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

const DIGRAPHS: [string, string][] = [
  ['sch', 'щ'], ['sh', 'ш'], ['ch', 'ч'], ['ts', 'ц'], ['kh', 'х'], ['yo', 'ё'], ['yu', 'ю'],
  ['ya', 'я'], ['zh', 'ж'],
];

const TO_CYR: Record<string, string> = {
  a: 'а', b: 'б', c: 'к', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'х', i: 'и', j: 'й', k: 'к',
  l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', q: 'к', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в',
  w: 'в', x: 'кс', y: 'й', z: 'з',
};

export function toLatin(input: string): string {
  return [...input.toLowerCase()].map((ch) => TO_LATIN[ch] ?? ch).join('');
}

export function toCyrillic(input: string): string {
  let rest = input.toLowerCase();
  let out = '';
  while (rest) {
    const digraph = DIGRAPHS.find(([latin]) => rest.startsWith(latin));
    if (digraph) {
      out += digraph[1];
      rest = rest.slice(digraph[0].length);
      continue;
    }
    const ch = rest[0]!;
    out += TO_CYR[ch] ?? ch;
    rest = rest.slice(1);
  }
  return out;
}

/** Исходная строка и её транслит в обе стороны, чтобы «Меладзе» находил «Meladze». */
export function searchVariants(query: string): string[] {
  const raw = query.trim();
  const values = [raw, toLatin(raw), toCyrillic(raw)];
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))];
}
