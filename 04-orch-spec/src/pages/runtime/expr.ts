// Pfade, Vorlagen und Bedingungen der Seiten-Spezifikation – ohne React, damit testbar.

export type State = Record<string, unknown>;
export type Labels = Record<string, Record<string, string>>;

/** `a.b.0.c` aus dem Zustand – undefined, wenn es den Pfad nicht gibt. */
export function getPath(state: unknown, path: string): unknown {
  return path
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((o, k) => (o != null && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), state);
}

/** Ein neuer Zustand mit `value` an `path` – die Objekte auf dem Weg werden kopiert. */
export function setPath(state: State, path: string, value: unknown): State {
  const [head, ...rest] = path.split('.').filter(Boolean);
  if (head === undefined) return state;
  const current = state[head];
  const next =
    rest.length === 0
      ? value
      : setPath(current != null && typeof current === 'object' ? (current as State) : {}, rest.join('.'), value);
  return { ...state, [head]: next };
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** Ein LocalDateTime (`2026-10-20T09:00`) – als lokale Zeit, ohne Zeitzone. */
function asDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const [d, t = '00:00'] = value.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [h, min] = t.split(':').map(Number);
  return new Date(y, m - 1, day, h || 0, min || 0);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Ein Wert für die Anzeige: `date`, `time`, `datetime`, `day` (Montag, 20. Oktober), `label:<name>`. */
export function format(value: unknown, fmt: string | undefined, labels: Labels = {}): string {
  if (value == null) return '';
  if (fmt?.startsWith('label:')) {
    const key = String(value);
    return labels[fmt.slice(6)]?.[key] ?? key;
  }
  const date = fmt ? asDate(value) : null;
  if (date) {
    const day = `${WEEKDAYS[date.getDay()]} ${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    switch (fmt) {
      case 'date':
        return day;
      case 'time':
        return time;
      case 'datetime':
        return `${day}, ${time}`;
      case 'day':
        return date.toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long' });
    }
  }
  if (typeof value === 'boolean') return value ? 'ja' : 'nein';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

const EXPR = /\{\{\s*([^}|]+?)\s*(?:\|\s*([^}]+?)\s*)?\}\}/g;
const SINGLE = /^\{\{\s*([^}|]+?)\s*\}\}$/;

/** `Termin am {{start|date}}` – die Ausdrücke formatiert eingesetzt. */
export function interpolate(text: string, state: unknown, labels: Labels = {}): string {
  return text.replace(EXPR, (_, path: string, fmt?: string) => format(getPath(state, path), fmt, labels));
}

/** Die Eingabe einer Aktion: Vorlagen in Objekten und Listen eingesetzt. `"{{pfad}}"` allein gibt
 * den Wert selbst (z.B. ein Objekt). Leere Werte (undefined, null, "") fallen weg – so werden
 * optionale Felder nicht als leerer Text geschickt. */
export function resolve(value: unknown, state: unknown, labels: Labels = {}): unknown {
  if (typeof value === 'string') {
    const single = value.match(SINGLE);
    if (single) return compact(getPath(state, single[1]));
    const text = interpolate(value, state, labels);
    return text === '' ? undefined : text;
  }
  if (Array.isArray(value)) return value.map((v) => resolve(v, state, labels)).filter((v) => v !== undefined);
  if (value != null && typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([k, v]) => [k, resolve(v, state, labels)] as const)
      .filter(([, v]) => v !== undefined);
    return Object.fromEntries(entries);
  }
  return value;
}

/** Ein Wert aus dem Zustand ohne leere Felder (wie in `resolve`). */
function compact(value: unknown): unknown {
  if (value === null || value === '' || value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as State)
        .map(([k, v]) => [k, compact(v)] as const)
        .filter(([, v]) => v !== undefined),
    );
  }
  return typeof value === 'string' ? value.trim() || undefined : value;
}

/** `pfad`, `!pfad`, `pfad == 'wert'`, `pfad != 'wert'` (auch true, false, null, Zahlen), verbunden
 * mit `&&` und `||` (&& bindet stärker, keine Klammern). */
export function evaluate(cond: string | undefined, state: unknown): boolean {
  if (!cond) return true;
  if (cond.includes('||')) return cond.split('||').some((part) => evaluate(part, state));
  if (cond.includes('&&')) return cond.split('&&').every((part) => evaluate(part, state));
  const c = cond.trim();
  const m = c.match(/^(.+?)\s*(==|!=)\s*(.+)$/);
  if (m) {
    const actual = getPath(state, m[1].trim());
    const expected = literal(m[3].trim());
    const same = actual === expected || (expected === null && actual === undefined);
    return m[2] === '==' ? same : !same;
  }
  if (c.startsWith('!')) return !truthy(getPath(state, c.slice(1).trim()));
  return truthy(getPath(state, c));
}

function literal(text: string): unknown {
  if (/^'.*'$/.test(text) || /^".*"$/.test(text)) return text.slice(1, -1);
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '';
}

/** Die Gruppen einer Liste nach einem formatierten Wert – in der Reihenfolge der Liste. */
export function groupBy<T>(items: T[], key: (item: T) => string): { key: string; items: T[] }[] {
  const groups: { key: string; items: T[] }[] = [];
  for (const item of items) {
    const k = key(item);
    const last = groups[groups.length - 1];
    if (last && last.key === k) last.items.push(item);
    else groups.push({ key: k, items: [item] });
  }
  return groups;
}

/** Ein Fehlertext für einen HTTP-Status – aus den Texten der Aktion, sonst ein allgemeiner. */
export function errorText(status: number, errors: Record<string, string> | undefined): string {
  return (
    errors?.[String(status)] ??
    errors?.default ??
    (status === 429
      ? 'Zu viele Anfragen – bitte in einer Minute noch einmal versuchen.'
      : status >= 500
        ? 'Das geht im Moment leider nicht – bitte später noch einmal versuchen.'
        : 'Die Anfrage wurde abgelehnt.')
  );
}

/** Ob eine E-Mail-Adresse so aussieht. */
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
