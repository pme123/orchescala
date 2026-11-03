// An `Out` with cases (enum / ADT) in the output mapping of a service or an orchestration:
// per case a condition (FEEL) and a FEEL expression per field of the case. The worker takes
// the first case whose condition holds; a case without a condition is the otherwise.
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

/** The cases with a change to one of them — a case without anything is left out. */
export function withOutCase(cases: OutCase[] | undefined, name: string, change: (c: OutCase) => OutCase): OutCase[] {
  const next = change(outCaseOf(cases, name));
  const empty = !next.condition?.trim() && !(next.mappings ?? []).some(m => m.expression.trim());
  const rest = (cases ?? []).filter(c => c.name !== name);
  return empty ? rest : [...rest, next];
}

/** The expression of a field of the case — `''` if none. */
export const outCaseMapping = (c: OutCase, field: string): string =>
  (c.mappings ?? []).find((m: Mapping) => m.name === field)?.expression ?? '';

/**
 * Issues of the mapping: a case without a condition that is not the last — the cases after
 * it would never be reached.
 */
export function outCaseIssues(t: TypeDef, cases: OutCase[] | undefined): string[] {
  const all = outCaseFields(t);
  return all
    .slice(0, -1)
    .filter(c => !outCaseOf(cases, c.name).condition?.trim())
    .map(c => `Fall «${c.name}» hat keine Bedingung — nur der letzte Fall darf ohne sein (sonst).`);
}

/**
 * `if c1 then v1 else if c2 then v2 else otherwise` (Scala 3, indented by the caller): per
 * branch its condition (`undefined`: the otherwise — it ends the chain) and its value, both
 * Scala; `otherwise` where no condition holds.
 */
export function caseChain(branches: Array<{ cond?: string; value: string }>, otherwise: string): string {
  const lines: string[] = [];
  const block = (v: string) => v.split('\n').map(l => `  ${l}`).join('\n');
  for (const [i, b] of branches.entries()) {
    if (b.cond === undefined) {
      if (!i) return b.value;
      lines.push('else', block(b.value));
      return lines.join('\n');
    }
    lines.push(`${i ? 'else if' : 'if'} ${b.cond} then`, block(b.value));
  }
  lines.push('else', block(otherwise));
  return lines.join('\n');
}
