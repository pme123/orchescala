// Undo and redo in the page designer: the states before and after the current one. Typing in a field
// is one step - changes with the same key within one second are merged.

export type History<T> = { past: T[]; future: T[]; last: { key: string; at: number; since: number } | null };

export const emptyHistory = <T>(): History<T> => ({ past: [], future: [], last: null });

/** This many steps back - older ones are dropped. */
export const HISTORY_LIMIT = 100;
/** Up to this pause (ms), typing with the same key is one step. */
export const COALESCE_MS = 1000;
/** A step does not last longer (ms) - whoever types a long time without a pause can still go back piece by piece. */
export const COALESCE_MAX_MS = 10000;

/** A change away from `current`: a new step back - unless it continues the last one (same
  * key, less than COALESCE_MS later). There is no redo after that. */
export function record<T>(h: History<T>, current: T, coalesce: string | undefined, now: number): History<T> {
  const same = coalesce !== undefined && h.last?.key === coalesce && now - h.last.at < COALESCE_MS
    && now - h.last.since < COALESCE_MAX_MS;
  return {
    past: same ? h.past : [...h.past.slice(-(HISTORY_LIMIT - 1)), current],
    future: same ? h.future : [],
    last: coalesce === undefined ? null : { key: coalesce, at: now, since: same ? (h.last?.since ?? now) : now },
  };
}

/** One step back (undo) or forward (redo) from `current` - null if there is none. */
export function travel<T>(h: History<T>, current: T, dir: 'undo' | 'redo'): { history: History<T>; value: T } | null {
  const from = dir === 'undo' ? h.past : h.future;
  if (from.length === 0) return null;
  const value = from[from.length - 1];
  const rest = from.slice(0, -1);
  const to = [...(dir === 'undo' ? h.future : h.past), current].slice(-HISTORY_LIMIT);
  return {
    value,
    history: dir === 'undo' ? { past: rest, future: to, last: null } : { past: to, future: rest, last: null },
  };
}

/** Where two states differ - the path down to where it is exactly one location ('label',
  * 'options.0.label'); a list of different length or several locations end at the common part
  * ('options'). For the key of merging: typing in a field is one step, another
  * field (or deleting an option) a new one. */
export function diffPath(a: unknown, b: unknown, path = ''): string {
  const isTree = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
  if (!isTree(a) || !isTree(b) || Array.isArray(a) !== Array.isArray(b)) return path;
  if (Array.isArray(a) && a.length !== (b as unknown as unknown[]).length) return path;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  // the same reference is unchanged (a change only rebuilds the path to it) - compare only otherwise
  const differing = keys.filter((k) => a[k] !== b[k] && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  if (differing.length !== 1) return path;
  const [k] = differing;
  return diffPath(a[k], b[k], path ? `${path}.${k}` : k);
}

/** The merge key for a change from `before` to `after` - undefined if it
  * changes several locations at once (an import, a change of type): it merges with nothing. */
export function coalesceKey(scope: string, before: unknown, after: unknown): string | undefined {
  const path = diffPath(before, after);
  return path ? `${scope}:${path}` : undefined;
}
