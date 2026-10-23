// Reading Scala type expressions.
//
// From a parameter list like
//
//   case class InAddress(
//       street: String,
//       @description("Text for number, eg. '1856900'")
//       poBoxNo: Option[String],
//       email: Option[String :| ValidEmail],
//       countryKey: String = "CH"
//   )
//
// we get name, full type expression, default and description — and from that
// the type can be split into the parts the class builder keeps:
// **optional** (`Option[…]`), **multiple** (`Seq[…]`), **refinement**
// (`:| …`) and the base type.
//
// Deliberately a character scanner instead of a regex: brackets, strings and
// multi-line annotations cannot be separated reliably otherwise.

import type { DomainType } from './types';

export interface ScalaParam {
  name: string;
  /** full expression, e.g. `Option[Seq[InPerson]]` */
  type: string;
  /** default value, e.g. `None` or `"CH"` */
  default?: string;
  /** Text from `@description(…)` */
  description?: string;
  /** the expression in `@description(…)` if it is not plain text (`clientKeyDescr`) */
  descriptionExpr?: string;
  [key: string]: unknown;
}

const OPEN = '([{';
const CLOSE = ')]}';
/** A char literal at the start: `'"'`, `'('`, `'\''`, `'\u0022'` — neither a string nor a bracket */
export const CHAR_LITERAL = /^'(?:\\u[0-9a-fA-F]{4}|\\.|[^'\\])'/;

/**
 * The end of a name in backticks (`` `Brief (neu)` ``, `` `a:b` ``) that starts at `start` —
 * what is inside is no bracket, comma, `:` or `=`. -1 if none starts there (a backtick
 * name ends on the same line).
 */
export function skipBackticks(text: string, start: number): number {
  if (text[start] !== '`') return -1;
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '`') return i > start + 1 ? i + 1 : -1;
    if (text[i] === '\n') return -1;
  }
  return -1;
}

/**
 * Walk one bracket level, skipping strings along the way.
 * Returns the position after the closing bracket.
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
    const char = ch === "'" ? CHAR_LITERAL.exec(text.slice(i)) : null;
    if (char) {
      i += char[0].length;
      continue;
    }
    const bt = skipBackticks(text, i);
    if (bt > 0) {
      i = bt;
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

/** Split the parameter list at the top-level commas. */
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
    const char = ch === "'" ? CHAR_LITERAL.exec(text.slice(i)) : null;
    if (char) {
      i += char[0].length;
      continue;
    }
    const bt = skipBackticks(text, i);
    if (bt > 0) {
      i = bt;
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
 * Remove comments — there are often some between the fields
 * (`// NNK Master Read`), and they would be read as part of the name.
 * Strings stay untouched.
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
    const char = text[i] === "'" ? CHAR_LITERAL.exec(text.slice(i)) : null;
    if (char) {
      out += char[0];
      i += char[0].length;
      continue;
    }
    const bt = skipBackticks(text, i);
    if (bt > 0) {
      out += text.slice(i, bt);
      i = bt;
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
 * The content of `@description(…)` if it is **not plain text**: a
 * reference (`clientKeyDescr`), a call (`serviceOrProcessMockDescr(…)`)
 * or an `s"…"` with placeholders. The export must write it back as is —
 * as text it would lose the reference.
 */
export function descriptionExpression(raw: string): string | undefined {
  const t = raw.trim();
  if (!t || PLAIN_TEXT.test(t)) return undefined;
  // `s"…"` without `$` is just text too
  if (/^s"/.test(t) && !t.includes('$') && PLAIN_TEXT.test(t.slice(1))) return undefined;
  return t.includes('"""') ? t : t.replace(/\s*\n\s*/g, ' ');
}

/** Split off leading annotations; `@description` is taken along. */
function stripAnnotations(param: string): { rest: string; description?: string; descriptionExpr?: string } {
  let text = param.trim();
  let description: string | undefined;
  let descriptionExpr: string | undefined;
  while (text.startsWith('@')) {
    const isDescr = DESCRIPTION.test(text);
    const paren = text.indexOf('(');
    const nameEnd = text.search(/[\s(]/);
    if (paren < 0 || (nameEnd >= 0 && nameEnd < paren && text.slice(nameEnd, paren).trim())) {
      // annotation without parentheses, e.g. `@deprecated`
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

/** Turn the content of `@description(…)` or `val descr = …` into readable text. */
export function cleanText(raw: string): string {
  let t = raw.trim();
  // `s"…"`, `"""…""".stripMargin`, concatenated parts — strip the bare minimum
  t = t.replace(/\.stripMargin\b.*$/s, '').trim();
  if (t.startsWith('s"') || t.startsWith('f"')) t = t.slice(1);
  if (t.startsWith('"""')) {
    t = t.slice(3, t.endsWith('"""') ? -3 : undefined);
    t = t.split('\n').map(l => l.replace(/^\s*\|?/, '')).join('\n');
  } else if (t.startsWith('"')) {
    // merge concatenated strings
    t = t.split(/"\s*\+\s*s?"/).join('').replace(/^"|"$/g, '');
  }
  return t.replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
}

/**
 * A name as written in Scala — plain (`groupId`) or in backticks (`` `type` ``,
 * a reserved word): without the backticks. `null` if it is no name.
 */
export function scalaIdentifier(raw: string): string | null {
  const text = raw.trim();
  const quoted = /^`([^`]+)`$/.exec(text);
  if (quoted) return quoted[1];
  return /^[A-Za-z_]\w*$/.test(text) ? text : null;
}

/** A parameter: `name: Type = default`. */
export function parseParam(param: string): ScalaParam | null {
  const { rest, description, descriptionExpr } = stripAnnotations(stripComments(param));
  const colon = topLevelIndex(rest, ':');
  if (colon < 0) return null;
  const name = scalaIdentifier(rest.slice(0, colon).trim().replace(/^(?:val|var)\s+/, ''));
  if (!name) return null;
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

/** First occurrence of a character at the top bracket level. */
function topLevelIndex(text: string, ch: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { i = skipString(text, i) - 1; continue; }
    const bt = skipBackticks(text, i);
    if (bt > 0) { i = bt - 1; continue; }
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) depth--;
    else if (c === ch && depth === 0) return i;
  }
  return -1;
}

/** The `=` of the default — not `=>`, `==`, `<=`, `>=`, `!=`. */
function topLevelAssign(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { i = skipString(text, i) - 1; continue; }
    const bt = skipBackticks(text, i);
    if (bt > 0) { i = bt - 1; continue; }
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

/** The whole parameter list of a `case class` header. */
export function parseParams(text: string): ScalaParam[] {
  return splitParams(text).map(parseParam).filter((p): p is ScalaParam => !!p);
}

// ── Decomposing a type expression ────────────────────────────────────────────
export interface TypeShape {
  /** base type without wrappers, e.g. `InPerson` */
  base: string;
  optional: boolean;
  collection: boolean;
  /** `Map[String, T]` — `base` is then the value type */
  map: boolean;
  /** Iron refinement after `:|` */
  constraint?: string;
}

const WRAPPERS_OPTIONAL = ['Option'];
const WRAPPERS_COLLECTION = ['Seq', 'List', 'Set', 'Vector', 'Array', 'Iterable'];

/**
 * `Option[Seq[String :| ValidEmail]]` → base `String`, optional, multiple,
 * refinement `ValidEmail`. Wrappers are stripped in any
 * order; what remains is the base type.
 */
/**
 * The default of a fixed case (`processStatus: ProcessStatus.succeeded.type =
 * ProcessStatus.succeeded`) is the case itself — it follows from the type, the
 * export writes it anyway. So no default of its own.
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
    // the bracket at the end must close the one after the wrapper — `Option[String] | Seq[X]` is not a wrapper
    if (!m || !balanced(m[2])) break;
    const [, wrapper, inner] = m;
    if (WRAPPERS_OPTIONAL.includes(wrapper)) { optional = true; t = inner.trim(); continue; }
    if (WRAPPERS_COLLECTION.includes(wrapper)) { collection = true; t = inner.trim(); continue; }
    // `Map[String, T]` — only with a text key, that is how it arrives in JSON
    const mv = wrapper === 'Map' ? /^String\s*,\s*([\s\S]+)$/.exec(inner.trim()) : null;
    if (mv) { map = true; t = mv[1].trim(); continue; }
    break;
  }

  const refine = topLevelRefine(t);
  if (refine >= 0) {
    constraint = t.slice(refine + 2).trim();
    t = t.slice(0, refine).trim();
    // the wrappers can also be inside the refinement
    const inner = typeShape(t);
    optional = optional || inner.optional;
    collection = collection || inner.collection;
    map = map || inner.map;
    t = inner.base;
  }

  return { base: t, optional, collection, map, ...(constraint ? { constraint } : {}) };
}

/** Brackets balanced, without ever dropping below zero? */
function balanced(text: string): boolean {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { i = skipString(text, i) - 1; continue; }
    const bt = skipBackticks(text, i);
    if (bt > 0) { i = bt - 1; continue; }
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c) && --depth < 0) return false;
  }
  return depth === 0;
}

/**
 * A union or intersection type (`Option[String] | Seq[X]`, `A & B`) at the top
 * level — the app does not represent it (a field has one base type); `:|` (Iron) does not count.
 */
export function isCompoundType(text: string): boolean {
  // `:|` binds tighter than `|` and `&` (Scala: precedence by the first character) — so
  // `String :| ValidUUID | Long` is a union `(String :| ValidUUID) | Long`; several
  // refinements are therefore in parentheses: `Int :| (Greater[0] & Less[10])`
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { i = skipString(text, i) - 1; continue; }
    const bt = skipBackticks(text, i);
    if (bt > 0) { i = bt - 1; continue; }
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) depth--;
    else if (depth === 0 && (c === '&' || (c === '|' && text[i - 1] !== ':'))) return true;
  }
  return false;
}

/** The members of a union type at the top level (`:|` is no `|`) — one member if it is none. */
export function unionMembers(text: string): string[] {
  const members: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { i = skipString(text, i) - 1; continue; }
    // a name in backticks (`a|b`) is one name
    if (c === '`') { const end = text.indexOf('`', i + 1); if (end < 0) break; i = end; continue; }
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) depth--;
    else if (depth === 0 && c === '|' && text[i - 1] !== ':') {
      members.push(text.slice(from, i).trim());
      from = i + 1;
    }
  }
  members.push(text.slice(from).trim());
  return members;
}

/**
 * A union type with a member that can be `None` (`Option[String] | Seq[X]`, `None.type | X`) —
 * a field of that type may be missing although it is no `Option[…]`. A member that names
 * another alias (`type Maybe = Rs | Long`) counts with that alias's target (`resolve`).
 */
export function unionAllowsNone(text: string, resolve: (name: string) => string | undefined = () => undefined): boolean {
  // a function type (`(A | B) => C | Option[D]`) is no union, whatever its result is
  if (isFunctionType(text)) return false;
  const members = unionMembers(text);
  return members.length > 1 && members.some(m => memberAllowsNone(m, resolve, new Set()));
}

/** `=>` at the top bracket level (outside strings) — a function type. */
function isFunctionType(text: string): boolean {
  let depth = 0;
  for (let i = 0; i < text.length - 1; i++) {
    const c = text[i];
    if (c === '"') { i = skipString(text, i) - 1; continue; }
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) depth--;
    else if (depth === 0 && c === '=' && text[i + 1] === '>') return true;
  }
  return false;
}

function memberAllowsNone(m: string, resolve: (name: string) => string | undefined, seen: Set<string>): boolean {
  if (m === 'None.type') return true;
  // `Option[…]` on the outside only — `Seq[Option[X]]` is never None, nor a refined
  // `Option[String] :| C` (`Option[String :| C]` is)
  if (/^Option\s*\[/.test(m)) return topLevelRefine(m) < 0 && typeShape(m).optional;
  // only a plain name is followed — `scala.Option[…]`, a generic alias `Foo[A]` count as no None
  // (the safe direction: at most a `= None` is missing)
  if (!/^[\w.]+$/.test(m) || seen.has(m)) return false;
  const target = resolve(m);
  if (!target) return false;
  seen.add(m);
  return unionMembers(target).some(t => memberAllowsNone(t, resolve, seen));
}

/** Position of `:|` at the top bracket level. */
function topLevelRefine(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length - 1; i++) {
    const c = text[i];
    if (c === '"') { i = skipString(text, i) - 1; continue; }
    const bt = skipBackticks(text, i);
    if (bt > 0) { i = bt - 1; continue; }
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) depth--;
    else if (c === ':' && text[i + 1] === '|' && depth === 0) return i;
  }
  return -1;
}

/**
 * `CustomDocContents.\`QI-Deklaration\`` (ADT case) or `ProcessStatus.canceled.type`
 * (case of a simple enum, singleton type) → enum and case; null if there is no dot in it.
 */
export function splitEnumCase(base: string): { base: string; enumCase: string } | null {
  const m = /^([A-Za-z_][\w.]*?)\.(`[^`]+`|[A-Za-z_]\w*)(\.type)?$/.exec(base.trim());
  if (!m) return null;
  // for the singleton type without backticks — that is how the case appears in `values`
  return { base: m[1], enumCase: m[3] ? m[2].replace(/^`|`$/g, '') : m[2] };
}

/** Does the enum have this case — as an ADT case (`cases`) or as a value (`values`)? */
export function enumHasCase(en: DomainType | null | undefined, c: string): boolean {
  if (en?.kind !== 'enum') return false;
  const bare = c.replace(/^`|`$/g, '');
  return (en.cases ?? []).some(x => x.name === c || x.name === bare) || (en.values ?? []).includes(bare);
}

/**
 * The imports of a file that an expression in `@description(…)` needs: the
 * explicit ones whose name occurs in it (`SendProcessEvent.processName`),
 * and — for free-standing names like `timerStartEscalationDescr` that come from an
 * object — the object wildcards (`…Escalation.*`).
 */
export function importsForExpression(expr: string, imports: string[] | undefined): string[] {
  if (!imports?.length) return [];
  const names = new Set(expr.match(/[A-Za-z_]\w*/g) ?? []);
  const explicit = imports.filter(i => !i.endsWith('.*') && names.has(i.slice(i.lastIndexOf('.') + 1)));
  // a free-standing name (lowercase, not after a dot) — not a field of an object
  const bare = /(^|[^\w.$])[a-z]\w*(?![\w(.])/.test(expr.replace(/"(?:[^"\\]|\\.)*"/g, m => m.replace(/[^${}.\w]/g, ' ')));
  const objectWildcards = bare ? imports.filter(i => /\.[A-Z]\w*\.\*$/.test(i)) : [];
  return [...new Set([...explicit, ...objectWildcards])];
}

// ── Example values ───────────────────────────────────────────────────────────
//
// The companion carries the example data:
//
//   lazy val example = In(
//     clientId = 1000,
//     mainCardHolder = Some(CardHolder.example)
//   )
//
// The class builder keeps the **inner** value per field (`CardHolder.example`);
// the export puts `Some(…)`, `Seq(…)` and `Map("key" -> …)` back around it according to Option,
// Seq and Map of the field (see `exampleValue` in scala.ts).

/**
 * The arguments of a constructor call `X(a = 1, b = "x")` (without the
 * parentheses) by field name; an argument without a name counts by its
 * position. A value spanning several lines becomes one line.
 */
export function exampleArgs(raw: string, fieldNames: string[]): Map<string, string> {
  const out = new Map<string, string>();
  splitParams(raw).forEach((part, i) => {
    const text = part.trim();
    if (!text) return;
    const eq = topLevelAssign(text);
    const named = eq > 0 ? scalaIdentifier(text.slice(0, eq)) : null;
    const name = named ?? fieldNames[i];
    const value = (named !== null ? text.slice(eq + 1) : text).trim();
    if (!name || !value) return;
    out.set(name, value.includes('"""') ? value : value.replace(/\s*\n\s*/g, ' '));
  });
  return out;
}

/** `Some(x)` → `x` — only if the call spans the whole expression and has exactly one argument. */
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
 * The example of a domain field as the class builder keeps it: without
 * `Some(…)` / `Seq(…)` / `Map("key" -> …)` and without `.refineUnsafe` on
 * a literal — the export adds that back. If a wrapper cannot be
 * stripped (`None`, `Seq(a, b)`, `Seq.empty`), the whole expression stays;
 * the export then takes it over literally. Nothing if the example
 * is the same as what the app derives anyway (`CardAccount.example`).
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
