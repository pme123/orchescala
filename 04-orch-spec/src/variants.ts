// Variants of a service `In` or `Out`.
//
// An `In` that is written in Scala as `enum In: case AdUser(adUser: String) case
// FinnovaUser(finnovaUser: String)` takes **one** of the cases — not
// all fields at once. The step therefore chooses its variant
// (`inVariant` / `outVariant`). Without a choice only the shared fields apply;
// the fields of the cases are hidden, not mandatory and not
// checked. «alle Ausprägungen» (`*`) is also possible: for the **outputs**
// the service delivers only one case, but it decides which one — the
// outputs may therefore read the fields of all cases. For the **inputs**
// the worker supports several cases and decides during unmarshalling
// which one it is — the fields of all cases are allowed, only the
// shared ones are mandatory (as with a switch at runtime).
//
// Source of the cases: the own In/Out class (interaction) as an enum with
// fields per case, otherwise the domain catalog (`cases` of the enum), otherwise the
// OpenAPI (`oneOf` → `variants` on the parameter).
//
// **Switches.** A custom decoder can also choose the case itself: from
// `useCase` directly or from `clientType` (it then sets `useCase` itself —
// `routing` in the domain catalog, the direct field first). One of the switches
// is enough; none is mandatory on its own. If a switch other than the direct
// field is active, the decoder chooses the case only at runtime: the fields of all
// cases are allowed, only the shared ones are mandatory.

import type { DomainField, Field, Mapping, Model, ProcessSpec, ServiceDef, Step, TypeDef } from './types';
import { stepDomainMember } from './feel';

export type MappingList = 'inputs' | 'outputs';

export interface VariantCase {
  name: string;
  fields: Array<Pick<DomainField, 'name'> & Partial<DomainField>>;
}

export interface Variants {
  cases: VariantCase[];
  /** Fields every variant has */
  common: Set<string>;
  /** Fields only some variants have */
  specific: Set<string>;
  /** the switches of the decoder, the direct field first — one of them is enough (see above) */
  routing?: string[];
}

export interface Chosen {
  /** chosen variant or the one recognized from the rows — null: none */
  name: string | null;
  /** not chosen, but recognized from the active rows */
  inferred: boolean;
  /** active rows from several variants at once — that is not right */
  mixed: string[];
  /** the switch via which the decoder chooses the case at runtime (`clientType`) */
  runtime?: string;
}

const NONE: Chosen = { name: null, inferred: false, mixed: [] };

export const variantKey = (list: MappingList) => (list === 'inputs' ? 'inVariant' : 'outVariant');

/** Choice «alle Ausprägungen» — the service or worker decides which case it is */
export const ALL_VARIANTS = '*';

function build(cases: VariantCase[], common: string[]): Variants | null {
  if (cases.length < 2 || !cases.some(c => c.fields.length)) return null;
  const all = new Set(common);
  // what occurs in every case is shared as well
  for (const f of cases[0].fields) if (cases.every(c => c.fields.some(x => x.name === f.name))) all.add(f.name);
  const specific = new Set(cases.flatMap(c => c.fields.map(f => f.name)).filter(n => !all.has(n)));
  return specific.size ? { cases, common: all, specific } : null;
}

/** The own In or Out class of the step (interaction) — null without one */
export function classOf(step: Step, spec: ProcessSpec, list: MappingList): TypeDef | null {
  const ia = (spec.interactions ?? []).find(i => i.stepId === step.id);
  const id = list === 'inputs' ? ia?.inTypeId : ia?.outTypeId;
  return id ? (spec.types ?? []).find(t => t.id === id) ?? null : null;
}

/** The fields of a class: the shared ones, for an enum plus those of all cases */
export function classFieldsOf(t: TypeDef): Field[] {
  const out = new Map<string, Field>();
  for (const f of [...(t.fields ?? []), ...(t.values ?? []).flatMap(v => v.fields ?? [])]) if (f.name && !out.has(f.name)) out.set(f.name, f);
  return [...out.values()];
}

/** The matching switches — only those that exist as a field */
function withRouting(v: Variants | null, routing: string[] | undefined): Variants | null {
  const known = (routing ?? []).filter(n => v?.common.has(n) || v?.specific.has(n));
  return v && known.length >= 2 ? { ...v, routing: known } : v;
}

/** The variants of the `In` or `Out` at the step — null if there are none. */
export function variantsOf(step: Step, spec: ProcessSpec, model: Model | null, list: MappingList, service: ServiceDef | null): Variants | null {
  // an own In/Out class (interaction): its cases, if it is an enum with fields
  if ((spec.interactions ?? []).some(i => i.stepId === step.id)) {
    const t = classOf(step, spec, list);
    if (t?.kind !== 'enum' || !t.values?.length) return null;
    const v = build(t.values.map(c => ({ name: c.name, fields: (c.fields ?? []).filter(f => f.name) })), (t.fields ?? []).map(f => f.name).filter(Boolean));
    // the switches are in the decoder — so in the domain the class comes from
    const dom = list === 'inputs' && v
      ? (model?.domainTypes ?? []).find(d => d.id === t.domainId) ?? stepDomainMember(step, spec, model, 'In') : null;
    return withRouting(v, dom?.routing);
  }
  const dom = stepDomainMember(step, spec, model, list === 'inputs' ? 'In' : 'Out');
  if (dom?.kind === 'enum' && dom.cases?.length) {
    const v = build(dom.cases.map(c => ({ name: c.name, fields: c.fields ?? [] })), (dom.fields ?? []).map(f => f.name));
    return withRouting(v, list === 'inputs' ? dom.routing : undefined);
  }
  if (dom) return null;
  const params = (list === 'inputs' ? service?.inputs : service?.outputs) ?? [];
  const names = [...new Set(params.flatMap(p => (Array.isArray(p.variants) ? p.variants as string[] : [])))];
  if (!names.length) return null;
  return build(
    names.map(n => ({ name: n, fields: params.filter(p => (p.variants as string[] | undefined)?.includes(n)).map(p => ({ name: p.name, ...(p.description ? { description: p.description } : {}) })) })),
    params.filter(p => !(p.variants as string[] | undefined)?.length).map(p => p.name),
  );
}

/** The chosen variant — or the one the active rows unambiguously belong to. */
export function chosenVariant(step: Step, list: MappingList, v: Variants | null): Chosen {
  if (!v) return NONE;
  const explicit = step[variantKey(list)];
  if (explicit === ALL_VARIANTS) return { name: ALL_VARIANTS, inferred: false, mixed: [] };
  if (typeof explicit === 'string' && v.cases.some(c => c.name === explicit)) return { name: explicit, inferred: false, mixed: [] };
  // a switch other than the shared field is active: the decoder chooses the case at runtime
  if (list === 'inputs' && v.routing) {
    const on = new Set((step.inputs ?? []).filter(m => !m.disabled).map(m => m.name));
    // also next to `useCase`: the decoder asks the other switches first, `useCase` only applies without them
    const runtime = v.routing.slice(1).find(n => on.has(n));
    if (runtime) return { name: ALL_VARIANTS, inferred: true, mixed: [], runtime };
  }
  const active = new Set((step[list] ?? []).filter(m => !m.disabled && v.specific.has(m.name)).map(m => m.name));
  if (!active.size) return NONE;
  const hit = v.cases.filter(c => c.fields.some(f => active.has(f.name)));
  // unambiguous only if one case covers all active fields
  const covering = hit.filter(c => [...active].every(n => c.fields.some(f => f.name === n)));
  if (covering.length === 1) return { name: covering[0].name, inferred: true, mixed: [] };
  return hit.length > 1 ? { name: null, inferred: false, mixed: hit.map(c => c.name) } : NONE;
}

/** Does the field belong to the chosen variant (or to all)? */
export function variantAllows(v: Variants | null, chosen: Chosen, name: string): boolean {
  if (!v || !v.specific.has(name) || chosen.name === ALL_VARIANTS) return true;
  return !!chosen.name && !!v.cases.find(c => c.name === chosen.name)?.fields.some(f => f.name === name);
}

/**
 * Is the field mandatory, provided it is not optional according to the domain? Not the
 * switches (one is enough — see `routingMissing`), and if the decoder chooses the
 * case only at runtime (switch or «alle Ausprägungen»), not the fields
 * of the cases.
 */
export function variantRequires(v: Variants | null, chosen: Chosen, name: string): boolean {
  if (v?.routing?.includes(name)) return false;
  if (chosen.name === ALL_VARIANTS && v?.specific.has(name)) return false;
  return variantAllows(v, chosen, name);
}

/** The switches, if none of them has an active row — otherwise null. */
export function routingMissing(v: Variants | null, rows: Mapping[]): string[] | null {
  if (!v?.routing) return null;
  return rows.some(m => !m.disabled && v.routing!.includes(m.name.trim())) ? null : v.routing;
}

/** Warning: the inputs have no variant — the same in the overview and at the table */
export const noVariantText = (v: Variants): string =>
  `Keine Ausprägung gewählt — der Service erwartet eine davon (${v.cases.map(c => c.name).join(', ')}). `
  + 'Ausprägung wählen — oder «alle Ausprägungen», wenn der Worker beim Unmarshalling entscheidet.';

/** «useCase» or «clientType» */
export const routingText = (routing: string[]): string => routing.map(n => `«${n}»`).join(' oder ');

/** The fields of the chosen variant including the shared ones */
export function variantFieldsOf(v: Variants, chosen: string | null): VariantCase['fields'] {
  const fields = new Map<string, VariantCase['fields'][number]>();
  for (const c of v.cases) for (const f of c.fields) if (v.common.has(f.name) && !fields.has(f.name)) fields.set(f.name, f);
  for (const c of v.cases) if (c.name === chosen || chosen === ALL_VARIANTS) for (const f of c.fields) if (!fields.has(f.name)) fields.set(f.name, f);
  return [...fields.values()];
}

/**
 * The rows after a choice: the fields of the variant are active (missing ones
 * are added), those of the others deselected — not removed, so that
 * switching back finds the entered expressions again.
 */
export function rowsForVariant(rows: Mapping[], v: Variants, chosen: string | null, list: MappingList): Mapping[] {
  // all variants: nothing added — missing fields via «+ aus Katalog». The
  // outputs read everything; for the inputs what the process passes stays checked
  if (chosen === ALL_VARIANTS) {
    if (list === 'inputs') return rows;
    return rows.map(m => (v.specific.has(m.name) && m.disabled ? (({ disabled: _, ...rest }) => rest)(m) : m));
  }
  const want = chosen ? v.cases.find(c => c.name === chosen)?.fields ?? [] : [];
  const wanted = new Set(want.map(f => f.name));
  const out = rows.map(m => {
    if (!v.specific.has(m.name)) return m;
    if (wanted.has(m.name)) { const { disabled: _, ...rest } = m; return rest; }
    return { ...m, disabled: true };
  });
  for (const f of want) {
    if (!v.specific.has(f.name) || out.some(m => m.name === f.name)) continue;
    out.push({ name: f.name, expression: `= ${f.name}`, ...(f.description ? { description: f.description } : {}) });
  }
  return out;
}
