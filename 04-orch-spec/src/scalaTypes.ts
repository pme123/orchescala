// Scala-Typausdrücke lesen.
//
// Aus einer Parameterliste wie
//
//   case class InAddress(
//       street: String,
//       @description("Text for number, eg. '1856900'")
//       poBoxNo: Option[String],
//       email: Option[String :| ValidEmail],
//       countryKey: String = "CH"
//   )
//
// werden Name, voller Typausdruck, Vorgabe und Beschreibung — und daraus
// lässt sich der Typ in die Bestandteile zerlegen, die der Klassenbauer führt:
// **optional** (`Option[…]`), **mehrfach** (`Seq[…]`), **Einschränkung**
// (`:| …`) und der Grundtyp.
//
// Bewusst ein Zeichen-Scanner statt eines Regex: Klammern, Zeichenketten und
// mehrzeilige Annotationen lassen sich anders nicht sicher trennen.

export interface ScalaParam {
  name: string;
  /** voller Ausdruck, z. B. `Option[Seq[InPerson]]` */
  type: string;
  /** Vorgabewert, z. B. `None` oder `"CH"` */
  default?: string;
  /** Text aus `@description(…)` */
  description?: string;
  [key: string]: unknown;
}

const OPEN = '([{';
const CLOSE = ')]}';

/**
 * Eine Klammerebene abschreiten und dabei Zeichenketten überspringen.
 * Liefert die Position hinter der schliessenden Klammer.
 */
function skipBalanced(text: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (text.startsWith('"""', i)) {
      const end = text.indexOf('"""', i + 3);
      i = end < 0 ? text.length : end + 3;
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < text.length && !(text[i] === '"' && text[i - 1] !== '\\')) i++;
      i++;
      continue;
    }
    if (OPEN.includes(ch)) depth++;
    else if (CLOSE.includes(ch)) {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return i;
}

/** Die Parameterliste an den Kommas der obersten Ebene zerlegen. */
export function splitParams(raw: string): string[] {
  const text = stripComments(raw);
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (text.startsWith('"""', i)) {
      const end = text.indexOf('"""', i + 3);
      i = end < 0 ? text.length : end + 3;
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < text.length && !(text[i] === '"' && text[i - 1] !== '\\')) i++;
      i++;
      continue;
    }
    if (OPEN.includes(ch)) depth++;
    else if (CLOSE.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  const rest = text.slice(start);
  if (rest.trim()) out.push(rest);
  return out;
}

/**
 * Kommentare entfernen — zwischen den Feldern stehen oft welche
 * (`// NNK Master Read`), und die würden als Teil des Namens gelesen.
 * Zeichenketten bleiben unangetastet.
 */
export function stripComments(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('"""', i)) {
      const end = text.indexOf('"""', i + 3);
      const stop = end < 0 ? text.length : end + 3;
      out += text.slice(i, stop);
      i = stop;
      continue;
    }
    if (text[i] === '"') {
      const stop = skipString(text, i);
      out += text.slice(i, stop);
      i = stop;
      continue;
    }
    if (text.startsWith('//', i)) {
      const nl = text.indexOf('\n', i);
      i = nl < 0 ? text.length : nl;
      continue;
    }
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}

const DESCRIPTION = /^@description\s*\(/;

/** Führende Annotationen abtrennen; `@description` wird dabei mitgenommen. */
function stripAnnotations(param: string): { rest: string; description?: string } {
  let text = param.trim();
  let description: string | undefined;
  while (text.startsWith('@')) {
    const isDescr = DESCRIPTION.test(text);
    const paren = text.indexOf('(');
    const nameEnd = text.search(/[\s(]/);
    if (paren < 0 || (nameEnd >= 0 && nameEnd < paren && text.slice(nameEnd, paren).trim())) {
      // Annotation ohne Klammern, z. B. `@deprecated`
      text = text.slice(nameEnd < 0 ? text.length : nameEnd).trim();
      continue;
    }
    const end = skipBalanced(text, paren);
    if (isDescr) description = cleanText(text.slice(paren + 1, end - 1));
    text = text.slice(end).trim();
  }
  return { rest: text, description };
}

/** Aus dem Inhalt von `@description(…)` einen lesbaren Text machen. */
function cleanText(raw: string): string {
  let t = raw.trim();
  // `s"…"`, `"""…""".stripMargin`, verkettete Teile — das Nötigste abtragen
  t = t.replace(/\.stripMargin\b.*$/s, '').trim();
  if (t.startsWith('s"') || t.startsWith('f"')) t = t.slice(1);
  if (t.startsWith('"""')) {
    t = t.slice(3, t.endsWith('"""') ? -3 : undefined);
    t = t.split('\n').map(l => l.replace(/^\s*\|?/, '')).join('\n');
  } else if (t.startsWith('"')) {
    // aneinandergehängte Zeichenketten zusammenziehen
    t = t.split(/"\s*\+\s*s?"/).join('').replace(/^"|"$/g, '');
  }
  return t.replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
}

/** Ein Parameter: `name: Type = default`. */
export function parseParam(param: string): ScalaParam | null {
  const { rest, description } = stripAnnotations(stripComments(param));
  const colon = topLevelIndex(rest, ':');
  if (colon < 0) return null;
  const name = rest.slice(0, colon).trim().replace(/^(?:val|var)\s+/, '');
  if (!/^[A-Za-z_]\w*$/.test(name)) return null;
  const after = rest.slice(colon + 1);
  const eq = topLevelAssign(after);
  const type = (eq < 0 ? after : after.slice(0, eq)).trim();
  const def = eq < 0 ? undefined : after.slice(eq + 1).trim();
  if (!type) return null;
  return {
    name,
    type: type.replace(/\s+/g, ' '),
    ...(def ? { default: def.replace(/\s+/g, ' ') } : {}),
    ...(description ? { description } : {}),
  };
}

/** Erstes Vorkommen eines Zeichens auf oberster Klammerebene. */
function topLevelIndex(text: string, ch: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { i = skipString(text, i) - 1; continue; }
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) depth--;
    else if (c === ch && depth === 0) return i;
  }
  return -1;
}

/** Das `=` der Vorgabe — nicht `=>`, `==`, `<=`, `>=`, `!=`. */
function topLevelAssign(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { i = skipString(text, i) - 1; continue; }
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) depth--;
    else if (c === '=' && depth === 0) {
      if (text[i + 1] === '=' || text[i + 1] === '>') { i++; continue; }
      if ('<>!='.includes(text[i - 1] ?? '')) continue;
      return i;
    }
  }
  return -1;
}

function skipString(text: string, start: number): number {
  if (text.startsWith('"""', start)) {
    const end = text.indexOf('"""', start + 3);
    return end < 0 ? text.length : end + 3;
  }
  let i = start + 1;
  while (i < text.length && !(text[i] === '"' && text[i - 1] !== '\\')) i++;
  return i + 1;
}

/** Die ganze Parameterliste eines `case class`-Kopfes. */
export function parseParams(text: string): ScalaParam[] {
  return splitParams(text).map(parseParam).filter((p): p is ScalaParam => !!p);
}

// ── Zerlegung eines Typausdrucks ─────────────────────────────────────────────
export interface TypeShape {
  /** Grundtyp ohne Hüllen, z. B. `InPerson` */
  base: string;
  optional: boolean;
  collection: boolean;
  /** Iron-Refinement hinter `:|` */
  constraint?: string;
}

const WRAPPERS_OPTIONAL = ['Option'];
const WRAPPERS_COLLECTION = ['Seq', 'List', 'Set', 'Vector', 'Array', 'Iterable'];

/**
 * `Option[Seq[String :| ValidEmail]]` → base `String`, optional, mehrfach,
 * Einschränkung `ValidEmail`. Hüllen werden in beliebiger Reihenfolge
 * abgetragen; was übrig bleibt, ist der Grundtyp.
 */
export function typeShape(expr: string): TypeShape {
  let t = expr.trim();
  let optional = false;
  let collection = false;
  let constraint: string | undefined;

  for (let guard = 0; guard < 6; guard++) {
    const m = /^([A-Za-z_]\w*)\s*\[([\s\S]*)\]$/.exec(t);
    if (!m) break;
    const [, wrapper, inner] = m;
    if (WRAPPERS_OPTIONAL.includes(wrapper)) { optional = true; t = inner.trim(); continue; }
    if (WRAPPERS_COLLECTION.includes(wrapper)) { collection = true; t = inner.trim(); continue; }
    break;
  }

  const refine = topLevelRefine(t);
  if (refine >= 0) {
    constraint = t.slice(refine + 2).trim();
    t = t.slice(0, refine).trim();
    // die Hüllen können auch innerhalb des Refinements stehen
    const inner = typeShape(t);
    optional = optional || inner.optional;
    collection = collection || inner.collection;
    t = inner.base;
  }

  return { base: t, optional, collection, ...(constraint ? { constraint } : {}) };
}

/** Position von `:|` auf oberster Klammerebene. */
function topLevelRefine(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length - 1; i++) {
    const c = text[i];
    if (c === '"') { i = skipString(text, i) - 1; continue; }
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) depth--;
    else if (c === ':' && text[i + 1] === '|' && depth === 0) return i;
  }
  return -1;
}
