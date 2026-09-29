// Ausprägungen eines Service-`In` bzw. `Out`.
//
// Ein `In`, das in Scala als `enum In: case AdUser(adUser: String) case
// FinnovaUser(finnovaUser: String)` steht, nimmt **einen** der Fälle — nicht
// alle Felder zugleich. Der Schritt wählt deshalb seine Ausprägung
// (`inVariant` / `outVariant`). Ohne Wahl gelten nur die gemeinsamen Felder;
// die Felder der Fälle sind ausgeblendet, nicht Pflicht und werden nicht
// geprüft.
//
// Quelle der Fälle: der Domain-Katalog (`cases` des enum), sonst die
// OpenAPI (`oneOf` → `variants` am Parameter).

import type { DomainField, Mapping, Model, ProcessSpec, ServiceDef, Step } from './types';
import { stepDomainMember } from './feel';

export type MappingList = 'inputs' | 'outputs';

export interface VariantCase {
  name: string;
  fields: Array<Pick<DomainField, 'name'> & Partial<DomainField>>;
}

export interface Variants {
  cases: VariantCase[];
  /** Felder, die jede Ausprägung hat */
  common: Set<string>;
  /** Felder, die nur manche Ausprägungen haben */
  specific: Set<string>;
}

export interface Chosen {
  /** gewählte bzw. aus den Zeilen erkannte Ausprägung — null: keine */
  name: string | null;
  /** nicht gewählt, sondern aus den aktiven Zeilen erkannt */
  inferred: boolean;
  /** aktive Zeilen aus mehreren Ausprägungen zugleich — das stimmt so nicht */
  mixed: string[];
}

const NONE: Chosen = { name: null, inferred: false, mixed: [] };

export const variantKey = (list: MappingList) => (list === 'inputs' ? 'inVariant' : 'outVariant');

function build(cases: VariantCase[], common: string[]): Variants | null {
  if (cases.length < 2 || !cases.some(c => c.fields.length)) return null;
  const all = new Set(common);
  // was in jedem Fall vorkommt, ist ebenfalls gemeinsam
  for (const f of cases[0].fields) if (cases.every(c => c.fields.some(x => x.name === f.name))) all.add(f.name);
  const specific = new Set(cases.flatMap(c => c.fields.map(f => f.name)).filter(n => !all.has(n)));
  return specific.size ? { cases, common: all, specific } : null;
}

/** Die Ausprägungen des `In` bzw. `Out` am Schritt — null, wenn es keine gibt. */
export function variantsOf(step: Step, spec: ProcessSpec, model: Model | null, list: MappingList, service: ServiceDef | null): Variants | null {
  // eine eigene In-/Out-Klasse (Interaktion) hat keine Fälle
  if ((spec.interactions ?? []).some(i => i.stepId === step.id)) return null;
  const dom = stepDomainMember(step, spec, model, list === 'inputs' ? 'In' : 'Out');
  if (dom?.kind === 'enum' && dom.cases?.length) {
    return build(dom.cases.map(c => ({ name: c.name, fields: c.fields ?? [] })), (dom.fields ?? []).map(f => f.name));
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

/** Die gewählte Ausprägung — oder die, zu der die aktiven Zeilen eindeutig gehören. */
export function chosenVariant(step: Step, list: MappingList, v: Variants | null): Chosen {
  if (!v) return NONE;
  const explicit = step[variantKey(list)];
  if (typeof explicit === 'string' && v.cases.some(c => c.name === explicit)) return { name: explicit, inferred: false, mixed: [] };
  const active = new Set((step[list] ?? []).filter(m => !m.disabled && v.specific.has(m.name)).map(m => m.name));
  if (!active.size) return NONE;
  const hit = v.cases.filter(c => c.fields.some(f => active.has(f.name)));
  // eindeutig nur, wenn ein Fall alle aktiven Felder abdeckt
  const covering = hit.filter(c => [...active].every(n => c.fields.some(f => f.name === n)));
  if (covering.length === 1) return { name: covering[0].name, inferred: true, mixed: [] };
  return hit.length > 1 ? { name: null, inferred: false, mixed: hit.map(c => c.name) } : NONE;
}

/** Gehört das Feld zur gewählten Ausprägung (oder zu allen)? */
export function variantAllows(v: Variants | null, chosen: Chosen, name: string): boolean {
  if (!v || !v.specific.has(name)) return true;
  return !!chosen.name && !!v.cases.find(c => c.name === chosen.name)?.fields.some(f => f.name === name);
}

/** Die Felder der gewählten Ausprägung samt den gemeinsamen */
export function variantFieldsOf(v: Variants, chosen: string | null): VariantCase['fields'] {
  const fields = new Map<string, VariantCase['fields'][number]>();
  for (const c of v.cases) for (const f of c.fields) if (v.common.has(f.name) && !fields.has(f.name)) fields.set(f.name, f);
  for (const f of v.cases.find(c => c.name === chosen)?.fields ?? []) fields.set(f.name, f);
  return [...fields.values()];
}

/**
 * Die Zeilen nach einer Wahl: die Felder der Ausprägung sind aktiv (fehlende
 * kommen dazu), die der anderen abgewählt — nicht entfernt, damit ein
 * Zurückwechseln die erfassten Ausdrücke wiederfindet.
 */
export function rowsForVariant(rows: Mapping[], v: Variants, chosen: string | null): Mapping[] {
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
