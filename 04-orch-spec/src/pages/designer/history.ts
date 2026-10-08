// Rückgängig und wiederholen im Seiten-Designer: die Stände vor und nach dem aktuellen. Tippen in einem Feld
// ist ein Schritt - Änderungen mit demselben Schlüssel innert einer Sekunde fallen zusammen.

export type History<T> = { past: T[]; future: T[]; last: { key: string; at: number } | null };

export const emptyHistory = <T>(): History<T> => ({ past: [], future: [], last: null });

/** So viele Schritte zurück - ältere fallen weg. */
export const HISTORY_LIMIT = 100;
/** Bis zu dieser Pause (ms) ist Tippen mit demselben Schlüssel ein Schritt. */
export const COALESCE_MS = 1000;

/** Eine Änderung weg von `current`: ein neuer Schritt zurück - ausser sie setzt die letzte fort (gleicher
  * Schlüssel, weniger als COALESCE_MS später). Wiederholen gibt es danach nicht mehr. */
export function record<T>(h: History<T>, current: T, coalesce: string | undefined, now: number): History<T> {
  const same = coalesce !== undefined && h.last?.key === coalesce && now - h.last.at < COALESCE_MS;
  return {
    past: same ? h.past : [...h.past.slice(-(HISTORY_LIMIT - 1)), current],
    future: same ? h.future : [],
    last: coalesce === undefined ? null : { key: coalesce, at: now },
  };
}

/** Ein Schritt zurück (undo) oder vor (redo) von `current` - null, wenn es keinen gibt. */
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

/** Wo sich zwei Stände unterscheiden - der Pfad bis dorthin, wo es genau eine Stelle ist ('label',
  * 'options.0.label'); eine Liste anderer Länge oder mehrere Stellen enden beim gemeinsamen Teil
  * ('options'). Für den Schlüssel des Zusammenfassens: Tippen in einem Feld ist ein Schritt, ein anderes
  * Feld (oder eine Option löschen) ein neuer. */
export function diffPath(a: unknown, b: unknown, path = ''): string {
  const isTree = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
  if (!isTree(a) || !isTree(b) || Array.isArray(a) !== Array.isArray(b)) return path;
  if (Array.isArray(a) && a.length !== (b as unknown as unknown[]).length) return path;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const differing = keys.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  if (differing.length !== 1) return path;
  const [k] = differing;
  return diffPath(a[k], b[k], path ? `${path}.${k}` : k);
}

/** Der Schlüssel des Zusammenfassens für eine Änderung von `before` zu `after` - undefined, wenn sie
  * mehrere Stellen auf einmal ändert (ein Import, ein Typwechsel): die fällt mit nichts zusammen. */
export function coalesceKey(scope: string, before: unknown, after: unknown): string | undefined {
  const path = diffPath(before, after);
  return path ? `${scope}:${path}` : undefined;
}
