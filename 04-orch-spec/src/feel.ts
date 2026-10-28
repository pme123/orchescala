// FEEL expressions in mappings (Camunda 8).
//
// In Camunda 8 a mapping value that starts with `=` is a FEEL expression.
// The app checks it while typing for three things:
//
//   a) is it valid FEEL (syntax),
//   b) does the type of the result fit the target field,
//   c) do the variables and paths it points to exist (`client.address.zip`).
//
// Evaluation is not symbolic but **with example values**: from the
// data model of the process a context is built in which every known
// variable has a value matching its type. `feelin` evaluates the expression
// in it — whatever is missing it reports as a warning with a position, and the
// type of the result is the type that would arrive at the target field.
//
// Where the variables come from: the `In` of the process, the `InitIn` (the variables
// set by the init worker), the process variables of the specification and
// the outputs of all steps. The latter mostly have no known type —
// for them the check stays silent instead of warning wrongly.

import { evaluate, FeelDate, FeelDateTime, FeelDuration, FeelTime, SyntaxError as FeelSyntaxError } from 'feelin';
import { C7_LABEL } from './engineLabels';
import type { DomainType, EngineId, Field, Mapping, Model, MultiInstanceSpec, ProcessSpec, ServiceDef, Step, TypeDef } from './types';
import { FEEL_DOCS, type FeelDoc } from './feelDocs';
import { SCALA_TYPES, isAdt } from './types';
import { indexTypes, type TypeIndex } from './scala';
import { typeShape } from './scalaTypes';
import { catalogEntry, initOutputs, interactionKind, interactionOrigin, loopSettings, originMember, resolveType } from './interactions';
import { packageOf } from './scala';
import { catalogObject, domainRef, parseDomainRef } from './serviceTypes';
import { allSteps, isInitWorker } from './bpmn';
import type { JuelOptions } from './feelJuel';
import { ALL_VARIANTS, chosenVariant, variantsOf } from './variants';

export type FeelType =
  | 'string' | 'number' | 'boolean' | 'date' | 'date time' | 'time' | 'duration'
  | 'list' | 'context' | 'nil' | 'any';

export const FEEL_TYPE_LABEL: Record<FeelType, string> = {
  string: 'Text', number: 'Zahl', boolean: 'Ja/Nein', date: 'Datum', 'date time': 'Datum + Zeit',
  time: 'Zeit', duration: 'Dauer', list: 'Liste', context: 'Objekt', nil: 'null', any: 'unbekannt',
};

/** A node in the variable tree — a process variable or a field in it. */
export interface VarNode {
  name: string;
  type: FeelType;
  /** Scala type for display, e.g. `Option[Seq[InAddress]]` */
  label: string;
  description?: string;
  /** Fields (for an object) or fields of the elements (for a list) */
  children?: VarNode[];
  /** Object with arbitrary keys (Map) — paths into it cannot be checked */
  open?: boolean;
  optional?: boolean;
  /** where the variable comes from: `In`, `InitIn`, `Variable`, `Ausgabe von …` */
  source: string;
}

/** What may arrive at the target field. */
export interface ExpectedType {
  accepts: FeelType[];
  label: string;
  /** Kind of type — determines colour and symbol of the chip in the mapping row */
  kind: ExpectedKind;
  /** for a simple enum the allowed values — for a fixed case exactly one */
  values?: string[];
}

export type ExpectedKind = 'scalar' | 'enum' | 'class' | 'list' | 'map';

/**
 * What the condition of a branch must yield: a Boolean — `null` works too.
 * In Camunda 7 it becomes `false` in JUEL, in Camunda 8 the export writes
 * the condition null-safe (`(…) = true`, see nullSafeCondition). A
 * missing optional value thus takes the other branch in both engines.
 */
export const conditionExpected = (_engine?: EngineId): ExpectedType =>
  ({ accepts: ['boolean', 'nil'], label: 'Bedingung', kind: 'scalar' });

export interface FeelIssue {
  level: 'error' | 'warn';
  text: string;
}

const isScalar = (t: string): boolean => (SCALA_TYPES as readonly string[]).includes(t);

// Process variables are JSON: date, time and duration arrive as text.
// The example value is therefore a text; a target field of this type accepts
// both — the text and the real FEEL value (`date(…)`, `today()`).
const SCALAR_FEEL: Record<string, FeelType> = {
  String: 'string', Iban: 'string', Iso8601Duration: 'string',
  Boolean: 'boolean',
  Int: 'number', Long: 'number', Double: 'number', BigDecimal: 'number',
  LocalDate: 'string', LocalDateTime: 'string', Instant: 'string',
};
const SCALAR_ACCEPTS: Record<string, FeelType[]> = {
  LocalDate: ['string', 'date'],
  LocalDateTime: ['string', 'date time'],
  Instant: ['string', 'date time'],
  Iso8601Duration: ['string', 'duration'],
};

// ── Variable tree ────────────────────────────────────────────────────────────

const MAX_DEPTH = 6;

export { enumHasCase, splitEnumCase } from './scalaTypes';
import { enumHasCase, splitEnumCase } from './scalaTypes';

interface Builder { idx: TypeIndex; model: Model | null }

/** A field of the class builder as a node — with its subfields. */
/** A field with a default value is always present — even if it is `Option[…]` */
const mayBeMissing = (f: { optional?: boolean; default?: string }): boolean => !!f.optional && !f.default?.trim();

function nodeOfField(f: Field, source: string, b: Builder, depth: number, seen: Set<string>): VarNode {
  return nodeOf(f.name, f.type, {
    optional: mayBeMissing(f), collection: !!f.collection, map: !!f.map, enumCase: f.enumCase, description: f.description, source,
    label: fieldLabel(f, b.idx),
  }, b, depth, seen);
}

function fieldLabel(f: Field, idx: TypeIndex): string {
  let t = idx.nameOf(f.type);
  if (f.enumCase) t = `${t}.${f.enumCase}`;
  if (f.map) t = `Map[String, ${t}]`;
  if (f.collection) t = `Seq[${t}]`;
  if (f.optional) t = `Option[${t}]`;
  return t;
}

function nodeOf(
  name: string, typeRef: string,
  o: { optional: boolean; collection: boolean; map?: boolean; enumCase?: string; description?: string; source: string; label: string },
  b: Builder, depth: number, seen: Set<string>,
): VarNode {
  const base = baseNode(typeRef, b, depth, seen, o.enumCase);
  // A map is an object with arbitrary keys — the tree knows its values,
  // not the keys; paths into it therefore stay unchecked
  const node: VarNode = {
    name, source: o.source, label: o.label,
    type: o.collection ? 'list' : o.map ? 'context' : base.type,
    ...(o.description ? { description: o.description } : {}),
    ...(o.optional ? { optional: true } : {}),
    ...(o.map && !o.collection ? { open: true } : {}),
  };
  if (base.children?.length && !o.map) node.children = base.children;
  return node;
}

/** Type and subfields of a base type (without Option/Seq); `enumCase` = only this case. */
function baseNode(typeRef: string, b: Builder, depth: number, seen: Set<string>, enumCase?: string): { type: FeelType; children?: VarNode[] } {
  if (isScalar(typeRef)) return { type: SCALAR_FEEL[typeRef] ?? 'string' };
  if (depth >= MAX_DEPTH || seen.has(typeRef)) return { type: 'context' };
  const inner = new Set(seen).add(typeRef);

  const own = b.idx.byId.get(typeRef);
  if (own) {
    // an ADT is an object in JSON — visible are the fields of all cases,
    // for a single case only the shared ones and those of this case
    if (own.kind === 'enum' && !isAdt(own)) return { type: 'string' };
    const cases = (own.values ?? []).filter(v => !enumCase || v.name === enumCase);
    const fields = own.kind === 'enum' ? [...(own.fields ?? []), ...cases.flatMap(v => v.fields ?? [])] : (own.fields ?? []);
    const seenNames = new Set<string>();
    return { type: 'context', children: fields.filter(f => f.name && !seenNames.has(f.name) && seenNames.add(f.name)).map(f => nodeOfField(f, `Feld von ${own.name}`, b, depth + 1, inner)) };
  }

  const dom = b.idx.domainOf(typeRef);
  if (dom) return domainNode(dom, b, depth, inner, enumCase);

  // Service object (`svc:`): the catalog may know it under its name
  const svc = b.idx.serviceOf(typeRef);
  if (svc) {
    const found = resolveType(svc.name, b.model, svc.pkg);
    if (found) return domainNode(found, b, depth, inner);
    return { type: 'context' };
  }
  return { type: 'any' };
}

function domainNode(dom: DomainType, b: Builder, depth: number, seen: Set<string>, enumCase?: string): { type: FeelType; children?: VarNode[] } {
  if (dom.kind === 'enum' && !dom.cases?.length && !dom.fields?.length) return { type: 'string' };
  if (dom.kind === 'alias') return { type: 'any' };
  const seenNames = new Set<string>();
  const cases = (dom.cases ?? []).filter(c => !enumCase || c.name === enumCase);
  const fields = dom.kind === 'enum'
    ? [...(dom.fields ?? []), ...cases.flatMap(c => c.fields ?? [])].filter(p => !seenNames.has(p.name) && seenNames.add(p.name))
    : (dom.fields ?? []);
  const children = fields.map(p => {
    const shape = typeShape(p.type);
    const scalar = isScalar(shape.base);
    const ref = scalar ? null : resolveType(shape.base, b.model, dom.pkg);
    // `CustomDocContents.\`QI-Deklaration\`` — a case of an ADT enum
    const split = !scalar && !ref ? splitEnumCase(shape.base) : null;
    const enumRef = split ? resolveType(split.base, b.model, dom.pkg) : null;
    const isCase = !!split && enumHasCase(enumRef, split.enumCase);
    const typeRef = scalar ? shape.base : ref ? domainRef(ref.id) : isCase ? domainRef(enumRef!.id) : shape.base;
    return nodeOf(p.name, typeRef, {
      optional: shape.optional && !p.default?.trim(), collection: shape.collection, map: shape.map, ...(isCase ? { enumCase: split!.enumCase } : {}), description: p.description,
      source: `Feld von ${dom.name}`, label: p.type,
    }, b, depth + 1, seen);
  });
  return { type: 'context', children };
}

/**
 * All process variables with their paths. For equal names the first
 * source wins — and first comes what is **effective** in the process: the `InitIn`
 * (the init worker sets it at the beginning; an optional field of the `In` has
 * its required twin with a default there), then the `InConfig` (always with
 * default), then the `In`, the process variables and the outputs.
 */
export function processVariables(spec: ProcessSpec, model: Model | null): VarNode[] {
  const types = spec.types ?? [];
  const b: Builder = { idx: indexTypes(types, model), model };
  const out: VarNode[] = [];
  const have = new Set<string>();
  const add = (n: VarNode) => { if (n.name && !have.has(n.name)) { have.add(n.name); out.push(n); } };

  // The InitIn — described as a type; otherwise only the names are known (below, after the In)
  const initIn = types.find(t => t.initIn);
  if (initIn) for (const f of initIn.fields ?? []) add(nodeOfField(f, 'InitIn', b, 0, new Set()));

  // The InConfig — own tuning knobs and those of the loops; all with
  // a default, so always present
  const inConfig = types.find(t => t.inConfig);
  for (const f of inConfig?.fields ?? []) add(nodeOfField(f, 'InConfig', b, 0, new Set()));
  for (const l of loopSettings(spec)) {
    const t = l.kind === 'timer' ? 'Iso8601Duration' : 'Int';
    add(nodeOf(l.name, t, { optional: false, collection: false, source: 'InConfig', label: t }, b, 0, new Set()));
  }

  // The In — as an ADT the shared fields and those of all cases (in JSON
  // they sit side by side; which case it is is decided at runtime)
  const root = types.find(t => t.root);
  const rootFields = root?.kind === 'enum'
    ? [...(root.fields ?? []), ...(root.values ?? []).flatMap(v => v.fields ?? [])]
    : (root?.fields ?? []);
  for (const f of rootFields) add(nodeOfField(f, 'In', b, 0, new Set()));

  // without an InitIn type: the outputs of the init worker, type unknown — after the
  // In, so that its type is not lost
  if (!initIn) for (const o of initOutputs(spec)) add({ name: o.name, type: 'any', label: '?', source: 'InitIn', ...(o.description ? { description: o.description } : {}) });

  // The pattern «Prozess-Bezeichnung» (from Orchescala): the init worker sets
  // it as `callingProcessKeyDE/FR` (ProcessLabels.labelKeyDe/Fr)
  const labels = spec.processLabels;
  if (labels?.de || labels?.fr) {
    for (const [lang, value] of [['DE', labels.de], ['FR', labels.fr]] as const) {
      add({ name: `callingProcessKey${lang}`, type: 'string', label: 'String', source: 'Pattern Prozess-Bezeichnung',
        description: `Bezeichnung des Prozesses (${lang.toLowerCase()})${value ? ` — «${value}»` : ''}; der Init-Worker setzt sie aus processLabels` });
    }
  }

  for (const v of spec.variables ?? []) {
    const t = (v.type ?? '').trim();
    // a class (`DebitCardDetail`, `Seq[Card]`): the own one or the domain's — with fields
    const shape = typeShape(t);
    const ref = !t || isScalar(shape.base) ? null
      : types.find(x => x.name === shape.base)?.id ?? (() => { const d = resolveType(shape.base, model, packageOf(spec, model)); return d ? domainRef(d.id) : null; })();
    add(isScalar(shape.base) || ref
      ? nodeOf(v.name, ref ?? shape.base, { optional: shape.optional, collection: shape.collection, map: shape.map, description: v.description, source: 'Variable', label: t }, b, 0, new Set())
      : { name: v.name, type: 'any', label: t || '?', source: 'Variable', ...(v.description ? { description: v.description } : {}) });
  }

  for (const s of allSteps(spec.steps)) {
    // the result only when an output asks for it — it needs the catalog
    let results: VarNode[] | null = null;
    const ofStep = () => (results ??= ownResults(s, spec, model, catalogEntry(s, model), b));
    for (const o of s.outputs ?? []) {
      if (o.disabled || !o.name || have.has(o.name)) continue;
      const source = `Ausgabe von ${s.name || s.id}`;
      const typed = outputNode(o, ofStep);
      add(typed
        ? { ...typed, name: o.name, source, ...(o.description ? { description: o.description } : {}) }
        : { name: o.name, type: 'any', label: '?', source, ...(o.description ? { description: o.description } : {}) });
    }
  }

  // Own workers and user tasks write their `Out` directly into the
  // process variables — without mapping. The fields: from the described
  // interaction, otherwise from the domain (the init worker is the InitIn above).
  for (const s of allSteps(spec.steps)) {
    const kind = interactionKind(s, spec.processId ?? '');
    if (kind !== 'customTask' && kind !== 'userTask') continue;
    const source = `Ergebnis von ${s.name || s.id}`;
    const ia = (spec.interactions ?? []).find(i => i.stepId === s.id);
    const own = ia?.outTypeId ? types.find(t => t.id === ia.outTypeId) : undefined;
    if (own) {
      for (const f of own.fields ?? []) add({ ...nodeOfField(f, source, b, 0, new Set()), source });
      continue;
    }
    const dom = stepDomainMember(s, spec, model, 'Out');
    if (dom) for (const n of domainNode(dom, b, 0, new Set([domainRef(dom.id)])).children ?? []) add({ ...n, source });
  }

  // A decision (business rule task) writes its result into **one**
  // variable (`resultVariable`) — without mapping, like the own workers above
  // This applies to every decision, also an external one: the engine sets the
  // variable; without a known Out it is `any`, then nobody checks its fields.
  for (const s of allSteps(spec.steps)) {
    if (s.kind !== 'rule' || !s.resultVariable) continue;
    // Camunda 8 with output mappings: Zeebe only takes over the mapped variables
    // (above with the outputs) — the resultVariable stays local to the task
    if (spec.engine === 'c8' && (s.outputs ?? []).some(o => !o.disabled && o.name)) continue;
    for (const n of ownResults(s, spec, model, catalogEntry(s, model), b)) add(n);
  }

  // What the engine itself keeps — in Camunda 7 on the execution (`execution.…`,
  // the export translates it), in Camunda 8 under these names
  // in Camunda 8 the InitWorker sets it — as a String (the key is too big for JavaScript);
  // without InitWorker it is missing: then unknown, so that its use is reported
  if (spec.engine !== 'c8' || allSteps(spec.steps).some(s => isInitWorker(s, spec.processId)))
    add({ name: 'processInstanceId', type: 'string', label: 'String', source: 'Engine', description: `Kennung der eigenen Prozess-Instanz, gesetzt vom InitWorker, wenn er fertig ist — ${C7_LABEL}: execution.processInstanceId` });
  add({ name: 'businessKey', type: 'string', label: 'String', source: 'Engine', description: `Business Key der Prozess-Instanz — ${C7_LABEL}: execution.processBusinessKey` });
  add({ name: 'processDefinitionKey', type: 'any', label: 'Prozess', source: 'Engine', description: `der Prozess — ${C7_LABEL}: execution.getProcessDefinition().getKey()` });
  return out;
}

/**
 * The process variables that may be missing — Camunda 7 reads them with
 * `execution.getVariable("x")` (see feelJuel.ts). Not included is what
 * the init worker always sets: a required field of the `InitIn`, one of its
 * outputs and an optional field of the `In` with a default (its required twin
 * in the `InitIn`) — even if the `In` has it as optional.
 */
export function optionalVariables(spec: ProcessSpec, model: Model | null = null): Set<string> {
  const types = spec.types ?? [];
  const set = new Set<string>();
  for (const f of types.find(t => t.initIn)?.fields ?? []) if (f.name && !f.optional) set.add(f.name);
  for (const o of initOutputs(spec)) if (o.name) set.add(o.name);
  const root = types.find(t => t.root);
  const rootFields = [...(root?.fields ?? []), ...(root?.values ?? []).flatMap(v => v.fields ?? [])];
  for (const f of rootFields) if (f.optional && f.default?.trim()) set.add(f.name);
  return new Set(processVariables(spec, model).filter(v => v.optional && !set.has(v.name)).map(v => v.name));
}

/**
 * How FEEL is translated for Camunda 7 (see feelJuel.ts): which variables
 * may be missing, the fields of the variables (the end of a Spin path) and the
 * results of the DMN decisions — a Map or List, not JSON.
 */
export function juelOptions(spec: ProcessSpec, model: Model | null = null): JuelOptions {
  return {
    optional: optionalVariables(spec, model),
    vars: processVariables(spec, model),
    plainRoots: new Set(allSteps(spec.steps).filter(s => s.kind === 'rule' && s.resultVariable?.trim()).map(s => s.resultVariable!.trim())),
  };
}

/**
 * What is visible in the **source expression of an output**: the result of the
 * service. The worker returns its `Out`, and its fields become
 * variables of the job — `= accountId`, not `= out.accountId`. Plus the
 * process variables, which in Camunda 8 are in the same context.
 *
 * Where the `Out` comes from: the Out class of the interaction; otherwise the
 * `<Objekt>.Out` in the domain catalog (via topic or called process);
 * otherwise the output parameters of the catalog entry, without type.
 */
/**
 * The `In` or `Out` of the service object in the domain catalog — found via
 * the topic, the called process or the name of the interaction. There
 * are the **real** Scala types; they are the yardstick where the step
 * has no class of its own.
 */
export function stepDomainMember(step: Step, spec: ProcessSpec, model: Model | null, member: 'In' | 'Out'): DomainType | null {
  const all = model?.domainTypes ?? [];
  const ia = (spec.interactions ?? []).find(i => i.stepId === step.id);
  // an interaction: its object via the key, from exactly its package —
  // the name or the topic alone hit the first object of any process
  if (ia) return originMember(interactionOrigin(ia, model, packageOf(spec, model)), member, model);
  // a decision (DMN) is named by its decisionId — the spelling may differ
  const decision = step.kind === 'rule' && step.topic
    ? all.find(t => t.owner && t.keyName === 'decisionId' && t.key?.toLowerCase() === step.topic!.toLowerCase())
    : undefined;
  const owner = decision ? decision
    : step.topic ? all.find(t => t.topicName === step.topic && t.owner)
    : step.calledProcess ? all.find(t => t.processName === step.calledProcess && t.owner)
    : undefined;
  // In/Out from the package of the object — objects of the same name in other projects
  // (`GetAccounts` in vollmacht and fil-is) do not count
  if (owner) return all.find(t => t.pkg === owner.pkg && t.name === `${owner.owner}.${member}`) ?? null;
  // a service without `topicName` in the catalog: the object via its name and
  // the derived package (`acme-fil-is-cardV4.GetX` → `GetX` in
  // `acme.fil.is.domain.card.v4`) — objects of the same name in other versions do not count
  const ref = step.serviceId ?? step.topic;
  const obj = ref && step.kind === 'service' ? catalogObject(ref, model) : null;
  return obj ? all.find(t => t.pkg === obj.pkg && t.name === `${obj.object}.${member}`) ?? null : null;
}

/** Expected type of a field according to the domain catalog — `null` if unknown. */
/** A field of the domain type — for an enum also from its cases */
const domainField = (dom: DomainType | null, name: string) =>
  dom?.fields?.find(f => f.name === name) ?? dom?.cases?.flatMap(c => c.fields ?? []).find(f => f.name === name);

export function expectedFromDomain(dom: DomainType | null, name: string, model: Model | null): ExpectedType | null {
  const p = domainField(dom, name);
  if (!p) return null;
  const shape = typeShape(p.type);
  let accepts: FeelType[];
  let kind: ExpectedKind;
  let values: string[] | undefined;
  if (shape.collection) { accepts = ['list']; kind = 'list'; }
  else if (shape.map) { accepts = ['context']; kind = 'map'; }
  else if (isScalar(shape.base)) { accepts = SCALAR_ACCEPTS[shape.base] ?? [SCALAR_FEEL[shape.base] ?? 'string']; kind = 'scalar'; }
  else {
    // `ProcessStatus.canceled.type` — a fixed case: exactly this value
    const split = resolveType(shape.base, model, dom!.pkg) ? null : splitEnumCase(shape.base);
    const caseOf = split ? resolveType(split.base, model, dom!.pkg) : null;
    if (split && caseOf && enumHasCase(caseOf, split.enumCase) && !caseOf.cases?.length && !caseOf.fields?.length) {
      return { accepts: shape.optional ? ['string', 'nil'] : ['string'], label: p.type, kind: 'enum', values: [split.enumCase] };
    }
    const ref = resolveType(shape.base, model, dom!.pkg);
    if (!ref) return null;                    // type not in the catalog — no verdict
    if (ref.kind === 'enum' && !ref.cases?.length && !ref.fields?.length) { accepts = ['string']; kind = 'enum'; values = ref.values; }
    else if (ref.kind === 'alias') return null;
    else { accepts = ['context']; kind = ref.kind === 'enum' ? 'enum' : 'class'; }
  }
  // if the value is missing, the default applies — null is then allowed
  if (shape.optional || p.default?.trim()) accepts = [...accepts, 'nil'];
  return { accepts, label: p.type, kind, ...(values?.length ? { values } : {}) };
}

/** Is the field required according to the domain catalog (not `Option[…]`)? null = field unknown. */
export function domainRequired(dom: DomainType | null, name: string): boolean | null {
  const p = domainField(dom, name);
  if (!p) return null;
  return !typeShape(p.type).optional && !p.default;
}

const inConfigFieldOf = (dom: DomainType | null) => dom?.fields?.find(x => /(?:^|\.)InConfig$/.test(typeShape(x.type).base));

/**
 * The field `inConfig: Option[InConfig]` of a domain `In` — null if absent. A caller
 * does not pass it along: its own `inConfig` is different from that of the callee;
 * only individual fields from it (mocks).
 */
export const inConfigField = (dom: DomainType | null): string | null => inConfigFieldOf(dom)?.name ?? null;

/** Warning on an active row `inConfig` */
export const inConfigWarning = (name: string): string =>
  `«${name}» nicht mitgeben — das InConfig des Aufgerufenen ist ein anderes als das eigene; nur einzelne Felder daraus (z. B. Mocks) mitgeben.`;

/**
 * The fields of the `InConfig` of a domain `In` (`inConfig: Option[InConfig]`) —
 * mocks and tuning knobs (`postAccountMock`). A caller passes them as
 * its own variables; the `InConfig` reads them there. Empty without `InConfig`.
 */
export function inConfigFields(dom: DomainType | null, model: Model | null): string[] {
  const f = inConfigFieldOf(dom);
  if (!dom || !f) return [];
  const base = typeShape(f.type).base;
  const name = base.includes('.') ? base : dom.owner ? `${dom.owner}.${base}` : base;
  const cfg = (model?.domainTypes ?? []).find(t => t.pkg === dom.pkg && t.name === name);
  return (cfg?.fields ?? []).map(x => x.name);
}

/**
 * What the domain knows in the `In`: the fields (for an enum also those of the cases,
 * plus `inConfig` — see `inConfigWarning`) and those of the `InConfig`. The catalog from the OpenAPI does
 * not know all of it — `inConfig` and the mocks are missing there.
 */
export function domainInputNames(dom: DomainType | null, model: Model | null): string[] {
  return [...(dom?.fields ?? []), ...(dom?.cases ?? []).flatMap(c => c.fields ?? [])].map(f => f.name).concat(inConfigFields(dom, model));
}


export function resultVariables(step: Step, spec: ProcessSpec, model: Model | null, service: ServiceDef | null): VarNode[] {
  const out = ownResults(step, spec, model, service);
  const have = new Set(out.map(n => n.name));
  for (const v of processVariables(spec, model)) if (!have.has(v.name)) { have.add(v.name); out.push(v); }
  return out;
}

/** Only the result of the step — without the process variables (see resultVariables) */
function ownResults(step: Step, spec: ProcessSpec, model: Model | null, service: ServiceDef | null, built?: Builder): VarNode[] {
  const types = spec.types ?? [];
  const b: Builder = built ?? { idx: indexTypes(types, model), model };
  const out: VarNode[] = [];
  const have = new Set<string>();
  const add = (n: VarNode) => { if (n.name && !have.has(n.name)) { have.add(n.name); out.push(n); } };

  const ia = (spec.interactions ?? []).find(i => i.stepId === step.id);
  const ownOut = ia?.outTypeId ? types.find(t => t.id === ia.outTypeId) : undefined;
  if (ownOut && !(step.kind === 'rule' && step.resultVariable)) {
    for (const f of ownOut.fields ?? []) add(nodeOfField(f, `Ergebnis (${ownOut.name})`, b, 0, new Set()));
  } else {
    const dom = ownOut ? null : stepDomainMember(step, spec, model, 'Out');
    if (step.kind === 'rule' && step.resultVariable) {
      // Decision: the result is in **one** variable — depending on the form a
      // value, an object with the fields of the Out or a list of them. The
      // fields from the DMN decision of the process, otherwise from the domain
      const fields = ownOut
        ? (ownOut.fields ?? []).map(f => nodeOfField(f, `Ergebnis (${ownOut.name})`, b, 0, new Set()))
        : dom ? domainNode(dom, b, 0, new Set([domainRef(dom.id)])).children ?? [] : [];
      const form = (ownOut ? ia?.decisionResult : undefined) ?? step.decisionResult ?? dom?.decisionResult ?? (spec.engine === 'c8'
        ? (fields.length === 1 ? 'singleEntry' : 'singleResult')
        : 'resultList');
      const what = ownOut ? ia!.name : dom?.name;
      const source = `Ergebnis der Entscheidung${what ? ` (${what})` : ''}`;
      const name = step.resultVariable;
      const label = what ? `${what} · ${form}` : form;
      if (!fields.length) add({ name, type: 'any', label, source });
      else if (form === 'singleEntry') add({ ...fields[0], name, label, source });
      else if (form === 'collectEntries') add({ name, type: 'list', label, source });
      else if (form === 'resultList') add({ name, type: 'list', children: fields, label, source });
      else add({ name, type: 'context', children: fields, label, source });
    } else if (dom?.fields?.length || dom?.cases?.some(c => c.fields?.length)) {
      // enum with cases: the shared fields and those of the selected case
      const v = dom.cases?.length ? variantsOf(step, spec, model, 'outputs', service) : null;
      // no selection, no case — a name that does not exist (empty would mean: all)
      const chosen = v ? chosenVariant(step, 'outputs', v).name : null;
      const enumCase = !v || chosen === ALL_VARIANTS ? undefined : chosen ?? '\u0000';
      for (const n of domainNode(dom, b, 0, new Set([domainRef(dom.id)]), enumCase).children ?? []) add({ ...n, source: `Ergebnis (${dom.name})` });
    } else {
      for (const p of service?.outputs ?? []) add({ name: p.name, type: 'any', label: '?', source: 'Ergebnis (Katalog)', ...(p.description ? { description: p.description } : {}) });
    }
  }
  return out;
}

/**
 * The type of an output: if it reads a path from the result of the step
 * (`= debitCardDetail`, `= result.basicData`), the process variable has its
 * type with fields — otherwise it stays unknown.
 */
function outputNode(o: Mapping, results: () => VarNode[]): VarNode | null {
  const path = /^=\s*([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*)\s*$/.exec(o.expression.trim())?.[1].split('.').map(x => x.trim());
  if (!path) return null;
  let node = results().find(n => n.name === path[0]) ?? null;
  for (const seg of path.slice(1)) node = node?.children?.find(c => c.name === seg) ?? null;
  return node;
}

/** Expected type of a target field — `null` if it is not known. */
export function expectedFor(f: Field | undefined, types: TypeDef[] = [], model: Model | null = null): ExpectedType | null {
  if (!f) return null;
  const idx = indexTypes(types, model);
  let accepts: FeelType[];
  let kind: ExpectedKind;
  let values: string[] | undefined;
  if (f.collection) { accepts = ['list']; kind = 'list'; }
  else if (f.map) { accepts = ['context']; kind = 'map'; }
  else if (isScalar(f.type)) { accepts = SCALAR_ACCEPTS[f.type] ?? [SCALAR_FEEL[f.type] ?? 'string']; kind = 'scalar'; }
  else {
    const own = idx.byId.get(f.type);
    const dom = idx.domainOf(f.type);
    const enumish = own?.kind === 'enum' || dom?.kind === 'enum';
    if ((own?.kind === 'enum' && !isAdt(own)) || (dom?.kind === 'enum' && !dom.cases?.length && !dom.fields?.length)) {
      accepts = ['string']; kind = 'enum';
      // a fixed case only allows its value, otherwise every case of the selection
      values = f.enumCase ? [f.enumCase.replace(/^`|`$/g, '')] : own ? (own.values ?? []).map(v => v.name).filter(Boolean) : dom?.values;
    }
    else if (dom?.kind === 'alias') return null;
    else { accepts = ['context']; kind = enumish ? 'enum' : 'class'; }
  }
  // if the value is missing, the default applies — null is then allowed
  if (f.optional || f.default?.trim()) accepts = [...accepts, 'nil'];
  return { accepts, label: fieldLabel(f, idx), kind, ...(values?.length ? { values } : {}) };
}

// ── Example values ───────────────────────────────────────────────────────────

const SAMPLE: Partial<Record<FeelType, unknown>> = {
  string: 'text', number: 1, boolean: true, date: '2024-01-31', 'date time': '2024-01-31T12:00:00', time: '12:00:00', duration: 'PT1M',
};

function sampleOf(n: VarNode): unknown {
  if (n.type === 'list') return [n.children?.length ? sampleContext(n.children) : 'text'];
  if (n.open) return {};
  if (n.type === 'context') return sampleContext(n.children ?? []);
  if (n.type === 'any') return 'text';
  return SAMPLE[n.type] ?? null;
}

export function sampleContext(vars: VarNode[]): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};
  for (const v of vars) ctx[v.name] = sampleOf(v);
  return ctx;
}

// ── Check ────────────────────────────────────────────────────────────────────

export const isFeel = (expression: string): boolean => expression.trimStart().startsWith('=');

export function feelType(value: unknown): FeelType {
  if (value === null || value === undefined) return 'nil';
  if (Array.isArray(value)) return 'list';
  if (value instanceof FeelDate) return 'date';
  if (value instanceof FeelDateTime) return 'date time';
  if (value instanceof FeelTime) return 'time';
  if (value instanceof FeelDuration) return 'duration';
  if (typeof value === 'object') return 'context';
  if (typeof value === 'function') return 'any';
  return typeof value as FeelType;
}

/** `client.address.` before a position → the path segments `client`, `address` */
function chainBefore(text: string, at: number): string[] | null {
  const m = /([A-Za-z_][\w]*(?:\s*\.\s*[A-Za-z_][\w]*)*)\s*\.\s*$/.exec(text.slice(0, at));
  return m ? m[1].replace(/\s/g, '').split('.') : null;
}

/** Is there a node on the path without known content (type unknown or Map)? */
function openOnPath(vars: VarNode[], chain: string[]): boolean {
  let pool = vars;
  for (const seg of chain) {
    const n = pool.find(v => v.name === seg);
    if (!n) return false;
    if (n.type === 'any' || n.open) return true;
    pool = n.children ?? [];
  }
  return false;
}

/**
 * The fields of the elements of the list that is filtered at this position
 * (`liste[ … hier … ]`) — null if they are not known: the list is
 * unknown, without type, open or without known fields.
 */
function filteredElements(body: string, at: number, vars: VarNode[]): VarNode[] | null {
  const code = body.slice(0, at).replace(/"(?:[^"\\]|\\.)*"/g, m => ' '.repeat(m.length));
  let depth = 0, open = -1;
  for (let i = code.length - 1; i >= 0; i--) {
    if (code[i] === ']') depth++;
    else if (code[i] === '[') { if (depth === 0) { open = i; break; } depth--; }
  }
  if (open < 0) return null;
  const m = /([A-Za-z_][\w]*(?:\s*\.\s*[A-Za-z_][\w]*)*)\s*$/.exec(code.slice(0, open));
  if (!m) return null;
  let pool = vars, node: VarNode | undefined;
  for (const seg of m[1].replace(/\s/g, '').split('.')) {
    node = pool.find(v => v.name === seg);
    if (!node) return null;
    if (node.type === 'any' || node.open) return null;
    pool = node.children ?? [];
  }
  return node?.type === 'list' && node.children?.length ? node.children : null;
}

/** Names in the expression that hit a variable without a known type. */
function touchesUnknown(body: string, vars: VarNode[]): boolean {
  const unknown = new Set(vars.filter(v => v.type === 'any').map(v => v.name));
  if (!unknown.size) return false;
  const code = body.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  for (const m of code.matchAll(/(?<![\w.])([A-Za-z_]\w*)/g)) if (unknown.has(m[1])) return true;
  return false;
}

/** Is the expression a bare path on which something may be missing? Then which segment. */
function optionalOnPath(body: string, vars: VarNode[]): { path: string; label: string } | null {
  if (!/^[A-Za-z_]\w*(\s*\.\s*[A-Za-z_]\w*)*$/.test(body)) return null;
  const chain = body.replace(/\s/g, '').split('.');
  let pool = vars;
  for (let i = 0; i < chain.length; i++) {
    const n = pool.find(v => v.name === chain[i]);
    if (!n) return null;
    if (n.optional) return { path: chain.slice(0, i + 1).join('.'), label: n.label };
    if (n.type === 'any' || n.open) return null;
    pool = n.children ?? [];
  }
  return null;
}

const quoted = (msg: string): string => /'([^']*)'/.exec(msg)?.[1] ?? '';

// Camunda functions that `feelin` does not know (the engine's Scala FEEL has them).
// They are in the evaluation context; the parser recognises the names with spaces
// there itself. `is defined` and `get or else` may point to unknown things —
// that is what they are for (see `guardedSpans`).
const CAMUNDA_FUNCTIONS: Record<string, unknown> = {
  'is defined': (v: unknown) => v !== undefined && v !== null,
  'get or else': (v: unknown, d: unknown) => v ?? d,
  trim: (s: unknown) => typeof s === 'string' ? s.trim() : null,
  'from json': (s: unknown) => { try { return typeof s === 'string' ? JSON.parse(s) : null; } catch { return null; } },
  'to json': (o: unknown) => JSON.stringify(o) ?? null,
};

// Names the engine sets in multi-instance activities: `loopCounter`
// and the element of the collection (name from the BPMN)

/** The multi-instance executions a step lies in — itself and its ancestors (subprocesses) */
export function multiInstanceScopes(steps: Step[] | undefined): Map<string, MultiInstanceSpec[]> {
  const out = new Map<string, MultiInstanceSpec[]>();
  const visit = (list: Step[] | undefined, inherited: MultiInstanceSpec[]) => {
    for (const s of list ?? []) {
      const own = s.multiInstance ? [...inherited, s.multiInstance] : inherited;
      out.set(s.id, own);
      // the children of a subprocess and the paths at gateways/errors lie in the same scope
      visit(s.children, own);
      for (const b of s.branches ?? []) visit(b.steps, inherited);
      for (const e of s.errors ?? []) visit(e.steps, inherited);
    }
  };
  visit(steps, []);
  return out;
}

/**
 * The variables added in a multi-instance execution: `loopCounter`
 * and the element of the collection. If the collection points to a list with known
 * fields, the element has these fields; otherwise its type stays open.
 */
export function withMultiInstance(vars: VarNode[], scopes: MultiInstanceSpec[] | undefined): VarNode[] {
  if (!scopes?.length) return vars;
  const out = [...vars];
  const add = (n: VarNode) => { if (!out.some(v => v.name === n.name)) out.unshift(n); };
  add({ name: 'loopCounter', type: 'number', label: 'Int', source: 'Mehrfachausführung', description: 'Nummer des aktuellen Durchlaufs, ab 1' });
  for (const mi of scopes) {
    const name = mi.element?.trim();
    if (!name) continue;
    const coll = mi.collection?.trim() ?? '';
    let pool = vars;
    let hit: VarNode | undefined;
    if (/^[A-Za-z_]\w*(\s*\.\s*[A-Za-z_]\w*)*$/.test(coll)) {
      for (const seg of coll.replace(/\s/g, '').split('.')) { hit = pool.find(v => v.name === seg); if (!hit) break; pool = hit.children ?? []; }
    } else hit = undefined;
    const fields = hit?.type === 'list' && hit.children?.length ? hit.children : null;
    add({
      name, source: 'Mehrfachausführung', description: `Aktuelles Element von «${coll || 'Sammlung'}»`,
      type: fields ? 'context' : 'any', label: fields ? 'Element' : '?',
      ...(fields ? { children: fields } : {}),
    });
  }
  return out;
}

/**
 * Ranges in the expression where missing values are allowed: the argument of
 * `is defined(…)` and the first one of `get or else(…, …)`. What `feelin` reports there
 * as «nicht gefunden» is exactly the safeguard — no warning.
 */
function guardedSpans(body: string): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  const code = body.replace(/"(?:[^"\\]|\\.)*"/g, m => '"'.padEnd(m.length - 1, '_') + '"');
  for (const m of code.matchAll(/\b(is\s+defined|get\s+or\s+else)\s*\(/g)) {
    const from = m.index! + m[0].length;
    let depth = 1;
    let to = code.length;
    for (let i = from; i < code.length; i++) {
      const c = code[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') { if (--depth === 0) { to = i; break; } }
      else if (c === ',' && depth === 1 && /^get/.test(m[1])) { to = i; break; }
    }
    spans.push({ from, to });
  }
  return spans;
}

export interface FeelCheck {
  issues: FeelIssue[];
  /** Type of the result — null if it cannot be evaluated */
  result: FeelType | null;
}

/**
 * Check a mapping value. `vars` = the process variables; without them only
 * the syntax is checked (outputs point to the result of the service, not
 * to the process). `expected` = what the target field requires.
 */
/** A fixed text must be a value of the selection — for a fixed case exactly this one. */
function enumValueIssues(body: string, expected: ExpectedType | null): FeelIssue[] {
  const literal = /^"((?:[^"\\]|\\.)*)"$/.exec(body)?.[1];
  if (!expected?.values?.length || literal == null || expected.values.includes(literal)) return [];
  return [{
    level: 'error',
    text: expected.values.length === 1
      ? `«${expected.label}» hat nur den Wert «${expected.values[0]}».`
      : `«${literal}» ist kein Wert von ${expected.label} — erlaubt: ${expected.values.join(', ')}.`,
  }];
}

export function checkFeel(expression: string, vars: VarNode[] | null, expected: ExpectedType | null = null): FeelCheck {
  const source = expression.trimStart().slice(1).trim();
  // `feelin` does not know the notation `` `mein-name` ``: the name is replaced by
  // a placeholder that carries the same value in the context
  const aliases = new Map<string, string>();
  const parts = source.split(/("(?:[^"\\]|\\.)*")/);
  const body = parts.map((part, i) => i % 2 ? part : part.replace(/`([^`]+)`/g, (_, name: string) => {
    const alias = `__q${aliases.size}`;
    aliases.set(alias, name);
    return alias;
  })).join('').trim();
  const shown = (msg: string): string => msg.replace(/__q\d+/g, a => aliases.get(a) ?? a);
  if (aliases.size && vars) {
    vars = [...vars, ...[...aliases].flatMap(([alias, name]) => vars!.filter(v => v.name === name).map(v => ({ ...v, name: alias })))];
  }
  if (!body) return { issues: [{ level: 'error', text: 'Nach «=» fehlt der FEEL-Ausdruck.' }], result: null };
  // `liste[0]` is always null in FEEL — lists count from 1
  if (/\[\s*0\s*\]/.test(body.replace(/"(?:[^"\\]|\\.)*"/g, '""'))) {
    return { issues: [{ level: 'error', text: 'Index [0] gibt es in FEEL nicht — Listen zählen ab 1, das erste Element ist [1].' }], result: null };
  }

  let value: unknown;
  let warnings: { type: string; message: string; position: { from: number; to: number } }[];
  try {
    const r = evaluate(body, { ...CAMUNDA_FUNCTIONS, ...(vars ? sampleContext(vars) : {}) });
    value = r.value;
    warnings = r.warnings;
  } catch (e) {
    if (e instanceof FeelSyntaxError) {
      const at = e.position?.from ?? 0;
      return { issues: [{ level: 'error', text: `Kein gültiges FEEL — Fehler an Position ${at + 1}${at >= body.length ? ' (Ausdruck unvollständig)' : ''}.` }], result: null };
    }
    return { issues: [{ level: 'error', text: `Kein gültiges FEEL: ${e instanceof Error ? e.message : String(e)}` }], result: null };
  }

  const issues: FeelIssue[] = [];
  if (!vars) return { issues: issues.length ? issues : enumValueIssues(body, expected), result: feelType(value) };

  const unknown = touchesUnknown(body, vars) || /\bfrom\s+json\s*\(/.test(body);
  const guarded = guardedSpans(body);
  // `if is defined(x) and x != null …` — the second `x` is guarded, even if it is missing
  const guardedNames = new Set([...body.matchAll(/\b(?:is\s+defined|get\s+or\s+else)\s*\(\s*([A-Za-z_]\w*)/g)].map(m => m[1]));
  let pathFailed = false;
  for (const w of warnings) {
    if (guarded.some(g => w.position.from >= g.from && w.position.to <= g.to)) continue;
    if (w.type === 'NO_VARIABLE_FOUND' && guardedNames.has(quoted(w.message))) { pathFailed = true; continue; }
    switch (w.type) {
      case 'NO_VARIABLE_FOUND': {
        const raw = quoted(w.message);
        const name = shown(raw);
        const re = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // feelin also reports names like «??»
        // feelin reports an unknown function first as a variable
        if (warnings.some(x => x.type === 'NO_FUNCTION_FOUND' && x.position.from === w.position.from)) {
          issues.push({ level: 'error', text: `Funktion «${name}» gibt es nicht.` });
        } else if (new RegExp(`\\b(?:for|some|every)\\s+${re}\\s+in\\b[^\\]]*\\[[^\\]]*(?<![\\w.])${re}\\s*\\.`).test(body)) {
          // `for i in items[i.active = true]` — the loop variable only applies after the `in`
          issues.push({ level: 'error', text: `«${name}» ist im Filter der Sammlung noch nicht gebunden — dort heisst das Element «item» (oder man schreibt das Feld direkt: «items[active = true]»).` });
        } else if (name === 'processInstanceKey') {
          // the old name from Camunda 8 — Orchescala now sets its own ID engine-agnostically
          issues.push({ level: 'error', text: '«processInstanceKey» ist der alte Name — der InitWorker setzt heute «processInstanceId».' });
        } else {
          issues.push({ level: 'error', text: `Variable «${name}» ist nicht bekannt — weder als Prozessvariable noch im Ergebnis.` });
        }
        pathFailed = true;
        break;
      }
      case 'NO_CONTEXT_ENTRY_FOUND':
      case 'NO_PROPERTY_FOUND': {
        const chain = chainBefore(body, w.position.from);
        // type unknown or Map — no verdict, not even about the result
        if (chain && openOnPath(vars, chain)) { pathFailed = true; break; }
        // `liste[item.feld = …]`: `item` is an element of the filtered list — if its
        // elements are not known (JSON, list without known fields), there is no verdict
        if (chain?.[0] === 'item') {
          const elements = filteredElements(body, w.position.from, vars);
          if (elements === null || openOnPath(elements, chain.slice(1))) { pathFailed = true; break; }
        }
        if (pathFailed && w.type === 'NO_PROPERTY_FOUND') break; // follow-up error on null
        const key = shown(quoted(w.message));
        const prefix = /([A-Za-z_][\w]*(?:\s*\.\s*[A-Za-z_][\w]*)*)\s*\.\s*$/.exec(body.slice(0, w.position.from))?.[1]?.replace(/\s/g, '');
        const text = prefix ? `Pfad «${shown(prefix)}.${key}» gibt es nicht — «${shown(prefix)}» hat kein Feld «${key}».` : `Feld «${key}» gibt es nicht.`;
        // the same path several times in the expression — reporting it once is enough
        if (!issues.some(i => i.text === text)) issues.push({ level: 'error', text });
        pathFailed = true;
        break;
      }
      case 'NO_FUNCTION_FOUND':
        break; // already reported via NO_VARIABLE_FOUND
      case 'INVALID_TYPE':
      case 'NOT_COMPARABLE':
      case 'INVALID_ARGUMENTS':
        if (unknown || pathFailed) break;
        issues.push({ level: 'error', text: `Typen passen nicht zusammen: ${shown(w.message)}` });
        break;
      default:
        issues.push({ level: 'warn', text: shown(w.message) });
    }
  }

  const result = feelType(value);
  // An optional value (without default) on a required field: the example values
  // are never null, hence here on the path itself — `= client.address.zip`
  if (!issues.length && expected && !expected.accepts.includes('nil') && !unknown && !pathFailed) {
    const opt = optionalOnPath(body, vars);
    if (opt) {
      issues.push({
        level: 'warn',
        text: `«${opt.path}» ist optional (${opt.label}) — «${expected.label}» verlangt aber einen Wert. Vorgabe setzen oder absichern (\`if … != null then … else …\`).`,
      });
    }
  }
  if (!issues.length && expected && !unknown && !pathFailed) {
    if (!expected.accepts.includes(result)) {
      const soll = expected.accepts.filter(t => t !== 'nil').map(t => FEEL_TYPE_LABEL[t]).join(' oder ');
      issues.push({
        level: result === 'nil' ? 'warn' : 'error',
        text: result === 'nil'
          ? `Ergebnis ist null — das Feld «${expected.label}» ist aber nicht optional.`
          : `Ergebnis ist ${FEEL_TYPE_LABEL[result]}, das Feld erwartet ${soll} (${expected.label}).`,
      });
    }
  }
  if (!issues.length) issues.push(...enumValueIssues(body, expected));
  return { issues, result: unknown || pathFailed ? null : result };
}

// ── Completion ───────────────────────────────────────────────────────────────

export interface Completion {
  /** what is inserted */
  insert: string;
  /** Variable or field — missing for functions and keywords */
  node?: VarNode;
  /** Function or keyword with explanation */
  doc?: FeelDoc;
  /** full path for display */
  path: string;
  /** Characters the cursor jumps back after inserting (into the parenthesis) */
  back?: number;
}

export interface CompletionResult {
  from: number;
  to: number;
  items: Completion[];
}

/**
 * Suggestions for the path under the cursor: `client.addr|` → the fields of
 * `client` that start with `addr`. Outside a FEEL expression (no
 * `=`) or inside a string there are none.
 */
export function completions(text: string, cursor: number, vars: VarNode[]): CompletionResult | null {
  if (!isFeel(text)) return null;
  const eq = text.indexOf('=');
  if (cursor <= eq) return null;
  const before = text.slice(0, cursor);
  // inside a string? (odd number of quotes before)
  if ((before.slice(eq + 1).match(/"/g)?.length ?? 0) % 2 === 1) return null;
  const m = /([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*\.)?([A-Za-z_][\w]*)?$/.exec(before);
  if (!m) return null;
  const [, chain, partial = ''] = m;
  // after `=` without a token: only if not in the middle of something else (e.g. `1|`)
  if (!chain && !partial && /[\w"\])]$/.test(before)) return null;
  // do not complete keywords and function calls
  if (!chain && partial && /^(if|then|else|for|in|return|and|or|not|null|true|false|some|every|satisfies|between|function|instance|of)$/.test(partial)) return null;

  let pool: VarNode[] = vars;
  if (chain) {
    for (const seg of chain.slice(0, -1).split('.')) {
      const hit = pool.find(v => v.name === seg);
      if (!hit) return null;
      if (hit.type === 'any' || hit.open) return null;
      pool = hit.children ?? [];
    }
  }
  const needle = partial.toLowerCase();
  const items: Completion[] = pool
    .filter(v => v.name.toLowerCase().startsWith(needle) && v.name !== partial)
    .concat(needle ? pool.filter(v => !v.name.toLowerCase().startsWith(needle) && v.name.toLowerCase().includes(needle)) : [])
    .map(node => ({ insert: node.name, node, path: `${chain ?? ''}${node.name}` }));

  // Functions and keywords: only outside a path and only from the
  // first letter on. Names of several words (`upper case`) are recognised
  // even when the first word is already typed: what counts is the longest end
  // of the typed text with which a name begins.
  let from = cursor - partial.length;
  if (!chain && partial) {
    const words = /((?:[A-Za-z_]\w*\s+){0,3}[A-Za-z_]\w*)$/.exec(before)?.[1]?.split(/\s+/) ?? [partial];
    let typed = partial;
    for (let n = words.length; n >= 1; n--) {
      const t = words.slice(-n).join(' ').toLowerCase();
      if (FEEL_DOCS.some(d => d.name.startsWith(t))) { typed = words.slice(-n).join(' '); break; }
    }
    const t = typed.toLowerCase();
    // a function already named the same stays — `string` next to `string join`
    const docs = FEEL_DOCS.filter(d => d.name.startsWith(t) && (d.name !== typed || d.kind === 'function'));
    // several words typed: only functions fit, no variables
    if (docs.length && typed !== partial) { from = cursor - typed.length; items.length = 0; }
    items.push(...docs.map(doc => ({ insert: doc.insert, doc, path: doc.name, back: doc.back })));
  }
  if (!items.length) return null;
  return { from, to: cursor, items };
}

// ── Colouring ────────────────────────────────────────────────────────────────

export type FeelTokenKind = 'variable' | 'string' | 'feel' | 'comment' | 'plain';
export interface FeelToken { text: string; kind: FeelTokenKind }

const DOC_NAMES = FEEL_DOCS.map(d => d.name).sort((a, b) => b.length - a.length);
const DOC_KIND = new Map(FEEL_DOCS.map(d => [d.name, d.kind]));

/**
 * Split the expression into pieces that the input field colours: strings
 * (green), variables and their paths (blue), FEEL itself — functions and
 * keywords — (violet). Everything else stays as it is.
 */
export function tokenizeFeel(text: string, vars: VarNode[]): FeelToken[] {
  const names = new Set(vars.map(v => v.name));
  const out: FeelToken[] = [];
  const push = (t: string, kind: FeelTokenKind) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += t; else out.push({ text: t, kind });
  };
  let i = 0;
  let afterDot = false;
  while (i < text.length) {
    const rest = text.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^"(?:[^"\\]|\\.)*"?/.exec(rest))) { push(m[0], 'string'); i += m[0].length; afterDot = false; continue; }
    if ((m = /^(?:\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))/.exec(rest))) { push(m[0], 'comment'); i += m[0].length; continue; }
    if ((m = /^`[^`]*`?/.exec(rest))) { push(m[0], names.has(m[0].replace(/`/g, '')) || afterDot ? 'variable' : 'plain'); i += m[0].length; afterDot = false; continue; }
    if ((m = /^[A-Za-z_]\w*/.exec(rest))) {
      const word = m[0];
      const prev = text[i - 1];
      const inPath = afterDot;
      // function words and keywords, also with spaces in the name (`upper case`)
      const doc = inPath || (prev && /[\w]/.test(prev)) ? undefined
        : DOC_NAMES.find(n => n.startsWith(word) && rest.startsWith(n) && !/\w/.test(rest[n.length] ?? ' '));
      const call = /^\s*\(/.test(rest.slice((doc ?? word).length));
      if (doc && (call || DOC_KIND.get(doc) === 'keyword' || !names.has(doc))) {
        push(doc, 'feel'); i += doc.length; afterDot = false; continue;
      }
      push(word, inPath || names.has(word) ? 'variable' : 'plain');
      i += word.length; afterDot = false; continue;
    }
    if (rest[0] === '.' && text[i + 1] !== '.' && /[\w`]/.test(text[i - 1] ?? '')) { push('.', 'plain'); i++; afterDot = true; continue; }
    push(rest[0], 'plain'); i++;
    if (!/\s/.test(rest[0])) afterDot = false;
  }
  return out;
}

const FEEL_WORDS = new Set([
  'true', 'false', 'null', 'if', 'then', 'else', 'for', 'in', 'return', 'some', 'every', 'satisfies',
  'and', 'or', 'not', 'between', 'instance', 'of', 'function', 'external', 'partial', 'item',
]);

/**
 * The variables a FEEL expression accesses — the first name part
 * of a path (`consultant.name` → `consultant`), in order of
 * appearance. Not included: text in quotes, function names
 * (`upper case(x)`), path parts after the dot, keywords and the
 * loop variables of `for`/`some`/`every`. Also applies to expressions with
 * `if … then … else`, filters (`items[price > 1]`) and contexts.
 */
export function referencedVariables(expression: string): string[] {
  if (!isFeel(expression)) return [];
  const names: string[] = [];
  // replace text with whitespace, keep the `name` notation in backticks as names
  const quoted: string[] = [];
  const code = expression.trimStart().slice(1)
    .replace(/"(?:[^"\\]|\\.)*"/g, ' ')
    .replace(/`([^`]+)`/g, (_, n: string) => ` __bq${quoted.push(n) - 1} `);
  const bound = new Set<string>();
  for (const m of code.matchAll(/\b(?:for|some|every)\s+([A-Za-z_][\w]*)\s+in\b/g)) bound.add(m[1]);
  for (const m of code.matchAll(/,\s*([A-Za-z_][\w]*)\s+in\b/g)) bound.add(m[1]);
  // keys of a context (`{ a: x }`) are not variables
  for (const m of code.matchAll(/[{,]\s*([A-Za-z_][\w]*)\s*:/g)) bound.add(m[1]);
  for (const m of code.matchAll(/(?<![\w.])([A-Za-z_][\w]*)(?![\w])/g)) {
    const name = m[1].replace(/^__bq(\d+)$/, (_, i: string) => quoted[+i]);
    const rest = code.slice(m.index! + name.length);
    if (FEEL_WORDS.has(name) || bound.has(m[1])) continue;
    if (/^\s*\(/.test(rest)) continue;                     // function call
    if (/^\s+[A-Za-z_]/.test(rest) && !/^\s+(?:in|and|or|then|else|return|satisfies|instance|between|of)\b/.test(rest)) continue; // part of a function name with spaces
    if (!names.includes(name)) names.push(name);
  }
  return names;
}
