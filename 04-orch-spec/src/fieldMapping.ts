// A script task of a service orchestration as a mapping: its In (the variables it reads), its
// Out (the variables it sets) - and per field of the Out the paths in the In it comes from,
// drawn as lines in the panel. Its FEEL is written along (`script`); the Scala export reads the
// structure itself.
//
//   In existingClient: Client, client: Client - Out newClient: Client
//   newClient ← existingClient, newClient.firstName ← client.firstName
//   = {newClient: context merge([existingClient, {firstName: client.firstName}])}
//   → existingClient.copy(firstName = client.firstName)
//
// A line onto an object of the Out is what its fields with lines of their own are set on (a
// copy of it); without one the object is built from its fields.
import type { VarNode } from './feel';
import type { Field, FieldLink, FieldMapping } from './types';

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** a key of a FEEL context - quoted where it is no name */
const key = (n: string) => (NAME.test(n) ? n : JSON.stringify(n));

/** An empty mapping - nothing read, nothing set. */
export const emptyMapping = (): FieldMapping => ({ in: [], out: [], fields: [] });

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

/** The entries of a context for the links below `prefix` - `on` what the object there is set on. */
function contextEntries(links: FieldLink[], prefix: string, on: string | null): string[] {
  return namesBelow(links, prefix).flatMap(n => {
    const path = `${prefix}${n}`;
    const whole = links.find(l => l.field === path);
    const wholeFeel = whole ? linkFeel(whole) : null;
    const nested = links.filter(l => l.field.startsWith(`${path}.`));
    if (!nested.length) return wholeFeel ? [`${key(n)}: ${wholeFeel}`] : [];
    // the object built from its fields - on the line onto it, otherwise on what it is part of
    const base = wholeFeel ? paren(wholeFeel) : on ? `${on}.${n}` : null;
    const inner = `{${contextEntries(nested, `${path}.`, base).join(', ')}}`;
    return [`${key(n)}: ${base ? `context merge([${base}, ${inner}])` : inner}`];
  });
}

/** The FEEL of the whole mapping - what `script` holds: a context, an entry per variable of the Out. */
export function mappingFeel(m: FieldMapping): string {
  return `= {${contextEntries(m.fields, '', null).join(', ')}}`;
}

/** The FEEL of one variable of the Out (without `=`) - what a script of its own would be. */
export function varFeel(m: FieldMapping, name: string): string | null {
  const entry = contextEntries(m.fields.filter(l => l.field === name || l.field.startsWith(`${name}.`)), '', null)[0];
  return entry ? entry.slice(`${key(name)}: `.length) : null;
}

/** Are there links onto fields inside this one (`newClient.firstName` inside `newClient`)? */
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

/**
 * A variable of the In or Out renamed: the paths follow - the lines from it, the links onto it.
 * Removed (`to` null): its lines go too.
 */
export function renamedVar(m: FieldMapping, side: 'in' | 'out', from: string, to: string | null): FieldMapping {
  const move = (p: string) => (p === from || p.startsWith(`${from}.`) ? (to === null ? null : `${to}${p.slice(from.length)}`) : p);
  const fields = side === 'out'
    ? m.fields.flatMap(l => { const f = move(l.field); return f === null ? [] : [{ ...l, field: f }]; })
    : m.fields.flatMap(l => {
      const paths = l.from.flatMap(p => { const q = move(p); return q === null ? [] : [q]; });
      return paths.length || l.expression?.trim() ? [{ ...l, from: paths }] : [];
    });
  return { ...m, fields };
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
 * The variables of the Out still without a value get one: a variable of the In of the same name
 * and type, or a field of one. An object of the Out otherwise: set on the variable of its type,
 * its fields of the same name from the other variables.
 */
export function autoMapped(m: FieldMapping, target: VarNode, sources: VarNode[]): FieldMapping {
  let next = m;
  const fits = (f: VarNode) => (n: VarNode) => n.name === f.name && plainType(n) === plainType(f);
  for (const f of target.children ?? []) {
    if (next.fields.some(l => l.field === f.name || l.field.startsWith(`${f.name}.`))) continue;
    const direct = sources.find(fits(f));
    if (direct) { next = linked(next, f.name, direct.name); continue; }
    const inner = sources.find(s => s.type !== 'list' && (s.children ?? []).some(fits(f)));
    if (inner) { next = linked(next, f.name, `${inner.name}.${f.name}`); continue; }
    if (f.type !== 'context' || !f.children?.length) continue;
    const on = sources.find(s => s.type === 'context' && plainType(s) === plainType(f));
    const add: Array<[string, string]> = [];
    for (const g of f.children) {
      const from = sources.find(s => s !== on && s.type === 'context' && (s.children ?? []).some(fits(g)));
      if (from) add.push([`${f.name}.${g.name}`, `${from.name}.${g.name}`]);
    }
    if (on) next = linked(next, f.name, on.name);
    for (const [field, path] of add) next = linked(next, field, path);
  }
  return next;
}

export interface MappingIssue { level: 'error' | 'warn'; text: string; field?: string }

/** What is wrong with the In and Out: a name missing or twice, no type, an In not known before the step. */
export function inOutIssues(m: FieldMapping, known: VarNode[] | null): MappingIssue[] {
  const out: MappingIssue[] = [];
  const check = (list: Field[], side: 'In' | 'Out') => {
    const seen = new Set<string>();
    for (const f of list) {
      const n = f.name.trim();
      if (!n) { out.push({ level: 'error', text: `${side}: ein Feld ohne Namen.` }); continue; }
      if (!f.type) out.push({ level: 'error', text: `${side}: «${n}» hat keinen Typ.` });
      if (seen.has(n)) out.push({ level: 'error', text: `${side}: «${n}» gibt es zweimal.` });
      seen.add(n);
    }
  };
  check(m.in, 'In');
  check(m.out, 'Out');
  if (!m.out.length) out.push({ level: 'error', text: 'Das Out braucht eine Variable - die, die der Schritt setzt.' });
  if (known) {
    for (const f of m.in) {
      const n = f.name.trim();
      if (n && !known.some(v => v.name === n)) out.push({ level: 'error', text: `In: «${n}» ist vor dem Schritt nicht bekannt.` });
    }
  }
  return out;
}

/** What is wrong with the lines against the Out (`target`, its variables as children - see mappingVarNodes) and the In (`sources`). */
export function mappingIssues(m: FieldMapping, target: VarNode, sources: VarNode[]): MappingIssue[] {
  const fields = target.children ?? [];
  const out: MappingIssue[] = [];
  for (const l of m.fields) {
    const f = resolvePath(fields, l.field);
    if (!f) { out.push({ level: 'warn', text: `«${l.field}» gibt es im Out nicht (mehr).`, field: l.field }); continue; }
    if (l.expression?.trim()) continue;
    for (const p of linkPaths(l)) {
      const n = resolvePath(sources, p);
      if (!n) out.push({ level: 'error', text: `«${l.field}»: ${p} gibt es im In nicht.`, field: l.field });
      else if (n.type !== 'any' && f.type !== 'any' && plainType(n) !== plainType(f)) out.push({ level: 'warn', text: `«${l.field}»: ${p} ist ${plainType(n)}, das Feld ${plainType(f)}.`, field: l.field });
    }
  }
  // the fields without a value: of the Out, and of an object built from its fields without a
  // line onto it
  const required = (nodes: VarNode[], prefix: string, built: boolean) => {
    for (const f of nodes) {
      const path = `${prefix}${f.name}`;
      const whole = m.fields.some(l => l.field === path);
      if (hasInner(m, path)) required(f.children ?? [], `${path}.`, built || whole);
      else if (!built && !whole && !f.optional && f.type !== 'list') {
        out.push({ level: 'error', text: `«${path}» bekommt keinen Wert - eine Linie ziehen.`, field: path });
      }
    }
  };
  required(fields, '', false);
  return out;
}
