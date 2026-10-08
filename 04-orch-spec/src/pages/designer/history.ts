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
  const to = [...(dir === 'undo' ? h.future : h.past), current];
  return {
    value,
    history: dir === 'undo' ? { past: rest, future: to, last: null } : { past: to, future: rest, last: null },
  };
}
