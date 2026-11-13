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

/** A mapping as stored - what is missing (an In, an Out) empty, so nothing reads past it. */
export const mappingOf = (m: Partial<FieldMapping>): FieldMapping => ({ in: m.in ?? [], out: m.out ?? [], fields: m.fields ?? [] });

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
  if (!from.trim()) return m;
  // onto a name another variable of the side has: the lines stay - they would merge with its own
  // (the list may have the new name already, then it is there twice)
  if (to !== null) {
    const named = (n: string) => m[side].filter(f => f.name.trim() === n).length;
    if (named(to) > (named(from) ? 0 : 1)) return m;
  }
  const move = (p: string) => (p === from || p.startsWith(`${from}.`) ? (to === null ? null : `${to}${p.slice(from.length)}`) : p);
  const fields = side === 'out'
    ? m.fields.flatMap(l => { const f = move(l.field); return f === null ? [] : [{ ...l, field: f }]; })
    : m.fields.flatMap(l => {
      const paths = l.from.flatMap(p => { const q = move(p); return q === null ? [] : [q]; });
      const expr = l.expression?.trim();
      if (expr && namesVar(expr, from)) {
        // removed: the expression would name a variable no longer there - the line goes with it
        if (to === null) return [];
        return [{ ...l, from: paths, expression: renamedIn(expr, from, to) }];
      }
      return paths.length || expr ? [{ ...l, from: paths }] : [];
    });
  return { ...m, fields };
}

/** A FEEL expression in its parts: text in quotes (odd index) and the rest (even index). */
const feelParts = (expr: string): string[] => expr.split(/("(?:[^"\\]|\\.)*")/);

/** The variable `name` in a FEEL expression - not a field (`x.name`), not part of a longer name, not in quotes. */
const nameRe = (name: string) => new RegExp(`(?<![\\w.])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\w)`, 'g');
const namesVar = (expr: string, name: string): boolean => feelParts(expr).some((p, i) => i % 2 === 0 && new RegExp(nameRe(name).source).test(p));
const renamedIn = (expr: string, from: string, to: string): string =>
  feelParts(expr).map((p, i) => (i % 2 === 0 ? p.replace(nameRe(from), () => to) : p)).join('');

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
 * A type mapper between the types of two nodes - its name, or null: a line from the one onto the
 * other converts with it (see typeMappers.ts). Built from the model; without one nothing converts.
 */
export type Converter = (from: VarNode, to: VarNode) => string | null;

/**
 * What is open on the right gets lines: per field without a value one of the In of the same name
 * and type - the one whose path ends most like its own (`existingClient.master.segment` for
 * `newClient.master.segment`; then at the same depth), not what its base keeps anyway. Closed, a field gets a line as a
 * whole; an object open without a base gets a variable of its type as one (if there is one).
 * `open`: the paths open on the right - the variables of the Out are always looked at. `inOpen`:
 * those open on the left - only what is in sight there gives a line (without: all of it).
 */
export function autoMapped(m: FieldMapping, target: VarNode, sources: VarNode[], open: ReadonlySet<string> = new Set(), inOpen?: ReadonlySet<string>, convert?: Converter): FieldMapping {
  // the paths of the In a line can leave from - in sight, not into a list
  const cands: Array<{ path: string[]; node: VarNode; at: number }> = [];
  const walk = (n: VarNode, path: string[]) => {
    cands.push({ path, node: n, at: cands.length });
    if (n.type === 'list' || (inOpen && !inOpen.has(path.join('.')))) return;
    for (const c of n.children ?? []) walk(c, [...path, c.name]);
  };
  for (const s of sources) walk(s, [s.name]);
  // how many names at the end the two paths share
  const alike = (a: string[], b: string[]) => {
    let k = 0;
    while (k < a.length && k < b.length && a[a.length - 1 - k] === b[b.length - 1 - k]) k++;
    return k;
  };
  /** the path of the In that fits `path` best - `kept` what its base gives it (it comes last) */
  const best = (path: string[], fits: (n: VarNode) => boolean, kept: string | null): string | null => {
    const ranked = cands.filter(c => fits(c.node)).map(c => ({ ...c, p: c.path.join('.') })).sort((x, y) =>
      alike(y.path, path) - alike(x.path, path) || Number(x.p === kept) - Number(y.p === kept)
        || Math.abs(x.path.length - path.length) - Math.abs(y.path.length - path.length) || x.at - y.at);
    const top = ranked[0];
    return top && top.p !== kept ? top.p : null;
  };
  const sameType = (f: VarNode) => (n: VarNode) => plainType(n) === plainType(f) && n.type === f.type;

  let next = m;
  const visit = (nodes: VarNode[], prefix: string[], base: string | null) => {
    for (const f of nodes) {
      const path = [...prefix, f.name];
      const key = path.join('.');
      const kept = base ? `${base}.${f.name}` : null;
      const own = next.fields.find(l => l.field === key);
      if (open.has(key) && f.type === 'context' && f.children?.length) {
        let on = own ? linkPaths(own)[0] ?? null : kept;
        if (!own && !kept) {
          on = best(path, sameType(f), null);
          if (on) next = linked(next, key, on);
        }
        visit(f.children, path, on);
        continue;
      }
      if (own || hasInner(next, key)) continue;
      // the same name - of the same type, or one a type mapper converts
      const p = best(path, n => n.name === f.name && (sameType(f)(n) || !!convert?.(n, f)), kept);
      if (p) next = linked(next, key, p);
    }
  };
  visit(target.children ?? [], [], null);
  return next;
}

export interface MappingIssue { level: 'error' | 'warn'; text: string; field?: string }

/** What is wrong with the In and Out: a name missing or twice, no type, an In not known before the step. */
export function inOutIssues(stored: FieldMapping, known: VarNode[] | null): MappingIssue[] {
  const m = mappingOf(stored);
  const out: MappingIssue[] = [];
  const check = (list: Field[], side: 'In' | 'Out') => {
    const seen = new Set<string>();
    for (const f of list) {
      const n = f.name.trim();
      if (!n) { out.push({ level: 'error', text: `${side}: ein Feld ohne Namen.` }); continue; }
      if (!f.type) out.push({ level: 'error', text: `${side}: «${n}» hat keinen Typ.` });
      if (seen.has(n)) out.push({ level: 'error', text: `${side}: «${n}» gibt es zweimal.` });
      // a path is split at its dots - a name with one could never be found again
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) out.push({ level: 'error', text: `${side}: «${n}» ist kein Variablenname - nur Buchstaben, Ziffern und _.` });
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
export function mappingIssues(m: FieldMapping, target: VarNode, sources: VarNode[], convert?: Converter): MappingIssue[] {
  const fields = target.children ?? [];
  const out: MappingIssue[] = [];
  for (const l of m.fields) {
    const f = resolvePath(fields, l.field);
    if (!f) { out.push({ level: 'warn', text: `«${l.field}» gibt es im Out nicht (mehr).`, field: l.field }); continue; }
    if (l.expression?.trim()) continue;
    for (const p of linkPaths(l)) {
      const n = resolvePath(sources, p);
      if (!n) out.push({ level: 'error', text: `«${l.field}»: ${p} gibt es im In nicht.`, field: l.field });
      else if (n.type !== 'any' && f.type !== 'any' && plainType(n) !== plainType(f) && !convert?.(n, f)) out.push({ level: 'warn', text: `«${l.field}»: ${p} ist ${plainType(n)}, das Feld ${plainType(f)} - ohne Typ-Mapper dazwischen.`, field: l.field });
    }
  }
  // the fields without a value: of the Out, and of an object built from its fields without a
  // line onto it
  const required = (nodes: VarNode[], prefix: string, built: boolean) => {
    for (const f of nodes) {
      const path = `${prefix}${f.name}`;
      const whole = m.fields.some(l => l.field === path);
      if (hasInner(m, path)) required(f.children ?? [], `${path}.`, built || whole);
      // a list without a line is empty (`Seq.empty` in the worker) - no error
      else if (!built && !whole && !f.optional && f.type !== 'list' && !f.field?.collection) {
        out.push({ level: 'error', text: `«${path}» bekommt keinen Wert - eine Linie ziehen.`, field: path });
      }
    }
  };
  required(fields, '', false);
  return out;
}
