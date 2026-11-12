// A script task of a service orchestration as a mapping: per field of the result the paths of
// the variables before it - drawn as lines in the panel. Its FEEL is written along (`script`),
// so the variables after it know the result; the Scala export reads the structure itself.
//
//   base existingClient, firstName ← client.firstName, name ← client.name ?? existingClient.name
//   = context merge([existingClient, {firstName: client.firstName, name: if client.name != null then client.name else existingClient.name}])
//   → existingClient.copy(firstName = client.firstName, name = client.name.getOrElse(existingClient.name))
//
// A field of a field of the result is a path too (`master.clientType`): the object is then built
// from its fields - on what a line onto the object itself gives, otherwise on that of the base.
import type { VarNode } from './feel';
import type { FieldLink, FieldMapping } from './types';

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** a key of a FEEL context - quoted where it is no name */
const key = (n: string) => (NAME.test(n) ? n : JSON.stringify(n));

/** The paths of a link that count. */
export const linkPaths = (l: FieldLink): string[] => l.from.map(p => p.trim()).filter(Boolean);

/** The FEEL expression of a link (without `=`) - its expression, a path, or the first one set of several. */
export function linkFeel(l: FieldLink): string | null {
  const expr = l.expression?.trim().replace(/^=\s*/, '');
  if (expr) return expr;
  const from = linkPaths(l);
  if (!from.length) return null;
  return from.slice(0, -1).reduceRight((rest, p) => `if ${p} != null then ${p} else ${rest}`, from[from.length - 1]);
}

/** a value to read a field of - a path as it is, anything else in brackets */
const paren = (v: string) => (/^[A-Za-z_][\w.]*$/.test(v) ? v : `(${v})`);

/** The names directly below `prefix` the links name - in the order they first come. */
function namesBelow(links: FieldLink[], prefix: string): string[] {
  const out: string[] = [];
  for (const l of links) {
    if (!l.field.startsWith(prefix)) continue;
    const n = l.field.slice(prefix.length).split('.')[0];
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/** The entries of a context for the links below `prefix` - `base` what the object there is built on. */
function contextEntries(links: FieldLink[], prefix: string, base: string | null): string[] {
  return namesBelow(links, prefix).flatMap(n => {
    const path = `${prefix}${n}`;
    const whole = links.find(l => l.field === path);
    const wholeFeel = whole ? linkFeel(whole) : null;
    const nested = links.filter(l => l.field.startsWith(`${path}.`));
    if (!nested.length) return wholeFeel ? [`${key(n)}: ${wholeFeel}`] : [];
    // the object built from its fields - on the line onto it, otherwise on the base's
    const on = wholeFeel ? paren(wholeFeel) : base ? `${base}.${n}` : null;
    const inner = `{${contextEntries(nested, `${path}.`, on).join(', ')}}`;
    return [`${key(n)}: ${on ? `context merge([${on}, ${inner}])` : inner}`];
  });
}

/** The FEEL of the whole mapping - what `script` holds. */
export function mappingFeel(m: FieldMapping): string {
  const base = m.base?.trim() || null;
  const entries = contextEntries(m.fields, '', base);
  const context = `{${entries.join(', ')}}`;
  if (base) return entries.length ? `= context merge([${base}, ${context}])` : `= ${base}`;
  return `= ${context}`;
}

/** Are there links onto fields inside this one (`master.clientType` inside `master`)? */
export const hasInner = (m: FieldMapping, field: string): boolean => m.fields.some(l => l.field.startsWith(`${field}.`));

/** The mapping with one link changed - an empty one (no path, no expression) is dropped. */
export function withLink(m: FieldMapping, field: string, patch: Partial<FieldLink> | null): FieldMapping {
  const old = m.fields.find(l => l.field === field) ?? { field, from: [] };
  const next: FieldLink = patch ? { ...old, ...patch } : { field, from: [] };
  const keep = linkPaths(next).length > 0 || !!next.expression?.trim();
  const tidy: FieldLink = { field, from: linkPaths(next), ...(next.expression?.trim() ? { expression: next.expression } : {}) };
  const rest = m.fields.filter(l => l.field !== field);
  const at = m.fields.findIndex(l => l.field === field);
  if (!keep) return { ...m, fields: rest };
  if (at < 0) return { ...m, fields: [...m.fields, tidy] };
  return { ...m, fields: m.fields.map(l => (l.field === field ? tidy : l)) };
}

/** A path drawn onto a field: added to its paths (a second one is the fallback, `??`) - again: no change. */
export function linked(m: FieldMapping, field: string, path: string): FieldMapping {
  const l = m.fields.find(x => x.field === field);
  if (l && linkPaths(l).includes(path)) return m;
  return withLink(m, field, { from: [...(l ? linkPaths(l) : []), path], expression: undefined });
}

/** The node a path names among the variables - `client.address.city`; not into a list. */
export function resolvePath(vars: VarNode[], path: string): VarNode | null {
  const [root, ...rest] = path.split('.');
  let node = vars.find(v => v.name === root) ?? null;
  for (const p of rest) {
    if (!node || node.type === 'list') return null;
    node = (node.children ?? []).find(c => c.name === p) ?? null;
  }
  return node;
}

/** The type of a node without `Option[…]` - what a line connects. */
export const plainType = (n: VarNode): string => n.label.replace(/^Option\[(.*)\]$/, '$1');

/**
 * The fields still without a value got one of the same name: a variable of that name, or a field
 * of that name of a variable - the base last (its fields are kept anyway).
 */
export function autoMapped(m: FieldMapping, target: VarNode, sources: VarNode[]): FieldMapping {
  let next = m;
  const order = [...sources.filter(s => s.name !== m.base), ...sources.filter(s => s.name === m.base)];
  for (const f of target.children ?? []) {
    if (next.fields.some(l => l.field === f.name)) continue;
    const fits = (n: VarNode) => n.name === f.name && plainType(n) === plainType(f);
    const direct = order.find(s => s.name !== m.base && fits(s));
    const inner = direct ? null : order.find(s => s.type !== 'list' && (s.children ?? []).some(fits));
    // a field of the base needs no line - it is kept
    if (!direct && (!inner || inner.name === m.base)) continue;
    next = linked(next, f.name, direct ? direct.name : `${inner!.name}.${f.name}`);
  }
  return next;
}

export interface MappingIssue { level: 'error' | 'warn'; text: string; field?: string }

/** What is wrong with a mapping against the result's type and the variables before it. */
export function mappingIssues(m: FieldMapping, target: VarNode | null, sources: VarNode[]): MappingIssue[] {
  if (!target || target.type !== 'context' || !target.children?.length) {
    return [{ level: 'error', text: 'Das Ergebnis braucht als Typ eine Klasse mit Feldern - erst dann lässt es sich zuordnen.' }];
  }
  const out: MappingIssue[] = [];
  const base = m.base?.trim();
  const baseNode = base ? sources.find(s => s.name === base) : undefined;
  if (base && !baseNode) out.push({ level: 'error', text: `Basis «${base}» ist vor dem Schritt nicht bekannt.` });
  else if (baseNode && plainType(baseNode) !== plainType(target)) out.push({ level: 'error', text: `Basis «${base}» ist ${plainType(baseNode)} - das Ergebnis ${plainType(target)}.` });
  const fields = target.children ?? [];
  for (const l of m.fields) {
    const f = resolvePath(fields, l.field);
    if (!f) { out.push({ level: 'warn', text: `«${l.field}» gibt es im Ergebnis nicht (mehr).`, field: l.field }); continue; }
    if (l.expression?.trim()) continue;
    for (const p of linkPaths(l)) {
      const n = resolvePath(sources, p);
      if (!n) out.push({ level: 'error', text: `«${l.field}»: ${p} ist vor dem Schritt nicht bekannt.`, field: l.field });
      else if (n.type !== 'any' && f.type !== 'any' && plainType(n) !== plainType(f)) out.push({ level: 'warn', text: `«${l.field}»: ${p} ist ${plainType(n)}, das Feld ${plainType(f)}.`, field: l.field });
    }
  }
  // the fields without a value: of the result without a base, of an object built from its fields
  // without a line onto it (and without a base)
  const required = (nodes: VarNode[], prefix: string, built: boolean) => {
    for (const f of nodes) {
      const path = `${prefix}${f.name}`;
      const whole = m.fields.some(l => l.field === path);
      if (hasInner(m, path)) required(f.children ?? [], `${path}.`, built || whole);
      else if (!built && !whole && !f.optional && f.type !== 'list') {
        out.push({ level: 'error', text: `«${path}» bekommt keinen Wert - eine Linie ziehen oder eine Basis wählen.`, field: path });
      }
    }
  };
  required(fields, '', !!baseNode);
  return out;
}
