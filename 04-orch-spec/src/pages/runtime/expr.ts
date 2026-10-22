// Paths, templates and conditions of the page specification – without React, so it is testable.

export type State = Record<string, unknown>;
export type Labels = Record<string, Record<string, string>>;

/** `a.b.0.c` from the state – undefined if the path does not exist. */
export function getPath(state: unknown, path: string): unknown {
  return path
    .split('.')
    .filter(Boolean)
    // own fields only - `constructor`, `__proto__` & co. do not exist in the state (for a list
    // also `length`: `slots.length == 0` is intended)
    .reduce<unknown>((o, k) => (o != null && typeof o === 'object' && Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined), state);
}

/** A new state with `value` at `path` – the objects along the way are copied. */
export function setPath(state: State, path: string, value: unknown): State {
  const [head, ...rest] = path.split('.').filter(Boolean);
  if (head === undefined) return state;
  // like getPath: no fields that exist only on the prototype - they would end up in the inputs as own ones
  if (head === '__proto__' || head === 'constructor' || head === 'prototype') return state;
  const current = (state as Record<string, unknown>)[head];
  const next =
    rest.length === 0
      ? value
      : setPath(current != null && typeof current === 'object' ? (current as State) : {}, rest.join('.'), value);
  // a list stays a list (`items.0.name`)
  if (Array.isArray(state)) {
    // only an index - `items.name` on a list changes nothing
    const index = Number(head);
    // at most one entry after the last one - `items.4294967294` would otherwise create a huge list
    if (!Number.isInteger(index) || index < 0 || index > state.length) {
      // a typo in the path (set, bind) would otherwise silently do nothing
      console.warn(`[pages] «${head}» ist kein Index für diese Liste (${state.length} Einträge) - nichts gesetzt`);
      return state;
    }
    const copy = [...state] as unknown[];
    copy[index] = next;
    return copy as unknown as State;
  }
  return { ...state, [head]: next };
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** A LocalDateTime (`2026-10-20T09:00`) – as local time, without time zone. */
function asDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  // a point in time with a zone (Instant, OffsetDateTime): in the browser's time - not the UTC clock time
  if (/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    const instant = new Date(value);
    return Number.isNaN(instant.getTime()) ? null : instant;
  }
  const [d, t = '00:00'] = value.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [h, min] = t.split(':').map(Number);
  const date = new Date(y, m - 1, day, h || 0, min || 0);
  // 2026-13-45 would otherwise be a different day - then the text stays as it is
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === day ? date : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A value for display: `date`, `time`, `datetime`, `day` (Montag, 20. Oktober), `label:<name>`. */
export function format(value: unknown, fmt: string | undefined, labels: Labels = {}): string {
  if (value == null) return '';
  if (fmt?.startsWith('label:')) {
    const key = String(value);
    return labels[fmt.slice(6)]?.[key] ?? key;
  }
  const date = fmt ? asDate(value) : null;
  // only a day (2026-10-20) has no time - do not invent 00:00
  if (date && (fmt === 'time' || fmt === 'datetime') && typeof value === 'string' && !value.includes('T'))
    return fmt === 'time' ? '' : format(value, 'date', labels);
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

/** `Termin am {{start|date}}` – the expressions inserted formatted. */
export function interpolate(text: string, state: unknown, labels: Labels = {}): string {
  return text.replace(EXPR, (_, path: string, fmt?: string) => format(getPath(state, path), fmt, labels));
}

/** The input of an action: templates inserted in objects and lists. `"{{pfad}}"` alone gives
 * the value itself (e.g. an object). Empty fields (undefined, null, "") are dropped in objects – so
 * optional fields are not sent as empty text. In lists every entry stays in its
 * place (an empty one too), otherwise the indices would shift. */
export function resolve(value: unknown, state: unknown, labels: Labels = {}): unknown {
  if (typeof value === 'string') {
    const single = value.match(SINGLE);
    if (single) return compact(getPath(state, single[1]));
    const text = interpolate(value, state, labels);
    return text.trim() === '' ? undefined : text;
  }
  if (Array.isArray(value))
    return value.map((v) => {
      if (typeof v !== 'string') return resolve(v, state, labels) ?? null;
      const single = v.match(SINGLE);
      return single ? entry(getPath(state, single[1])) : interpolate(v, state, labels);
    });
  if (value != null && typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([k, v]) => [k, resolve(v, state, labels)] as const)
      .filter(([, v]) => v !== undefined);
    return Object.fromEntries(entries);
  }
  return value;
}

/** A value from the state without empty fields (as in `resolve`). */
function compact(value: unknown): unknown {
  if (value === null || value === '' || value === undefined) return undefined;
  if (Array.isArray(value)) return value.map(entry);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as State)
        .map(([k, v]) => [k, compact(v)] as const)
        .filter(([, v]) => v !== undefined),
    );
  }
  // only empty (or only whitespace) is dropped - the content stays as it is
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

/** An entry of a list: stays in its place - only in objects inside it empty fields are dropped. */
function entry(value: unknown): unknown {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(entry);
  return value !== null && typeof value === 'object' ? compact(value) : value;
}

/** The value of an action «Wert setzen»: like `resolve`, but a text stays as it is - even empty
 * (`""` or `"{{x}}"` with an empty x clears a field). */
export function resolveValue(value: unknown, state: unknown, labels: Labels = {}): unknown {
  if (typeof value !== 'string') return resolve(value, state, labels);
  const single = value.match(SINGLE);
  return single ? getPath(state, single[1]) : interpolate(value, state, labels);
}

/** Equal - also objects with the fields in a different order (a reloaded list). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  const ka = Object.keys(a as State);
  const kb = Object.keys(b as State);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && sameValue((a as State)[k], (b as State)[k]));
}

/** `pfad`, `!pfad`, `pfad == 'wert'`, `pfad != 'wert'` (also true, false, null, numbers), combined
 * with `&&` and `||` (&& binds more tightly, no parentheses). */
export function evaluate(cond: string | undefined, state: unknown): boolean {
  if (!cond) return true;
  warnOnce(cond); // the whole condition - not every part again
  return holds(cond, state);
}

function holds(cond: string, state: unknown): boolean {
  const or = splitOutsideQuotes(cond, '||');
  if (or.length > 1) return or.some((part) => holds(part, state));
  const and = splitOutsideQuotes(cond, '&&');
  if (and.length > 1) return and.every((part) => holds(part, state));
  const c = cond.trim();
  const op = operatorOutsideQuotes(c);
  if (op) {
    const actual = getPath(state, c.slice(0, op.at).trim());
    const expected = literal(c.slice(op.at + 2).trim());
    const same = equal(actual, expected);
    return op.op === '==' ? same : !same;
  }
  if (c.startsWith('!')) return !truthy(getPath(state, c.slice(1).trim()));
  return truthy(getPath(state, c));
}

// a condition that does not fit is silently false - once per condition in the console (as in the build)
const checked = new Set<string>();
function warnOnce(cond: string) {
  if (checked.has(cond)) return;
  if (checked.size >= 500) checked.clear(); // in the designer a new one comes with every keystroke
  checked.add(cond);
  const problem = conditionProblem(cond);
  if (problem) console.warn(`[pages] sichtbar, wenn «${cond}»: ${problem} - gilt als falsch`);
}

const PATH = /^[A-Za-z_$][\w$]*(\.[\w$]+)*$/;

/** What is wrong with a condition - null if it fits. For the findings in the designer: a
  * condition that does not fit is otherwise simply false and silently hides the building block. */
export function conditionProblem(cond: string | undefined): string | null {
  if (!cond?.trim()) return null;
  // no escape: a ' in the text only works between " (before the open quote: \' would look like this)
  if (/\\['"]/.test(cond)) return `kein \\ in Texten: '…"…' oder "…'…" verwenden`;
  // an open quote would swallow the rest - including an && or || inside it
  if (openQuote(cond)) return `ein Anführungszeichen ist nicht geschlossen`;
  for (const or of splitOutsideQuotes(cond, '||')) {
    for (const raw of splitOutsideQuotes(or, '&&')) {
      const part = raw.trim();
      if (!part) return 'ein leerer Teil zwischen && / ||';
      const op = operatorOutsideQuotes(part);
      if (op) {
        const left = part.slice(0, op.at).trim();
        const right = part.slice(op.at + 2).trim();
        if (!PATH.test(left)) return `«${left}» ist kein Pfad`;
        if (!/^('.*'|".*"|true|false|null|-?\d+(\.\d+)?)$/.test(right)) return `«${right}» – ein Text braucht Anführungszeichen ('${right}')`;
      } else {
        const path = part.startsWith('!') ? part.slice(1).trim() : part;
        if (!PATH.test(path)) return `«${part}» ist weder ein Pfad noch ein Vergleich`;
      }
    }
  }
  return null;
}

/** The first `==` / `!=` outside of quotes. */
function operatorOutsideQuotes(text: string): { op: '==' | '!='; at: number } | null {
  let quote: string | null = null;
  for (let i = 0; i < text.length - 1; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (text.startsWith('==', i) || text.startsWith('!=', i)) return { op: text.slice(i, i + 2) as '==' | '!=', at: i };
  }
  return null;
}

/** Is a quote left open at the end? (counted as splitOutsideQuotes does) */
function openQuote(text: string): boolean {
  let quote: string | null = null;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') quote = ch;
  }
  return quote !== null;
}

/** `a || 'x||y'` → `a`, `'x||y'` - only outside of quotes. */
function splitOutsideQuotes(text: string, op: string): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (text.startsWith(op, i)) {
      parts.push(text.slice(start, i));
      start = i + op.length;
      i += op.length - 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Equal - a number and its text too (`n == '1'` with n = 1), missing like null. */
function equal(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (expected === null) return actual === undefined || actual === null;
  const primitive = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
  return primitive(actual) && primitive(expected) && String(actual) === String(expected);
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

/** The groups of a list by a formatted value – in the order of the list. */
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

/** An error text for an HTTP status – from the texts of the action, otherwise a general one. */
export function errorText(status: number, errors: Record<string, string> | undefined): string {
  return (
    errors?.[String(status)] ??
    errors?.default ??
    (status === 401
      ? 'Bitte neu anmelden.'
      : status === 429
      ? 'Zu viele Anfragen – bitte in einer Minute noch einmal versuchen.'
      : status === 504
      // no response: maybe it happened anyway - do not send again right away
      ? 'Keine Antwort erhalten – ob es geklappt hat, ist offen. Bitte nicht gleich noch einmal senden, sondern etwas später prüfen.'
      : status >= 500
        ? 'Das geht im Moment leider nicht – bitte später noch einmal versuchen.'
        : 'Die Anfrage wurde abgelehnt.')
  );
}

/** Whether an e-mail address looks like one. */
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

/** The input of an action - a public call gets the honeypot field along (only bots
  * fill it in; the gateway then rejects them), a call with login does not. */
export function actionInput(raw: unknown, state: unknown, labels: Labels, isPublic: boolean, honeypot: string): Record<string, unknown> {
  const body = (resolve(raw ?? {}, state, labels) ?? {}) as Record<string, unknown>;
  return isPublic ? { ...body, _hp: honeypot } : body;
}
