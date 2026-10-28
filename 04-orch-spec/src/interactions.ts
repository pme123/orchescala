// Derive interactions from the flow.
//
// Which step talks to the outside — and thus needs its own object
// with `In` and/or `Out`?
//
//  · **User task** — always. `val name` is the BPMN element ID.
//  · **Own worker** — a service task whose topic belongs to this process
//    (`<prozess>-<Name>`). Foreign services have their domain in their own
//    project; they don't belong here.
//  · **Signal / message** — throwing events with a signal or
//    message definition.
//
// The **init worker** is excluded: its topic is the process itself, and
// its result is the `InitIn` — the generator creates that anyway.

import type {
  DomainField, DomainType, Field, Interaction, InteractionKind, Mapping, Model,
  ProcessSpec, ServiceDef, ServiceParam, Step, TimerSpec, TypeDef,
} from './types.ts';
import { INTERACTION_META } from './types.ts';
import { allSteps, isInitWorker, timerVariable } from './bpmn.ts';
import { enumHasCase, exampleOf, isFixedCaseDefault, splitEnumCase, typeShape } from './scalaTypes.ts';
import { domainRef, parseDomainRef, parseServiceRef } from './serviceTypes.ts';
import { SCALA_TYPES } from './types.ts';
import { uid } from './util.ts';
import { catalogIndex } from './orchescalaTypes.ts';

const upper = (s: string) => s.replace(/^(.)/, c => c.toUpperCase());

const UMLAUTE: Record<string, string> = {
  ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss',
  à: 'a', â: 'a', é: 'e', è: 'e', ê: 'e', î: 'i', ï: 'i', ô: 'o', û: 'u', ç: 'c',
};

/**
 * «Depot Activity Unlock Advisor» → `DepotActivityUnlockAdvisor`.
 * Umlauts are transliterated, otherwise «Rückbestätigung» would end up
 * as `RCkbestTigung`.
 */
export function pascal(text: string): string {
  const ascii = text.replace(/[äöüÄÖÜßàâéèêîïôûç]/g, c => UMLAUTE[c] ?? c);
  const parts = ascii.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!parts.length) return '';
  return parts.map(p => (/^[A-Z0-9]+$/.test(p) ? p : upper(p))).join('');
}

/**
 * Suggestion for the Scala object name of an interaction.
 *
 * If the object is already in the domain, its name applies — the topic alone
 * does not reveal it: the worker with the topic
 * `…createPensionProductV1.CreatePensionProduct` is called `ComposePensionProduct`,
 * and `CreatePensionProduct` is the process itself.
 */
export function suggestName(step: Step, kind: InteractionKind, processId: string, model: Model | null = null): string {
  // DMN decision: the part of the decisionId after the process ID — `…orderCardV1-SubStatusKeyDmn` → `SubStatusKeyDmn`
  if (kind === 'decision' && step.topic) {
    const bekannt = (model?.domainTypes ?? []).find(t => t.keyName === 'decisionId' && t.key?.toLowerCase() === step.topic!.toLowerCase() && t.owner);
    if (bekannt) return bekannt.owner!;
    const tail = pascal(step.topic.slice(processId.length).replace(/^[-.]/, ''));
    if (tail) return /Dmn$/.test(tail) ? tail : `${tail}Dmn`;
  }
  if (kind === 'customTask' && step.topic) {
    const bekannt = (model?.domainTypes ?? []).find(t => t.topicName === step.topic && t.owner);
    if (bekannt) return bekannt.owner!;
    // `globex-depot-openPensionAccount3aV1-EvalNextPortfolioIdSuffix`
    const tail = step.topic.slice(processId.length).replace(/^[-.]/, '');
    // if the topic only carries the process name, it is of no help
    if (tail && pascal(tail) !== pascal(processId.split(/[-.]/).pop() ?? '')) return pascal(tail);
  }
  const base = pascal(step.name).replace(/Task$/, '');
  return `${base}${INTERACTION_META[kind].suffix}`;
}

/** The key: `val name` / `val topicName` / `val messageName`. */
function keyOf(step: Step, kind: InteractionKind): string {
  if (kind === 'userTask') return step.id;
  if (kind === 'customTask' || kind === 'decision') return step.topic ?? step.id;
  return step.name;
}

/** Which kind of interaction does this step belong to — or to none? */
export function interactionKind(step: Step, processId: string): InteractionKind | null {
  if (step.kind === 'user') return 'userTask';
  // DMN decision of this process (`decisionRef` starts with the process ID) —
  // a foreign decision has its domain elsewhere, it stays a catalog entry
  if (step.kind === 'rule') {
    return step.topic && processId && step.topic.toLowerCase().startsWith(processId.toLowerCase()) ? 'decision' : null;
  }
  if (step.kind === 'service') {
    // only the workers of this process; foreign services have their own domain
    if (!step.topic || !processId) return null;
    if (isInitWorker(step, processId)) return null;
    if (!step.topic.startsWith(processId)) return null;
    return 'customTask';
  }
  // A received message is described by the RE with its `In` — the
  // throwing side likewise, both use the same DSL. This also applies to a
  // message start event: the process start itself is excluded,
  // its fields are in the process's `In` (see `missingInteractions`).
  if (step.kind !== 'receive' && step.eventKind !== 'message' && !(step.eventKind === 'signal' && step.eventDirection === 'throw')) return null;
  // only the messages and signals of this process — as with the workers: a
  // name of another process (`acme-bpmn-stopEscalation-…`, `acme-cancel-…`
  // from a pattern) is wiring, its object lives there
  if (step.messageName && processId && !step.messageName.startsWith(processId.replace(/V\d+$/, ''))) return null;
  return step.eventKind === 'signal' ? 'signal' : 'message';
}

export interface Suggestion {
  step: Step;
  kind: InteractionKind;
  name: string;
  key: string;
}

/** All steps that need an interaction and don't have one yet. */
/**
 * Steps without their own object: whatever belongs to a pattern — also everything in a
 * pattern block (event subprocess «Einmalige Ausführung») — and a message with
 * the name of the process itself: it brings its `In` (a second start with the same
 * businessKey while the process is running).
 */
export function wiringSteps(spec: Pick<ProcessSpec, 'steps' | 'processId'>): Set<string> {
  const out = new Set<string>();
  const processId = spec.processId ?? '';
  const visit = (steps: Step[], inPattern: boolean) => {
    for (const s of steps) {
      const here = inPattern || !!s.pattern;
      if (here || (!!processId && s.messageName === processId)) out.add(s.id);
      visit([...(s.children ?? []), ...(s.branches ?? []).flatMap(b => b.steps), ...(s.errors ?? []).flatMap(e => e.steps ?? [])], here);
    }
  };
  visit(spec.steps ?? [], false);
  return out;
}

/**
 * A prepared interaction (draft) on such a step is dropped — together with
 * its classes. Older imports created them (`CompensateIfProcessME`).
 */
export function withoutWiringInteractions<T extends Pick<ProcessSpec, 'steps' | 'processId' | 'interactions' | 'types'>>(spec: T): T {
  const wiring = wiringSteps(spec);
  const gone = new Set((spec.interactions ?? []).filter(i => i.status === 'draft' && wiring.has(i.stepId)).map(i => i.id));
  if (!gone.size) return spec;
  return {
    ...spec,
    interactions: (spec.interactions ?? []).filter(i => !gone.has(i.id)),
    types: (spec.types ?? []).filter(t => !(t.interactionId && gone.has(t.interactionId))),
  };
}

export function missingInteractions(spec: ProcessSpec, model: Model | null = null): Suggestion[] {
  const processId = spec.processId ?? '';
  const known = new Set((spec.interactions ?? []).map(i => i.stepId));
  // The start of the process is not a message of its own — that is its `In`.
  const startId = spec.steps.find(s => s.kind === 'start')?.id;
  const wiring = wiringSteps(spec);
  const out: Suggestion[] = [];
  for (const step of allSteps(spec.steps)) {
    // a step that belongs to a pattern is wiring — no object of its own
    if (step.kind === 'goto' || known.has(step.id) || step.id === startId || wiring.has(step.id)) continue;
    const kind = interactionKind(step, processId);
    if (!kind) continue;
    out.push({ step, kind, name: suggestName(step, kind, processId, model), key: keyOf(step, kind) });
  }
  return out;
}

/** Turn a suggestion into an interaction. */
export function toInteraction(s: Suggestion): Interaction {
  return {
    id: uid('ia'),
    stepId: s.step.id,
    kind: s.kind,
    name: s.name,
    key: s.key,
    ...(s.step.description ? { descr: s.step.description } : {}),
    // DMN decision: the result form from the BPMN (`camunda:mapDecisionResult`)
    ...(s.kind === 'decision' && s.step.decisionResult ? { decisionResult: s.step.decisionResult } : {}),
    status: 'draft',
  };
}

/**
 * The fields of the `InitIn` — the outputs of the init worker. It is not in the
 * flow (wiring, not business logic); the import stores its outputs
 * with the process.
 */
export function initOutputs(spec: ProcessSpec): Mapping[] {
  return (spec.initOutputs ?? []).filter(o => !o.disabled);
}

/** The timers of the events and boundary events — with their variable and default */
export function timerSettings(spec: ProcessSpec): Array<{ name: string; timerKind: TimerSpec['kind']; default?: string }> {
  const found = new Map<string, { timerKind: TimerSpec['kind']; default?: string }>();
  const add = (t: TimerSpec | undefined) => {
    const name = timerVariable(t);
    if (!name || !t) return;
    const was = found.get(name);
    if (!was || (!was.default && t.default?.trim())) found.set(name, { timerKind: t.kind, ...(t.default?.trim() ? { default: t.default.trim() } : {}) });
  };
  for (const step of allSteps(spec.steps)) {
    add(step.timer);
    for (const e of step.errors ?? []) add(e.timer);
  }
  return [...found].map(([name, v]) => ({ name, ...v }));
}

/**
 * Names contained in loop settings: `Tried ${maxOpenAccount} times?`
 * and `wait ${timerWaitOpenAccount}` become the fields of the `InConfig` — plus the
 * variables of the timers on events (see timerSettings), with their default.
 */
export function loopSettings(spec: ProcessSpec): Array<{ name: string; kind: 'timer' | 'max' | 'counter'; default?: string; timerKind?: TimerSpec['kind'] }> {
  const found = new Map<string, 'timer' | 'max' | 'counter'>();
  for (const step of allSteps(spec.steps)) {
    if (!step.loop) continue;
    for (const text of [step.loop.condition, step.loop.maxAttempts, step.loop.waitFor]) {
      for (const m of (text ?? '').matchAll(/\$\{([A-Za-z_]\w*)\}/g)) {
        const name = m[1];
        const kind = /^timer/i.test(name) ? 'timer' : /^counter/i.test(name) ? 'counter' : /^max/i.test(name) ? 'max' : null;
        if (kind) found.set(name, kind);
      }
    }
  }
  // every `max…` has a `counter…` — Orchescala uses it to count the attempts
  for (const [name, kind] of [...found]) {
    if (kind !== 'max') continue;
    const counter = `counter${name.slice(3)}`;
    if (!found.has(counter)) found.set(counter, 'counter');
  }
  // the timers of the events: each variable a constant in the InConfig, with its default
  const timers = new Map(timerSettings(spec).map(t => [t.name, t]));
  for (const name of timers.keys()) if (!found.has(name)) found.set(name, 'timer');
  return [...found].map(([name, kind]) => {
    const t = timers.get(name);
    return { name, kind, ...(t?.default ? { default: t.default } : {}), ...(t ? { timerKind: t.timerKind } : {}) };
  });
}

/** Steps whose result can be overridden for tests (`…Mock`). */
export function mockableSteps(spec: ProcessSpec): Step[] {
  // not the init worker: there the process itself is mocked (outputMock)
  // nor a step in a pattern's block: the pattern fills it
  return allSteps(spec.steps).filter(s => (s.kind === 'service' || s.kind === 'call') && !isInitWorker(s, spec.processId) && !s.pattern);
}

/**
 * The type for `InitIn`: the fields come from the outputs of the init worker.
 * New outputs are added, types already maintained stay — hence a
 * reconciliation instead of a rebuild.
 */
export function syncInitIn(spec: ProcessSpec): TypeDef[] | null {
  const outs = initOutputs(spec);
  if (!outs.length) return null;
  const types = spec.types ?? [];
  const existing = types.find(t => t.initIn);
  const have = new Map((existing?.fields ?? []).map(f => [f.name, f]));
  const fields: Field[] = outs.map(o => have.get(o.name) ?? {
    id: uid('f'),
    name: o.name,
    type: 'String',
    ...(o.description ? { description: o.description } : {}),
  });
  if (existing && existing.fields?.length === fields.length
      && fields.every((f, i) => existing.fields![i]?.name === f.name)) return null;
  const next: TypeDef = existing
    ? { ...existing, fields }
    : {
        id: uid('t'), name: 'InitIn', kind: 'case', initIn: true, status: 'draft',
        description: 'Die Prozessvariablen, die zu Beginn gesetzt werden. Die Felder kommen aus dem Prozess — die Typen hier pflegen.',
        fields,
      };
  return existing ? types.map(t => (t.initIn ? next : t)) : [...types, next];
}

// ── Classes of an interaction ────────────────────────────────────────────────

/** The catalog entry for a step — for user tasks via the ID. */
export function catalogEntry(step: Step, model: Model | null): ServiceDef | null {
  const services = model?.services ?? [];
  // decisions: the camunda:decisionRef in the BPMN and the reference from the
  // OpenAPI sometimes differ in upper/lower case
  const ref = step.kind === 'rule' ? step.topic?.toLowerCase() : undefined;
  return services.find(s =>
    (step.kind === 'user' && s.kind === 'user' && s.name === step.id)
    || (step.serviceId && s.id === step.serviceId)
    || (step.topic && (s.id === step.topic || s.topic === step.topic))
    || (ref && s.kind === 'rule' && s.id.toLowerCase() === ref)
    || (step.calledProcess && s.calledProcess === step.calledProcess))
    // a decision the catalog does not know (yet) — it is as old as
    // its last build — but the domain does: the entry from the domain object
    ?? (ref ? decisionFromDomain(ref, model) : null);
}

export interface ForeignOrigin {
  /** the domain object, e.g. `SubStatusAllDmn` */
  object: string;
  pkg: string;
  /** the project after the package convention: `acme.bpmn.domain…` → `acme-bpmn` */
  project: string;
}

/**
 * Where a foreign service of a step comes from: the domain object with its
 * key — `decisionId` (DMN), `topicName` (worker), `processName` (called
 * process). `null` if the domain does not know it.
 */
export function foreignOrigin(step: Step, model: Model | null): ForeignOrigin | null {
  const ref = step.topic?.toLowerCase();
  const hit = (model?.domainTypes ?? []).find(t => t.owner && (
    step.kind === 'rule' ? !!ref && t.keyName === 'decisionId' && t.key?.toLowerCase() === ref
      : step.kind === 'call' ? !!step.calledProcess && t.processName === step.calledProcess
        : !!step.topic && t.topicName === step.topic));
  if (!hit?.owner) return null;
  // the part before `.domain` (as a whole segment) — without it the package itself
  const m = /^(.*?)\.domain(\.|$)/.exec(hit.pkg);
  const project = m ? m[1].replace(/\./g, '-') : hit.pkg;
  return { object: hit.owner, pkg: hit.pkg, project };
}

/** A catalog entry from a domain object of kind Decision (`decisionId`, `In`, `Out`). */
function decisionFromDomain(ref: string, model: Model | null): ServiceDef | null {
  const types = model?.domainTypes ?? [];
  const hit = types.find(t => t.owner && t.keyName === 'decisionId' && t.key?.toLowerCase() === ref);
  if (!hit?.owner || !hit.key) return null;
  const member = (m: 'In' | 'Out') => types.find(t => t.owner === hit.owner && t.pkg === hit.pkg && t.name === `${hit.owner}.${m}`) ?? domainMember(hit.owner!, m, model);
  // no mandatory inputs: a decision reads its In directly from the process variables
  const params = (m: 'In' | 'Out'): ServiceParam[] => (member(m)?.fields ?? []).map(f => ({
    name: f.name,
    ...(f.description ? { description: f.description } : {}),
  }));
  return {
    id: hit.key, name: hit.owner, kind: 'rule', topic: hit.key,
    ...(hit.ownerDescr ? { description: hit.ownerDescr } : {}),
    inputs: params('In'), outputs: params('Out'),
    // not from the catalog — but from the project's domain
    fromDomain: true,
  };
}

/**
 * Create the `In` or `Out` of an interaction. If the catalog knows the fields
 * (from the OpenAPI), they come along with their description — otherwise an empty field.
 */
export function createMemberType(
  ia: Interaction,
  member: 'In' | 'Out',
  entry: ServiceDef | null,
  model: Model | null = null,
  ownPkg?: string,
): TypeDef {
  // If the type is already in the domain, that one applies — the **real**
  // Scala types are there. The catalog from the OpenAPI only knows names and meaning.
  // The object via the interaction's key, from its package — the name
  // alone matches in several processes
  const fromDomain = ownPkg != null
    ? originMember(interactionOrigin(ia, model, ownPkg), member, model)
    : domainMember(ia.name, member, model);
  const params = (member === 'In' ? entry?.inputs : entry?.outputs) ?? [];
  const fields: Field[] = fromDomain?.fields?.length
    ? fromDomain.fields.map(f => fieldFromScala(f, model, fromDomain.pkg))
    : params.length
      ? params.map(p => ({
          id: uid('f'),
          name: p.name,
          type: 'String',
          ...(p.description ? { description: p.description } : {}),
        }))
      : [{ id: uid('f'), name: '', type: 'String' }];
  return {
    id: uid('t'),
    name: `${ia.name}.${member}`,
    kind: 'case',
    interactionId: ia.id,
    status: 'draft',
    fields,
  };
}

/**
 * Set In or Out of an interaction to another type (`type In = OrderCardUT.In`) — or back to an
 * own class (`null`). The fields come from the target; this member's own class is dropped.
 * `type Out = In` in the same object: the member that points to the other keeps that one's class;
 * the member the other points to takes it along — the other follows its new type, or loses its
 * alias when this one has no type any more.
 */
export function withMemberAlias(spec: ProcessSpec, ia: Interaction, member: 'In' | 'Out', ref: string | null, model: Model | null): ProcessSpec {
  const types = spec.types ?? [];
  const interactions = spec.interactions ?? [];
  const keys = (m: 'In' | 'Out') => (m === 'In' ? { alias: 'inAlias', type: 'inTypeId' } as const : { alias: 'outAlias', type: 'outTypeId' } as const);
  const otherMember = member === 'In' ? 'Out' : 'In';
  const me = keys(member);
  const other = keys(otherMember);
  const pointsToOther = ia[me.alias] === `${ia.id}.${otherMember}`;
  const otherFollows = ia[other.alias] === `${ia.id}.${member}`;
  // `In = Out` while `Out = In` would be a cycle - nothing to change
  if (otherFollows && ref === `${ia.id}.${otherMember}`) return spec;
  const own = ia[me.type] && !pointsToOther ? types.find(t => t.id === ia[me.type] && t.interactionId === ia.id) : undefined;
  const rest = own ? types.filter(t => t.id !== own.id) : types;
  // a type of the catalog: its fields as a copy (for mappings and checks)
  const dom = ref?.startsWith('dom:') ? (model?.domainTypes ?? []).find(d => `dom:${d.id}` === ref) : undefined;
  const copy = dom ? aliasMemberType(ia, member, dom, model) : undefined;
  const dot = ref && !dom ? ref.lastIndexOf('.') : -1;
  const target = dot > 0 ? interactions.find(i => i.id === ref!.slice(0, dot)) : undefined;
  const targetId = copy ? copy.id : target ? (ref!.slice(dot + 1) === 'In' ? target.inTypeId : target.outTypeId) : undefined;
  const typeId = ref ? targetId : undefined;
  const follower = otherFollows
    ? (typeId ? { [other.type]: typeId } : { [other.alias]: undefined, [other.type]: undefined })
    : {};
  return {
    ...spec,
    types: copy ? [...rest, copy] : rest,
    interactions: interactions.map(i => (i.id === ia.id ? { ...i, [me.alias]: ref ?? undefined, [me.type]: typeId, ...follower } : i)),
  };
}

/**
 * In or Out as a type from the catalog (`type In = PostProcessOrderUT.Out`, see
 * Interaction.inAlias): its fields as a copy — for mappings and checks;
 * only the alias is exported.
 */
export function aliasMemberType(ia: Interaction, member: 'In' | 'Out', dom: DomainType, model: Model | null = null): TypeDef {
  const base = { id: uid('t'), name: `${ia.name}.${member}`, interactionId: ia.id, status: 'draft' as const, description: `= ${dom.name}` };
  const fields = (dom.fields ?? []).map(f => fieldFromScala(f, model, dom.pkg));
  if (dom.kind === 'enum' && (dom.cases?.length || dom.values?.length)) {
    const values = dom.cases?.length
      ? dom.cases.map(c => ({ name: c.name, fields: (c.fields ?? []).map(f => fieldFromScala(f, model, dom.pkg)) }))
      : (dom.values ?? []).map(name => ({ name }));
    return { ...base, kind: 'enum', ...(fields.length ? { fields } : {}), values };
  }
  return { ...base, kind: 'case', fields };
}

/**
 * What in the catalog is usable as In or Out: `X.In` / `X.Out` with fields or
 * cases — without the objects that are already interactions of this process
 * (those appear in the picker as `= X.In`).
 */
export function catalogMembers(model: Model | null, member: 'In' | 'Out', ownPkg: string, exclude: Set<string>): DomainType[] {
  return (model?.domainTypes ?? [])
    .filter(t => (t.kind === 'case' || t.kind === 'enum') && t.name.endsWith(`.${member}`) && t.owner
      && !(t.pkg === ownPkg && exclude.has(t.owner)))
    .sort((a, b) => Number(b.pkg === ownPkg) - Number(a.pkg === ownPkg) || a.name.localeCompare(b.name) || a.pkg.localeCompare(b.pkg));
}

// ── Take over fields from the domain ─────────────────────────────────────────


/**
 * Resolve a type name in the catalog. The order is crucial: an
 * **exact** name beats a member with the same ending (`Account` is the
 * schema type, not `GetAccount.Account`), and within that the
 * package the field comes from wins.
 */
export function resolveType(base: string, model: Model | null, pkg?: string): DomainType | null {
  // the types from `orchescala.domain` (`ProcessStatus`) always exist — even without a catalog;
  // looked up in the index instead of across the whole catalog (this runs on every keystroke)
  const index = catalogIndex(model?.domainTypes);
  const named = index.byName.get(base) ?? [];
  // `t.name.endsWith(".X.Out")`: such names all end in the same last part (`Out`)
  const suffixed = (index.byLast.get(base.slice(base.lastIndexOf('.') + 1)) ?? []).filter(t => t.name.endsWith(`.${base}`));
  const kandidaten = [
    (t: DomainType) => t.name === base && t.pkg === pkg,
    (t: DomainType) => t.name === base && !!pkg && t.pkg.startsWith(pkg.replace(/\.schema$/, '')),
    // what Orchescala brings without an import takes precedence over a type of the same name
    // from another project (`ProcessStatus`, not `…directActivation.ProcessStatus`)
    (t: DomainType) => t.name === base && (t.pkg === 'orchescala.domain' || /^\w+\.orchescala\.domain$/.test(t.pkg)),
    (t: DomainType) => t.name === base,
    (t: DomainType) => t.name.endsWith(`.${base}`) && t.pkg === pkg,
    (t: DomainType) => t.name.endsWith(`.${base}`),
  ];
  for (const [i, passt] of kandidaten.entries()) {
    // the first four require the exact name, the last two the ending
    const treffer = (i < 4 ? named : suffixed).find(passt);
    if (treffer) return treffer;
  }
  return null;
}

/**
 * Translate a Scala field into a field of the class builder: `Option[Seq[X]]`
 * becomes optional + multiple, `String :| ValidEmail` type + constraint,
 * and a reference to another type points to the catalog entry.
 */
export function fieldFromScala(p: DomainField, model: Model | null, pkg?: string): Field {
  const shape = typeShape(p.type);
  const scalar = (SCALA_TYPES as readonly string[]).includes(shape.base);
  let ref = scalar ? null : resolveType(shape.base, model, pkg);
  // `CustomDocContents.\`QI-Deklaration\`` — a case of an ADT enum
  let enumCase: string | undefined;
  if (!scalar && !ref) {
    const split = splitEnumCase(shape.base);
    const en = split ? resolveType(split.base, model, pkg) : null;
    if (split && enumHasCase(en, split.enumCase)) { ref = en; enumCase = split.enumCase; }
  }
  // In/Out of an interaction use no default: one from the constructor (a class without
  // `example`) is the example value
  const dflt = p.default && p.default !== 'None' && !isFixedCaseDefault(enumCase, p.default) ? p.default : undefined;
  const example = exampleOf(p) ?? (dflt ? exampleOf({ type: p.type, example: dflt }) : undefined);
  return {
    id: uid('f'),
    name: p.name,
    type: scalar ? shape.base : ref ? domainRef(ref.id) : shape.base,
    ...(shape.optional ? { optional: true } : {}),
    ...(shape.collection ? { collection: true } : {}),
    ...(shape.map ? { map: true } : {}),
    ...(enumCase ? { enumCase } : {}),
    ...(shape.constraint ? { constraint: shape.constraint } : {}),
    ...(p.description ? { description: p.description } : {}),
    ...(p.descriptionExpr ? { descriptionExpr: p.descriptionExpr } : {}),
    ...(example ? { example } : {}),
  };
}

/** The kind of the domain object according to the DSL — as the catalog holds it (`DomainType.dsl`). */
const DSL_OF: Record<InteractionKind, string> = {
  userTask: 'UserTask', customTask: 'CustomTask', signal: 'SignalEvent', message: 'MessageEvent', decision: 'Decision',
};

/** `${execution.getProcessInstanceId()}` (BPMN) and `${SignalEvent.Dynamic_ProcessInstance}` (domain) are the same placeholder. */
const normKey = (k: string) => k.replace(/\$\{[^}]*\}/g, '{}');

/** Where the object of an interaction comes from. */
export interface InteractionOrigin {
  /** object in the catalog — missing for a new interaction */
  owner?: string;
  pkg?: string;
  /** from another domain (other process, other project): referenced, not exported */
  foreign: boolean;
  /** the key is in several foreign packages — counts as new, needs checking */
  ambiguous?: string[];
}

/**
 * The origin of an interaction — looked up via its **key** (topic of the
 * worker, ID of the user task, `messageName`), not via the name: names
 * like `PostProcessOrderUT` exist in several processes. Only what is
 * not yet in the catalog or is in the process's package (`ownPkg`) is exported.
 *
 * - if `ia.pkg` is set (remembered on creation), that applies
 * - a match in the own package: the own object
 * - a key with a placeholder (`acme-cancel-${…}`) applies per process instance —
 *   each process defines it itself: without its own match, new
 * - exactly one foreign match: referenced; several: new, but needs checking
 */
export function interactionOrigin(
  ia: Pick<Interaction, 'kind' | 'key' | 'pkg'>,
  model: Model | null,
  ownPkg: string,
): InteractionOrigin {
  const key = ia.key?.trim() ?? '';
  const dsl = DSL_OF[ia.kind];
  const hits = new Map<string, DomainType>(); // one object per package
  for (const t of model?.domainTypes ?? []) {
    if (!t.owner || t.dsl !== dsl) continue;
    const matches = ia.kind === 'customTask' ? t.topicName === key
      // the decisionRef in the BPMN and the decisionId of the domain sometimes differ in spelling
      : ia.kind === 'decision' ? !!t.key && t.key.toLowerCase() === key.toLowerCase()
        : !!t.key && normKey(t.key) === normKey(key);
    if (key && matches && !hits.has(t.pkg)) hits.set(t.pkg, t);
  }
  if (ia.pkg) return { owner: hits.get(ia.pkg)?.owner, pkg: ia.pkg, foreign: ia.pkg !== ownPkg };
  const own = hits.get(ownPkg);
  if (own) return { owner: own.owner, pkg: ownPkg, foreign: false };
  if (key.includes('${')) return { foreign: false };
  const foreign = [...hits.values()];
  if (foreign.length === 1) return { owner: foreign[0].owner, pkg: foreign[0].pkg, foreign: true };
  return foreign.length ? { foreign: false, ambiguous: foreign.map(t => t.pkg).sort() } : { foreign: false };
}

/** A new interaction remembers the package of its object in the catalog (see `Interaction.pkg`). */
export function withOrigin(ia: Interaction, model: Model | null, ownPkg: string): Interaction {
  if (ia.pkg) return ia;
  const { pkg } = interactionOrigin(ia, model, ownPkg);
  return pkg ? { ...ia, pkg } : ia;
}

/** `In` / `Out` of the object of an interaction — from exactly its package. */
export function originMember(origin: InteractionOrigin, member: 'In' | 'Out', model: Model | null): DomainType | null {
  if (!origin.owner || !origin.pkg) return null;
  return (model?.domainTypes ?? []).find(t => t.pkg === origin.pkg && t.name === `${origin.owner}.${member}`) ?? null;
}

/** The domain type for an object member, e.g. `CheckDuplicatesUT.In`. */
export function domainMember(name: string, member: string, model: Model | null): DomainType | null {
  return (model?.domainTypes ?? []).find(t => t.name === `${name}.${member}`) ?? null;
}

/** The step an interaction belongs to. */
export function interactionStep(spec: ProcessSpec, ia: Interaction): Step | null {
  return allSteps(spec.steps).find(s => s.id === ia.stepId) ?? null;
}

/**
 * Resolve bare type names afterwards. If the catalog did not know a type at
 * import, its name stayed in the field — `ProcessCallOrigin` or
 * `CustomDocContents.\`QI-Deklaration\``. If the catalog now knows it
 * unambiguously, it becomes the reference (including the case), just as the import
 * would have done. Returns the changed types — or null if there was nothing
 * to do.
 */
export function healLooseTypes(types: TypeDef[], model: Model | null): TypeDef[] | null {
  const all = model?.domainTypes ?? [];
  if (!all.length) return null;
  const own = new Set(types.map(t => t.id));
  const unique = (name: string): DomainType | null => {
    const hits = all.filter(t => t.name === name);
    return hits.length === 1 ? hits[0] : null;
  };
  const heal = (f: Field): Field | null => {
    const t = f.type;
    if (!t || own.has(t) || parseDomainRef(t) || parseServiceRef(t) || (SCALA_TYPES as readonly string[]).includes(t)) return null;
    const direkt = unique(t);
    if (direkt) return { ...f, type: domainRef(direkt.id) };
    // `Enum.\`Fall\`` or `Enum.Fall` — the case belongs to the field, the reference to the enum
    const split = splitEnumCase(t);
    if (!split) return null;
    const en = unique(split.base);
    if (enumHasCase(en, split.enumCase)) return { ...f, type: domainRef(en!.id), enumCase: split.enumCase };
    return null;
  };
  let changed = false;
  const out = types.map(t => {
    let touched = false;
    const fields = (t.fields ?? []).map(f => { const h = heal(f); if (h) touched = true; return h ?? f; });
    const values = (t.values ?? []).map(v => {
      if (!v.fields?.length) return v;
      const vf = v.fields.map(f => { const h = heal(f); if (h) touched = true; return h ?? f; });
      return touched ? { ...v, fields: vf } : v;
    });
    if (!touched) return t;
    changed = true;
    return { ...t, ...(t.fields ? { fields } : {}), ...(t.values ? { values } : {}) };
  });
  return changed ? out : null;
}
