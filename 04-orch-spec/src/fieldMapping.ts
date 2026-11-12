// A script task of a service orchestration as a mapping: per field of the result the paths of
// the variables before it - drawn as lines in the panel. Its FEEL is written along (`script`),
// so the variables after it know the result; the Scala export reads the structure itself.
//
//   base existingClient, firstName ← client.firstName, name ← client.name ?? existingClient.name
//   = context merge([existingClient, {firstName: client.firstName, name: if client.name != null then client.name else existingClient.name}])
//   → existingClient.copy(firstName = client.firstName, name = client.name.getOrElse(existingClient.name))
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

/** The FEEL of the whole mapping - what `script` holds. */
export function mappingFeel(m: FieldMapping): string {
  const entries = m.fields.flatMap(l => {
    const v = linkFeel(l);
    return v ? [`${key(l.field)}: ${v}`] : [];
  });
  const context = `{${entries.join(', ')}}`;
  if (m.base?.trim()) return entries.length ? `= context merge([${m.base.trim()}, ${context}])` : `= ${m.base.trim()}`;
  return `= ${context}`;
}

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
  for (const l of m.fields) {
    const f = (target.children ?? []).find(c => c.name === l.field);
    if (!f) { out.push({ level: 'warn', text: `«${l.field}» gibt es im Ergebnis nicht (mehr).`, field: l.field }); continue; }
    if (l.expression?.trim()) continue;
    for (const p of linkPaths(l)) {
      const n = resolvePath(sources, p);
      if (!n) out.push({ level: 'error', text: `«${l.field}»: ${p} ist vor dem Schritt nicht bekannt.`, field: l.field });
      else if (n.type !== 'any' && f.type !== 'any' && plainType(n) !== plainType(f)) out.push({ level: 'warn', text: `«${l.field}»: ${p} ist ${plainType(n)}, das Feld ${plainType(f)}.`, field: l.field });
    }
  }
  if (!baseNode) {
    for (const f of target.children ?? []) {
      if (f.optional || f.type === 'list' || m.fields.some(l => l.field === f.name)) continue;
      out.push({ level: 'error', text: `«${f.name}» bekommt keinen Wert - eine Linie ziehen oder eine Basis wählen.`, field: f.name });
    }
  }
  return out;
}
