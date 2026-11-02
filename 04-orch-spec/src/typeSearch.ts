// Searching types by name: first what holds the typed text as it is, then what
// holds its characters in this order (`nat3` → `NaturalPersonCreateNaturalPerson3Request`).

/**
 * Length of the shortest stretch of `hay` that holds the characters of `needle`
 * in this order — null if it does not hold them. The shorter, the closer the hit.
 */
export function subsequenceSpan(hay: string, needle: string): number | null {
  if (!needle) return 0;
  let best: number | null = null;
  for (let start = hay.indexOf(needle[0]); start >= 0; start = hay.indexOf(needle[0], start + 1)) {
    let at = start;
    for (let k = 1; k < needle.length && at >= 0; k++) at = hay.indexOf(needle[k], at + 1);
    if (at < 0) break; // from a later start it does not fit either
    const span = at - start + 1;
    if (best == null || span < best) best = span;
  }
  return best;
}

/**
 * Rank of a hit by its name: the name itself (or its last part after `.`) 0,
 * starting with the text 1, all words in the name 2, only elsewhere (field,
 * package) 3.
 */
export function nameRank(name: string, needle: string, words: string[]): number {
  const n = name.toLowerCase(), short = n.split('.').pop()!;
  if (n === needle || short === needle) return 0;
  if (n.startsWith(needle) || short.startsWith(needle)) return 1;
  if (words.every(w => n.includes(w))) return 2;
  return 3;
}

/**
 * The hits of a search, in order:
 *   1. entries whose `haystack` holds every word — by `nameRank`, then as given
 *   2. entries whose name holds the typed characters (without spaces) in this
 *      order — the shorter the stretch, the earlier
 */
export function searchByName<T>(entries: T[], query: string, name: (e: T) => string, haystack: (e: T) => string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;
  const words = needle.split(/\s+/);
  const exact: Array<{ e: T; r: number; i: number }> = [];
  const loose: Array<{ e: T; span: number; i: number }> = [];
  const chars = words.join('');
  entries.forEach((e, i) => {
    if (words.every(w => haystack(e).includes(w))) exact.push({ e, r: nameRank(name(e), needle, words), i });
    else {
      const span = subsequenceSpan(name(e).toLowerCase(), chars);
      if (span != null) loose.push({ e, span, i });
    }
  });
  return [
    ...exact.sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.e),
    ...loose.sort((a, b) => a.span - b.span || a.i - b.i).map(x => x.e),
  ];
}
