// A mapping of a service in FEEL → a Scala expression for the worker.
//
// What the mappings of a service read is small and typed: the fields of the
// `In`, the `body` of the response and its `headers`. So most mappings are a
// path or a literal, and those translate exactly — with `Option` along the way:
//
//   = clientKey            → in.clientKey
//   = body.address.city    → body.address.flatMap(_.city)     (address optional)
//   = headers.etag         → headers.get("etag")
//   = "CH" · = 3 · = true  → "CH" · 3L (for a Long) · true
//   = "Account"            → ProductType.Account (for an enum field, as the process writes it)
//
// Everything else stays FEEL for a human: `??? /* TODO FEEL: … */` — the project
// compiles and the place is easy to find.
import type { Field, TypeDef } from '../types';

/** A variable a mapping can read — its Scala expression and its shape. */
export interface ScalaVar {
  /** Scala for the variable itself: `in.clientKey`, `body` */
  scala: string;
  /** TypeDef id or ScalaType — for the way into its fields */
  type?: string;
  optional?: boolean;
  collection?: boolean;
  /** the headers: a `Map[String, String]` — `headers.etag` is `headers.get("etag")` */
  headers?: boolean;
}

export interface Translated {
  scala: string;
  /** the result may be missing (`Option[…]`) */
  optional: boolean;
  /** could not be translated — `scala` is a `???` with the FEEL in a comment */
  todo?: boolean;
}

const todo = (expr: string, why = 'FEEL'): Translated =>
  ({ scala: `??? /* TODO ${why}: ${expr.replace(/\*\//g, '* /')} */`, optional: false, todo: true });

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$|^`[^`]+`$/;
const bare = (n: string) => n.replace(/^`|`$/g, '');
/** a field name that is no Scala identifier gets backticks */
const ident = (n: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : `\`${n}\``);

/** Translate the expression (with or without `=`) for a target field. */
export function feelToScala(expression: string, vars: Map<string, ScalaVar>, types: TypeDef[], target?: Pick<Field, 'type' | 'optional' | 'collection'>): Translated {
  const raw = expression.trim();
  const body = raw.startsWith('=') ? raw.slice(1).trim() : raw;
  if (!body) return todo(raw, 'kein Wert');
  // not FEEL: a fixed text
  if (!raw.startsWith('=')) return { scala: JSON.stringify(raw), optional: false };

  const literal = literalOf(body, target, types);
  if (literal) return literal;

  const parts = splitPath(body);
  if (!parts || !parts.every(p => NAME.test(p))) return todo(body);
  const root = vars.get(bare(parts[0]));
  if (!root) return todo(body, `unbekannt «${bare(parts[0])}»`);

  if (root.headers) {
    if (parts.length !== 2) return todo(body);
    return { scala: `${root.scala}.get(${JSON.stringify(bare(parts[1]).toLowerCase())})`, optional: true };
  }

  let scala = root.scala;
  let optional = !!root.optional;
  let shape: { type?: string; collection?: boolean } = root;
  for (const p of parts.slice(1)) {
    const name = bare(p);
    // into a list: not a path any more
    if (shape.collection) return todo(body, 'Pfad in eine Liste');
    const owner = types.find(t => t.id === shape.type);
    // a class — or an ADT: the fields all its cases share (`body.master`)
    const field = (owner?.fields ?? []).find(f => f.name === name);
    if (!field) return todo(body, `«${name}» gibt es nicht`);
    if (optional) {
      scala = `${scala}.${field.optional ? 'flatMap' : 'map'}(_.${ident(name)})`;
    } else {
      scala = `${scala}.${ident(name)}`;
      optional = !!field.optional;
    }
    shape = field;
  }
  return { scala, optional };
}

/** `a.b.c` → the names; null if it is not a plain path */
function splitPath(body: string): string[] | null {
  const out: string[] = [];
  const re = /\s*(`[^`]+`|[A-Za-z_][A-Za-z0-9_]*)\s*(\.|$)/y;
  let at = 0;
  while (at < body.length) {
    re.lastIndex = at;
    const m = re.exec(body);
    if (!m) return null;
    out.push(m[1]);
    at = re.lastIndex;
    if (m[2] === '') break;
  }
  return at >= body.length && out.length ? out : null;
}

function literalOf(body: string, target: Pick<Field, 'type'> | undefined, types: TypeDef[]): Translated | null {
  if (body === 'null') return { scala: 'None', optional: true };
  if (body === 'true' || body === 'false') return { scala: body, optional: false };
  const str = /^"((?:[^"\\]|\\.)*)"$/.exec(body);
  if (str) {
    // a case of an enum: `ProductType.Account` — a name the enum lacks stays to check
    const en = enumOf(target?.type, types);
    if (en) {
      if (en.adt) return todo(body, `${en.name} hat Fälle mit Feldern — ein Text reicht nicht`);
      if (en.cases.includes(str[1])) return { scala: `${en.name}.${ident(str[1])}`, optional: false };
      return todo(body, `«${str[1]}» ist kein Fall von ${en.name}`);
    }
    return { scala: `"${str[1]}"`, optional: false };
  }
  if (/^-?\d+(\.\d+)?$/.test(body)) {
    const t = target?.type;
    if (t === 'Long' && !body.includes('.')) return { scala: `${body}L`, optional: false };
    if (t === 'BigDecimal') return { scala: `BigDecimal(${JSON.stringify(body)})`, optional: false };
    if ((t === 'Double') && !body.includes('.')) return { scala: `${body}.0`, optional: false };
    return { scala: body, optional: false };
  }
  return null;
}

/** The enum a target type is (a type of the collection) — with its cases; an ADT has fields in them. */
function enumOf(type: string | undefined, types: TypeDef[]): { name: string; cases: string[]; adt: boolean } | null {
  const own = type ? types.find(t => t.id === type) : undefined;
  if (own?.kind !== 'enum') return null;
  return { name: own.name, cases: (own.values ?? []).map(v => v.name), adt: (own.values ?? []).some(v => v.fields?.length) };
}

/**
 * The value for a target field: `Some(…)` where an optional field gets a sure
 * value; where a required one gets an optional value the caller decides
 * (`needed`) — in the output mapper it becomes a step that fails with a message.
 */
export function forTarget(t: Translated, targetOptional: boolean): { scala: string; needed?: boolean } {
  if (t.todo) return { scala: t.scala };
  if (targetOptional) return { scala: t.optional ? t.scala : t.scala === 'None' ? 'None' : `Some(${t.scala})` };
  return t.optional ? { scala: t.scala, needed: true } : { scala: t.scala };
}

/** A Scala value as text — for a header or a query value. */
export const asText = (scala: string, type: string | undefined): string =>
  type === 'String' ? scala : `${scala}.toString`;

export { ident as scalaIdent };
