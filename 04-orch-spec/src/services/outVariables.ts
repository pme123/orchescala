// The Out of a process in service mode and the process variables: where each field of the Out comes
// from at the end (its mapping, the variable of its name, or the one of its type - as the export takes
// it), whether that variable is there and of the field's type, and which variables the Out could get.
import { expectedFor, processVariables, type VarNode } from '../feel';
import type { TypeIssue } from '../scala';
import { SCALA_TYPES, type Field, type Model, type ProcessSpec, type TypeDef } from '../types';
import { uid } from '../util';

/** What only the engine or the loop knows - no value the worker gives back. */
const NOT_FOR_OUT = new Set(['Engine', 'Schleife']);

/** The process variables an Out field can come from. */
export const outVariables = (spec: ProcessSpec, model: Model | null): VarNode[] =>
  processVariables(spec, model).filter(v => !NOT_FOR_OUT.has(v.source) && !v.source.startsWith('Gateway'));

/**
 * The variable a field of the Out takes without a mapping: the one of its name - otherwise the one of
 * its type (of several the one a script sets). undefined: none.
 */
export function implicitOutVariable(f: Field, vars: readonly VarNode[], types: TypeDef[], model: Model | null): VarNode | undefined {
  const same = vars.find(v => v.name === f.name);
  if (same) return same;
  const label = expectedFor(f, types, model)?.label;
  const all = label ? vars.filter(v => v.label === label) : [];
  const hits = all.length > 1 ? all.filter(v => v.source.startsWith('Ergebnis von')) : all;
  return hits.length === 1 ? hits[0] : undefined;
}

const unwrap = (label: string) => /^Option\[(.*)\]$/.exec(label)?.[1] ?? label;

/**
 * The fields of the Out of a process in service mode against the process variables: a field without
 * a mapping needs a variable (of its name or its type), and that one of its type. Hints - the export
 * still writes the worker, with a place to fill.
 */
export function outFieldIssues(spec: ProcessSpec, model: Model | null): TypeIssue[] {
  const out = (spec.types ?? []).find(t => t.processOut);
  if (!spec.service || !out || out.kind === 'enum') return [];
  const mapped = new Set(((spec.service as { outMappings?: { name: string; expression: string }[] }).outMappings ?? [])
    .filter(m => m.expression.trim()).map(m => m.name));
  const vars = outVariables(spec, model);
  const types = spec.types ?? [];
  const issues: TypeIssue[] = [];
  for (const f of out.fields ?? []) {
    const name = f.name.trim();
    if (!name || mapped.has(name)) continue;
    const v = implicitOutVariable(f, vars, types, model);
    if (!v) {
      issues.push({ typeId: out.id, field: f.id, warn: true,
        message: `«${name}»: keine Prozessvariable dieses Namens oder Typs - eine Ausgabe so nennen oder am Ende ein Mapping für das Out angeben.` });
      continue;
    }
    const expected = expectedFor(f, types, model)?.label;
    if (!expected || v.label === '?' || v.label === expected) continue;
    const from = v.name === name ? `die Prozessvariable ist ${v.label}` : `die Prozessvariable «${v.name}» ist ${v.label}`;
    if (unwrap(v.label) !== unwrap(expected)) {
      issues.push({ typeId: out.id, field: f.id, warn: true, message: `«${name}» ist ${expected}, ${from} (${v.source}).` });
    } else if (v.label.startsWith('Option[') && !expected.startsWith('Option[')) {
      issues.push({ typeId: out.id, field: f.id, warn: true,
        message: `«${name}»: ${from} und kann fehlen - der Worker scheitert dann; das Feld optional machen?` });
    }
  }
  return issues;
}

/**
 * A field of the Out for a process variable: its name, its type as the source names it - a scalar or a
 * class from its label (`Option[Seq[Client]]`); without one (`?`) a text.
 */
export function fieldOfVariable(v: VarNode, types: TypeDef[]): Field {
  const base = { id: uid('f'), name: v.name, ...(v.description ? { description: v.description } : {}) };
  if (v.field) return { ...base, ...v.field, ...(v.optional ? { optional: true } : {}) };
  let label = v.label;
  const optional = /^Option\[/.test(label);
  label = unwrap(label);
  const collection = /^Seq\[/.test(label);
  if (collection) label = /^Seq\[(.*)\]$/.exec(label)![1];
  // a scalar as it is, a class of the data model by its name - otherwise a text
  const type = (SCALA_TYPES as readonly string[]).includes(label) ? label : (types.find(t => t.name === label)?.id ?? 'String');
  return { ...base, type, ...(optional || v.optional ? { optional: true } : {}), ...(collection ? { collection: true } : {}) };
}
