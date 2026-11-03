// An `Out` with cases (enum / ADT) in the output mapping of a service or an orchestration:
// per case a condition (FEEL) and a FEEL expression per field of the case. The worker takes
// the first case whose condition holds, in the order of the Out's cases (not the order they
// are saved in); the last case without a condition is the otherwise. A condition that does not
// translate to Scala is a `???` with the FEEL, like every other mapping.
import type { Field, Mapping, TypeDef } from '../types.ts';
import type { OutCase } from './types.ts';

/** The cases of an `Out` with cases and the fields of each: the shared ones, then its own. */
export function outCaseFields(t: TypeDef): Array<{ name: string; fields: Field[] }> {
  const shared = (t.fields ?? []).filter(f => f.name);
  return (t.values ?? []).filter(v => v.name).map(v => ({
    name: v.name,
    fields: [...shared, ...(v.fields ?? []).filter(f => f.name && !shared.some(s => s.name === f.name))],
  }));
}

/** The mapping of a case — empty if it has none yet. */
export const outCaseOf = (cases: OutCase[] | undefined, name: string): OutCase =>
  (cases ?? []).find(c => c.name === name) ?? { name };

/**
 * The cases with a change to one of them, in their place (the saved spec keeps its order) —
 * a case without a condition and without an expression is left out.
 */
export function withOutCase(cases: OutCase[] | undefined, name: string, change: (c: OutCase) => OutCase): OutCase[] {
  const all = cases ?? [];
  const next = change(outCaseOf(all, name));
  const empty = !next.condition?.trim() && !(next.mappings ?? []).some(m => m.expression.trim());
  if (empty) return all.filter(c => c.name !== name);
  return all.some(c => c.name === name) ? all.map(c => (c.name === name ? next : c)) : [...all, next];
}

/**
 * The cases as the Out has them now: a case renamed or removed in the Out, or a field it no
 * longer has, does not stay in the saved spec.
 */
export function prunedOutCases(cases: OutCase[] | undefined, t: TypeDef): OutCase[] {
  const now = new Map(outCaseFields(t).map(c => [c.name, new Set(c.fields.map(f => f.name))]));
  return (cases ?? []).filter(c => now.has(c.name)).map(c => {
    const fields = now.get(c.name)!;
    return c.mappings ? { ...c, mappings: c.mappings.filter(m => fields.has(m.name)) } : c;
  });
}

/** The expression of a field of the case — `''` if none. */
export const outCaseMapping = (c: OutCase, field: string): string =>
  (c.mappings ?? []).find((m: Mapping) => m.name === field)?.expression ?? '';

/**
 * `if c1 then v1 else if c2 then v2 else otherwise` (Scala 3, indented by the caller): per
 * branch its condition and its value, both Scala; `otherwise` where no condition holds.
 * A branch without a condition (`undefined`) is the otherwise: it must be the last one —
 * the caller gives the others a `???` condition.
 */
export function caseChain(branches: Array<{ cond?: string; value: string }>, otherwise: string): string {
  const lines: string[] = [];
  const block = (v: string) => v.split('\n').map(l => (l ? `  ${l}` : l)).join('\n');
  for (const [i, b] of branches.entries()) {
    if (b.cond === undefined) {
      if (i < branches.length - 1) throw new Error(`caseChain: only the last branch can be without a condition (branch ${i + 1} of ${branches.length})`);
      if (!i) return b.value;
      lines.push('else', block(b.value));
      return lines.join('\n');
    }
    lines.push(`${i ? 'else if' : 'if'} ${b.cond} then`, block(b.value));
  }
  lines.push('else', block(otherwise));
  return lines.join('\n');
}
