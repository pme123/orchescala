// Pfade, Vorlagen und Bedingungen der Seiten-Spezifikation – ohne React, damit testbar.

export type State = Record<string, unknown>;
export type Labels = Record<string, Record<string, string>>;

/** `a.b.0.c` aus dem Zustand – undefined, wenn es den Pfad nicht gibt. */
export function getPath(state: unknown, path: string): unknown {
  return path
    .split('.')
    .filter(Boolean)
    // nur eigene Felder - `constructor`, `__proto__` & Co. gibt es im Zustand nicht
    .reduce<unknown>((o, k) => (o != null && typeof o === 'object' && Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined), state);
}

/** Ein neuer Zustand mit `value` an `path` – die Objekte auf dem Weg werden kopiert. */
export function setPath(state: State, path: string, value: unknown): State {
  const [head, ...rest] = path.split('.').filter(Boolean);
  if (head === undefined) return state;
  const current = (state as Record<string, unknown>)[head];
  const next =
    rest.length === 0
      ? value
      : setPath(current != null && typeof current === 'object' ? (current as State) : {}, rest.join('.'), value);
  // eine Liste bleibt eine Liste (`items.0.name`)
  if (Array.isArray(state)) {
    // nur ein Index - `items.name` auf einer Liste ändert nichts
    const index = Number(head);
    // höchstens ein Eintrag nach dem letzten - `items.4294967294` legte sonst eine riesige Liste an
    if (!Number.isInteger(index) || index < 0 || index > state.length) {
      // ein Tippfehler im Pfad (set, bind) täte sonst still nichts
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

/** Ein LocalDateTime (`2026-10-20T09:00`) – als lokale Zeit, ohne Zeitzone. */
function asDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  // ein Zeitpunkt mit Zone (Instant, OffsetDateTime): in der Zeit des Browsers - nicht die Uhrzeit von UTC
  if (/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    const instant = new Date(value);
    return Number.isNaN(instant.getTime()) ? null : instant;
  }
  const [d, t = '00:00'] = value.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [h, min] = t.split(':').map(Number);
  const date = new Date(y, m - 1, day, h || 0, min || 0);
  // 2026-13-45 wäre sonst ein anderer Tag - dann bleibt der Text, wie er ist
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === day ? date : null;
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
 * den Wert selbst (z.B. ein Objekt). Leere Felder (undefined, null, "") fallen in Objekten weg – so
 * werden optionale Felder nicht als leerer Text geschickt. In Listen bleibt jeder Eintrag an seinem
 * Platz (auch ein leerer), sonst verschöben sich die Indizes. */
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

/** Ein Wert aus dem Zustand ohne leere Felder (wie in `resolve`). */
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
  // nur leer (oder nur Leerzeichen) fällt weg - der Inhalt bleibt, wie er ist
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

/** Ein Eintrag einer Liste: bleibt an seinem Platz - nur in Objekten darin fallen leere Felder weg. */
function entry(value: unknown): unknown {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(entry);
  return value !== null && typeof value === 'object' ? compact(value) : value;
}

/** Der Wert einer Aktion «Wert setzen»: wie `resolve`, aber ein Text bleibt, wie er ist - auch leer
 * (`""` oder `"{{x}}"` mit leerem x leert ein Feld). */
export function resolveValue(value: unknown, state: unknown, labels: Labels = {}): unknown {
  if (typeof value !== 'string') return resolve(value, state, labels);
  const single = value.match(SINGLE);
  return single ? getPath(state, single[1]) : interpolate(value, state, labels);
}

/** Gleich - auch Objekte mit den Feldern in anderer Reihenfolge (eine neu geladene Liste). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  const ka = Object.keys(a as State);
  const kb = Object.keys(b as State);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && sameValue((a as State)[k], (b as State)[k]));
}

/** `pfad`, `!pfad`, `pfad == 'wert'`, `pfad != 'wert'` (auch true, false, null, Zahlen), verbunden
 * mit `&&` und `||` (&& bindet stärker, keine Klammern). */
export function evaluate(cond: string | undefined, state: unknown): boolean {
  if (!cond) return true;
  warnOnce(cond); // die ganze Bedingung - nicht jeder Teil noch einmal
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

// eine Bedingung, die nicht passt, ist still falsch - einmal je Bedingung in der Konsole (wie im Build)
const checked = new Set<string>();
function warnOnce(cond: string) {
  if (checked.has(cond)) return;
  if (checked.size >= 500) checked.clear(); // im Designer kommt mit jedem Tastendruck eine neue dazu
  checked.add(cond);
  const problem = conditionProblem(cond);
  if (problem) console.warn(`[pages] sichtbar, wenn «${cond}»: ${problem} - gilt als falsch`);
}

const PATH = /^[A-Za-z_$][\w$]*(\.[\w$]+)*$/;

/** Was an einer Bedingung nicht stimmt - null, wenn sie passt. Für die Befunde im Designer: eine
  * Bedingung, die nicht passt, ist sonst einfach falsch und versteckt den Baustein still. */
export function conditionProblem(cond: string | undefined): string | null {
  if (!cond?.trim()) return null;
  // kein Escape: ein ' im Text geht nur zwischen " (vor dem offenen Anführungszeichen: \' sähe so aus)
  if (/\\['"]/.test(cond)) return `kein \\ in Texten: '…"…' oder "…'…" verwenden`;
  // ein offenes Anführungszeichen verschluckte den Rest - auch ein && oder || darin
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

/** Das erste `==` / `!=` ausserhalb von Anführungszeichen. */
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

/** `a || 'x||y'` → `a`, `'x||y'` - nur ausserhalb von Anführungszeichen. */
/** Bleibt am Ende ein Anführungszeichen offen? (wie splitOutsideQuotes zählt) */
function openQuote(text: string): boolean {
  let quote: string | null = null;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') quote = ch;
  }
  return quote !== null;
}

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

/** Gleich - eine Zahl und ihr Text auch (`n == '1'` bei n = 1), fehlend wie null. */
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
    (status === 401
      ? 'Bitte neu anmelden.'
      : status === 429
      ? 'Zu viele Anfragen – bitte in einer Minute noch einmal versuchen.'
      : status >= 500
        ? 'Das geht im Moment leider nicht – bitte später noch einmal versuchen.'
        : 'Die Anfrage wurde abgelehnt.')
  );
}

/** Ob eine E-Mail-Adresse so aussieht. */
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

/** Die Eingabe einer Aktion - ein öffentlicher Aufruf bekommt das Honeypot-Feld mit (nur Bots
  * füllen es aus; der Gateway lehnt sie dann ab), ein Aufruf mit Login nicht. */
export function actionInput(raw: unknown, state: unknown, labels: Labels, isPublic: boolean, honeypot: string): Record<string, unknown> {
  const body = (resolve(raw ?? {}, state, labels) ?? {}) as Record<string, unknown>;
  return isPublic ? { ...body, _hp: honeypot } : body;
}
