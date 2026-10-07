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

import type { DomainType } from './types';

export interface ScalaParam {
  name: string;
  /** voller Ausdruck, z. B. `Option[Seq[InPerson]]` */
  type: string;
  /** Vorgabewert, z. B. `None` oder `"CH"` */
  default?: string;
  /** Text aus `@description(…)` */
  description?: string;
  /** der Ausdruck in `@description(…)`, wenn er kein reiner Text ist (`clientKeyDescr`) */
  descriptionExpr?: string;
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

const STRING_LITERAL = String.raw`(?:"""[\s\S]*?"""(?:\.stripMargin)?|"(?:[^"\\\n]|\\.)*")`;
const PLAIN_TEXT = new RegExp(String.raw`^${STRING_LITERAL}(?:\s*\+\s*${STRING_LITERAL})*$`);

/**
 * Der Inhalt von `@description(…)`, wenn er **kein reiner Text** ist: eine
 * Referenz (`clientKeyDescr`), ein Aufruf (`serviceOrProcessMockDescr(…)`)
 * oder ein `s"…"` mit Platzhaltern. Der Export muss ihn so zurückschreiben —
 * als Text verlöre er die Referenz.
 */
export function descriptionExpression(raw: string): string | undefined {
  const t = raw.trim();
  if (!t || PLAIN_TEXT.test(t)) return undefined;
  // `s"…"` ohne `$` ist auch nur Text
  if (/^s"/.test(t) && !t.includes('$') && PLAIN_TEXT.test(t.slice(1))) return undefined;
  return t.includes('"""') ? t : t.replace(/\s*\n\s*/g, ' ');
}

/** Führende Annotationen abtrennen; `@description` wird dabei mitgenommen. */
function stripAnnotations(param: string): { rest: string; description?: string; descriptionExpr?: string } {
  let text = param.trim();
  let description: string | undefined;
  let descriptionExpr: string | undefined;
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
    if (isDescr) {
      description = cleanText(text.slice(paren + 1, end - 1));
      descriptionExpr = descriptionExpression(text.slice(paren + 1, end - 1));
    }
    text = text.slice(end).trim();
  }
  return { rest: text, description, descriptionExpr };
}

/** Aus dem Inhalt von `@description(…)` bzw. `val descr = …` einen lesbaren Text machen. */
export function cleanText(raw: string): string {
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
  const { rest, description, descriptionExpr } = stripAnnotations(stripComments(param));
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
    ...(descriptionExpr ? { descriptionExpr } : {}),
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
  /** `Map[String, T]` — `base` ist dann der Werttyp */
  map: boolean;
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
/**
 * Die Vorgabe eines festen Falls (`processStatus: ProcessStatus.succeeded.type =
 * ProcessStatus.succeeded`) ist der Fall selbst — sie folgt aus dem Typ, der
 * Export schreibt sie ohnehin. Keine eigene Vorgabe also.
 */
export function isFixedCaseDefault(enumCase: string | undefined, value: string | undefined): boolean {
  if (!enumCase || !value?.trim()) return false;
  const v = value.trim().replace(/`/g, '');
  return v === enumCase || v.endsWith(`.${enumCase.replace(/`/g, '')}`);
}

export function typeShape(expr: string): TypeShape {
  let t = expr.trim();
  let optional = false;
  let collection = false;
  let map = false;
  let constraint: string | undefined;

  for (let guard = 0; guard < 6; guard++) {
    const m = /^([A-Za-z_]\w*)\s*\[([\s\S]*)\]$/.exec(t);
    if (!m) break;
    const [, wrapper, inner] = m;
    if (WRAPPERS_OPTIONAL.includes(wrapper)) { optional = true; t = inner.trim(); continue; }
    if (WRAPPERS_COLLECTION.includes(wrapper)) { collection = true; t = inner.trim(); continue; }
    // `Map[String, T]` — nur mit Text-Schlüssel, so kommt es im JSON an
    const mv = wrapper === 'Map' ? /^String\s*,\s*([\s\S]+)$/.exec(inner.trim()) : null;
    if (mv) { map = true; t = mv[1].trim(); continue; }
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
    map = map || inner.map;
    t = inner.base;
  }

  return { base: t, optional, collection, map, ...(constraint ? { constraint } : {}) };
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

/**
 * `CustomDocContents.\`QI-Deklaration\`` (ADT-Fall) bzw. `ProcessStatus.canceled.type`
 * (Fall eines einfachen enums, Singleton-Typ) → enum und Fall; null, wenn kein Punkt darin ist.
 */
export function splitEnumCase(base: string): { base: string; enumCase: string } | null {
  const m = /^([A-Za-z_][\w.]*?)\.(`[^`]+`|[A-Za-z_]\w*)(\.type)?$/.exec(base.trim());
  if (!m) return null;
  // beim Singleton-Typ ohne Backticks — so steht der Fall in `values`
  return { base: m[1], enumCase: m[3] ? m[2].replace(/^`|`$/g, '') : m[2] };
}

/** Hat das enum diesen Fall — als ADT-Fall (`cases`) oder als Wert (`values`)? */
export function enumHasCase(en: DomainType | null | undefined, c: string): boolean {
  if (en?.kind !== 'enum') return false;
  const bare = c.replace(/^`|`$/g, '');
  return (en.cases ?? []).some(x => x.name === c || x.name === bare) || (en.values ?? []).includes(bare);
}

/**
 * Die Imports einer Datei, die ein Ausdruck in `@description(…)` braucht: die
 * ausdrücklichen, deren Name darin vorkommt (`SendProcessEvent.processName`),
 * und — für frei stehende Namen wie `timerStartEscalationDescr`, die aus einem
 * Objekt kommen — die Objekt-Wildcards (`…Escalation.*`).
 */
export function importsForExpression(expr: string, imports: string[] | undefined): string[] {
  if (!imports?.length) return [];
  const names = new Set(expr.match(/[A-Za-z_]\w*/g) ?? []);
  const explicit = imports.filter(i => !i.endsWith('.*') && names.has(i.slice(i.lastIndexOf('.') + 1)));
  // ein frei stehender Name (klein, nicht nach einem Punkt) — kein Feld eines Objekts
  const bare = /(^|[^\w.$])[a-z]\w*(?![\w(.])/.test(expr.replace(/"(?:[^"\\]|\\.)*"/g, m => m.replace(/[^${}.\w]/g, ' ')));
  const objectWildcards = bare ? imports.filter(i => /\.[A-Z]\w*\.\*$/.test(i)) : [];
  return [...new Set([...explicit, ...objectWildcards])];
}

// ── Beispielwerte ────────────────────────────────────────────────────────────
//
// Das Companion trägt die Beispieldaten:
//
//   lazy val example = In(
//     clientId = 1000,
//     mainCardHolder = Some(CardHolder.example)
//   )
//
// Der Klassenbauer führt je Feld den **inneren** Wert (`CardHolder.example`);
// `Some(…)`, `Seq(…)` und `Map("key" -> …)` setzt der Export nach Option,
// Seq und Map des Feldes wieder darum (siehe `exampleValue` in scala.ts).

/**
 * Die Argumente eines Konstruktor-Aufrufs `X(a = 1, b = "x")` (ohne die
 * Klammern) nach Feldnamen; ein Argument ohne Namen gilt nach seiner
 * Position. Ein Wert über mehrere Zeilen wird zu einer Zeile.
 */
export function exampleArgs(raw: string, fieldNames: string[]): Map<string, string> {
  const out = new Map<string, string>();
  splitParams(raw).forEach((part, i) => {
    const text = part.trim();
    if (!text) return;
    const eq = topLevelAssign(text);
    const named = eq > 0 && /^[A-Za-z_]\w*$/.test(text.slice(0, eq).trim());
    const name = named ? text.slice(0, eq).trim() : fieldNames[i];
    const value = (named ? text.slice(eq + 1) : text).trim();
    if (!name || !value) return;
    out.set(name, value.includes('"""') ? value : value.replace(/\s*\n\s*/g, ' '));
  });
  return out;
}

/** `Some(x)` → `x` — nur, wenn der Aufruf den ganzen Ausdruck umfasst und genau ein Argument hat. */
function unwrapCall(expr: string, names: string[]): string | null {
  const m = /^([A-Za-z_]\w*)\s*\(/.exec(expr);
  if (!m || !names.includes(m[1])) return null;
  const open = m[0].length - 1;
  if (skipBalanced(expr, open) !== expr.length) return null;
  const args = splitParams(expr.slice(open + 1, -1));
  return args.length === 1 ? args[0].trim() : null;
}

const LITERAL = /^(".*"|-?\d+(\.\d+)?L?)$/s;

/**
 * Das Beispiel eines Domain-Feldes, wie es der Klassenbauer führt: ohne
 * `Some(…)` / `Seq(…)` / `Map("key" -> …)` und ohne `.refineUnsafe` an
 * einem Literal — das setzt der Export wieder. Lässt sich eine Hülle nicht
 * abtragen (`None`, `Seq(a, b)`, `Seq.empty`), bleibt der ganze Ausdruck;
 * der Export übernimmt ihn dann wörtlich. Nichts, wenn das Beispiel
 * dasselbe ist, was die App ohnehin ableitet (`CardAccount.example`).
 */
export function exampleOf(p: { type: string; example?: string }): string | undefined {
  const full = p.example?.trim();
  if (!full) return undefined;
  const shape = typeShape(p.type);
  let e: string | null = full;
  if (shape.optional) e = unwrapCall(e, ['Some']);
  if (e != null && shape.collection) e = unwrapCall(e, ['Seq', 'List', 'Vector', 'Set']);
  if (e != null && shape.map) {
    const kv = unwrapCall(e, ['Map']);
    const m = kv ? /^"key"\s*->\s*([\s\S]+)$/.exec(kv) : null;
    e = m ? m[1].trim() : null;
  }
  if (e == null) return full;
  if (shape.constraint) {
    const lit = e.replace(/\.refineUnsafe$/, '');
    if (LITERAL.test(lit)) e = lit;
  }
  return e === `${shape.base}.example` ? undefined : e;
}
