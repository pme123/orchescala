// Stage B of the AI mode: Claude changes a process as a draft (E19) - its structure in the BPMN
// (bpmnEdit.ts), its details in the spec. After every change of the diagram the spec follows it the
// way it does after a change by hand: import, merge with the spec (mergeSpec keeps the texts by the
// ID of the step), the findings of the spec (collectFindings) - the same checks as in the designer.
import { allSteps, importBpmn, mergeSpec } from '../bpmn';
import { engineLabel } from '../engineLabels';
import { collectFindings, PROCESS_FINDINGS } from '../findings';
import { targetsOf, type Targets } from '../pages/designer/model';
import { checkTypes, indexTypes } from '../scala';
import { SCALA_TYPES, type EnumValue, type Field, type Model, type ProcessSpec, type Step, type TypeDef } from '../types';
import { domainRef } from '../serviceTypes';
import { uid } from '../util';
import {
  insertDecision, insertErrorPath, insertStep, NEW_STEP_KINDS, removeStep, renameElement, type BranchSpec, type EditResult, type NewStepKind,
} from './bpmnEdit';
import { failed, isObject, type ToolKit, type ToolOutcome } from './toolkit';
import { patternDefs } from '../patterns';

/** The draft of one process - diagram and spec together. */
export type ProcessDraft = {
  slug: string;
  base: { spec: ProcessSpec; xml: string };
  spec: ProcessSpec;
  xml: string;
  /** what Claude cannot do in the spec - a missing worker, a question to the developer */
  openPoints: string[];
};

export const startProcessDraft = (spec: ProcessSpec, xml: string): ProcessDraft =>
  ({ slug: spec.slug, base: { spec, xml }, spec, xml, openPoints: [] });

export const processDraftChanged = (d: ProcessDraft) =>
  d.xml !== d.base.xml || JSON.stringify(stripTimes(d.spec)) !== JSON.stringify(stripTimes(d.base.spec));
const stripTimes = (s: ProcessSpec) => ({ ...s, updatedAt: undefined });

export type ProcessContext = {
  model: Model | null;
  /** a service orchestration (a process in service mode): only service steps, only its services */
  serviceMode?: boolean;
  /** in service mode: the services it can call - the same as a step (serviceProcess.orchestrationTargets) */
  services?: Targets['services'];
};

// ---------------------------------------------------------------- what Claude reads

const stepLine = (s: Step) => {
  const parts = [
    `${s.id} [${s.kind}${s.gatewayType ? ` ${s.gatewayType}` : ''}${s.eventKind ? ` ${s.eventKind}` : ''}]`,
    s.name ? `«${s.name}»` : '',
    s.topic ? `topic=${s.topic}` : '',
    s.kind === 'goto' && s.gotoId ? `→ weiter bei ${s.gotoId}` : '',
    s.candidateGroups ? `candidateGroups=${s.candidateGroups}` : '',
    s.description ? `– ${s.description.replace(/\s+/g, ' ').slice(0, 80)}` : '',
  ];
  return parts.filter(Boolean).join(' ');
};

/** The flow as a tree with the IDs - branches (with their condition), error paths, subprocesses. */
export function processOutline(steps: Step[], depth = 0): string[] {
  const pad = '  '.repeat(depth);
  return steps.flatMap((s) => [
    `${pad}${stepLine(s)}`,
    ...(s.branches ?? []).flatMap((b) => [
      `${pad}  ? Zweig «${b.label}»${b.isDefault ? ' (Standard)' : ''}${b.condition ? ` wenn ${b.condition}` : ''}`,
      ...processOutline(b.steps, depth + 2),
    ]),
    ...(s.errors ?? []).flatMap((e) => [
      `${pad}  ! ${e.boundary ? 'Fehlerpfad' : 'behandelter Fehler'} «${e.code}»${e.label ? ` ${e.label}` : ''}${e.boundaryId ? ` (${e.boundaryId})` : ''}`,
      ...processOutline(e.steps ?? [], depth + 2),
    ]),
    ...processOutline(s.children ?? [], depth + 1),
  ]);
}

/** The data model of the process: its interactions (user tasks, workers) with In/Out, its classes and
  * choices with their id - the data-model tools address a type by it (or by its name). */
export function processModelText(spec: ProcessSpec, model: Model | null = null): string {
  const types = spec.types ?? [];
  const idx = indexTypes(types, model);
  const typeName = (id?: string) => types.find((t) => t.id === id)?.name;
  const ia = (t: TypeDef) => (spec.interactions ?? []).find((i) => i.id === t.interactionId);
  const role = (t: TypeDef) =>
    t.root ? ' (In des Prozesses)' : t.processOut ? ' (Out des Prozesses)' : t.inConfig ? ' (InConfig)' : t.initIn ? ' (InitIn)'
      : ia(t) ? ` (${t.name} von «${ia(t)!.name}»)` : '';
  const field = (f: Field) => `${f.name}${f.optional ? '?' : ''}: ${f.collection ? `[${idx.nameOf(f.type)}]` : idx.nameOf(f.type)}`;
  const fields = (fs: Field[] | undefined) => (fs ?? []).filter((f) => f.name.trim()).map(field).join(', ');
  const body = (t: TypeDef) =>
    t.kind === 'enum'
      ? `Auswahl ${(t.values ?? []).map((v) => (v.fields?.length ? `${v.name}{${fields(v.fields)}}` : v.name)).join(' | ')}${t.fields?.length ? `; gemeinsam: ${fields(t.fields)}` : ''}`
      : `{${fields(t.fields)}}`;
  return [
    '# Interaktionen (Schritt – Art – Name – In/Out)',
    ...(spec.interactions ?? []).map((i) => `- ${i.stepId} – ${i.kind} – ${i.name} (${i.key})${typeName(i.inTypeId) ? ` In: ${typeName(i.inTypeId)}` : ''}${typeName(i.outTypeId) ? ` Out: ${typeName(i.outTypeId)}` : ''}`),
    '# Klassen und Auswahlen (id – Name – Rolle: Felder)',
    ...types.map((t) => `- ${t.id} – ${t.name}${role(t)}: ${body(t)}`),
  ].join('\n');
}

/** The findings of the spec as lines «step: message» - errors and (optionally) warnings. */
export function processFindings(spec: ProcessSpec, ctx: ProcessContext, withWarnings = true): { level: 'error' | 'warning'; line: string }[] {
  const byId = new Map(allSteps(spec.steps).map((s) => [s.id, s]));
  return [...collectFindings(spec, ctx.model, allSteps(spec.steps)).entries()].flatMap(([id, f]) => {
    const where = id === PROCESS_FINDINGS ? 'Prozess' : `${id}${byId.get(id)?.name ? ` «${byId.get(id)!.name}»` : ''}`;
    return [
      ...f.errors.map((m) => ({ level: 'error' as const, line: `${where}: ${m}` })),
      ...(withWarnings ? f.warnings.map((m) => ({ level: 'warning' as const, line: `${where}: ${m}` })) : []),
    ];
  });
}

const findingsText = (fs: { level: string; line: string }[]) => (fs.length ? fs.map((f) => `- ${f.level}: ${f.line}`).join('\n') : 'keine');

/** The worker topics of the domain - what a service step may call. */
export const workerTopics = (model: Model | null) => new Set(model ? targetsOf(model, []).services.map((s) => s.topic) : []);

/** What a service step may call here: the workers of the domain - or, in a service orchestration,
  * its services (the collections of the project and the catalog). */
export const callableTopics = (ctx: ProcessContext) =>
  ctx.serviceMode ? new Set((ctx.services ?? []).map((s) => s.topic)) : workerTopics(ctx.model);

// ---------------------------------------------------------------- the tools

const KIND_TEXT = 'user (Benutzer-Task), service (Worker mit topic), manual (manuell), timer (warten, ISO-Dauer wie P1D), end (benennt das Ende des Zweigs)';

/** A worker runs in one go: no user tasks, no waiting, nothing manual. */
const SERVICE_KINDS: NewStepKind[] = ['service', 'end'];
const SERVICE_KIND_TEXT = 'service (ein Service der Orchestrierung mit topic), end (benennt das Ende des Zweigs)';

const kindsOf = (ctx: ProcessContext) => (ctx.serviceMode ? SERVICE_KINDS : NEW_STEP_KINDS);
const kindText = (ctx: ProcessContext) => (ctx.serviceMode ? SERVICE_KIND_TEXT : KIND_TEXT);

const FIELD_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'camelCase' },
    type: { type: 'string', description: `${SCALA_TYPES.join(', ')} - or the name of a class/choice of the data model or of the domain (e.g. of a service In/Out)` },
    optional: { type: 'boolean', description: 'Option[...] - may be missing' },
    list: { type: 'boolean', description: 'Seq[...] - several' },
    description: { type: 'string' },
  },
  required: ['name', 'type'],
};
const CASE_SCHEMA = {
  type: 'object',
  properties: { name: { type: 'string', description: 'PascalCase' }, description: { type: 'string' }, fields: { type: 'array', items: FIELD_SCHEMA } },
  required: ['name'],
};

const tools: ToolKit<ProcessDraft>['tools'] = [
  {
    name: 'read_process',
    description: 'Reads the draft of the process: the flow as a tree with the IDs of the steps, branches and error paths, and its data model (interactions, classes).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'add_step',
    description: `Inserts a step after the step \`after\` - on its only outgoing flow, or on the branch \`branch\` (its label) after a decision. Kinds: ${KIND_TEXT}. Answers with the new ID, the flow and the findings.`,
    input_schema: {
      type: 'object',
      properties: {
        after: { type: 'string', description: 'ID of the step (or of a decision, or of the boundary event of an error path)' },
        branch: { type: 'string', description: 'the label of the branch, if `after` has several ways out' },
        kind: { type: 'string', enum: NEW_STEP_KINDS },
        name: { type: 'string', description: 'German, short - «Adresse prüfen»' },
        topic: { type: 'string', description: 'kind service: the topic of a worker of the data model' },
        timer: { type: 'string', description: 'kind timer: ISO 8601 duration, e.g. P1D' },
      },
      required: ['after', 'kind', 'name'],
    },
  },
  {
    name: 'add_decision',
    description: 'Inserts a decision (exclusive gateway) after `after`. The first branch continues with what came after `after`; every further branch ends in an end of its own (insert steps into it with add_step after the decision with `branch`). Conditions in FEEL on the process variables; one branch may be the default instead.',
    input_schema: {
      type: 'object',
      properties: {
        after: { type: 'string' },
        branch: { type: 'string' },
        name: { type: 'string', description: 'the question - «Adresse gültig?»' },
        branches: {
          type: 'array',
          items: { type: 'object', properties: { label: { type: 'string' }, condition: { type: 'string', description: 'FEEL, e.g. address.valid = true' }, isDefault: { type: 'boolean' } }, required: ['label'] },
        },
      },
      required: ['after', 'name', 'branches'],
    },
  },
  {
    name: 'add_error_path',
    description: 'Adds an error path to a step: a boundary error event with the error code, to an end of its own. Steps go into it with add_step after the returned ID.',
    input_schema: {
      type: 'object',
      properties: { step: { type: 'string' }, code: { type: 'string', description: 'error code, e.g. address-invalid' }, name: { type: 'string' } },
      required: ['step', 'code', 'name'],
    },
  },
  {
    name: 'remove_step',
    description: 'Removes a step with one way in and one out (the flow closes), or a whole error path (the ID of its boundary event).',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'rename_step',
    description: 'Renames a step, an event or a branch (the ID of its flow).',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } }, required: ['id', 'name'] },
  },
  {
    name: 'update_step',
    description: 'Changes the details of a step in the spec: description (Markdown, what the stakeholders read) and for a user task who sees it (candidateGroups, candidateUsers, assignee). Only what is given changes.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' }, description: { type: 'string' },
        candidateGroups: { type: 'string' }, candidateUsers: { type: 'string' }, assignee: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'check_process',
    description: 'The findings of the spec as in the designer - errors and warnings per step.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'add_type',
    description: 'Adds a class (kind case, with fields) or a choice (kind enum, with cases - a case may carry fields; fields of the choice itself are shared by all cases) to the data model of the process. Answers with its id, the data model and the findings of the classes.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'PascalCase, e.g. ClientResult' },
        kind: { type: 'string', enum: ['case', 'enum'] },
        description: { type: 'string' },
        fields: { type: 'array', items: FIELD_SCHEMA, description: 'kind case: its fields; kind enum: the fields all cases share' },
        cases: { type: 'array', items: CASE_SCHEMA, description: 'kind enum: its cases' },
      },
      required: ['name', 'kind'],
    },
  },
  {
    name: 'update_type',
    description: 'Changes a class or choice of the data model - also In and Out of the process («In», «Out»). Only what is given changes; `fields` and `cases` replace the whole list (fields of the same name keep their identity). `kind` switches between class and choice. Not the In/Out of an interaction - those come from the flow.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'the id or the name of the type (In, Out for the process)' },
        name: { type: 'string', description: 'a new name - not for In and Out' },
        kind: { type: 'string', enum: ['case', 'enum'] },
        description: { type: 'string' },
        fields: { type: 'array', items: FIELD_SCHEMA },
        cases: { type: 'array', items: CASE_SCHEMA },
      },
      required: ['type'],
    },
  },
  {
    name: 'remove_type',
    description: 'Removes a class or choice of the data model that no field uses. Not In and Out of the process, not the types of an interaction.',
    input_schema: { type: 'object', properties: { type: { type: 'string', description: 'id or name' } }, required: ['type'] },
  },
  {
    name: 'report_open_point',
    description: 'Reports what cannot be done in the spec - above all a worker (service) that is missing in the data model. Do not invent it; a developer implements it.',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
];

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** The spec after a change of the diagram - as after a change by hand (ProcessView.planXml). */
export function followDiagram(d: ProcessDraft, xml: string, ctx: ProcessContext): ProcessSpec {
  const opts = { patterns: patternDefs(ctx.model) };
  const fresh = importBpmn(xml, 'Claude', opts).spec;
  const before = importBpmn(d.xml, 'Claude', opts).spec;
  return mergeSpec(fresh, d.spec, before).spec;
}

function afterEdit(d: ProcessDraft, r: EditResult, ctx: ProcessContext, summary: string): ToolOutcome<ProcessDraft> {
  if (!r.ok) return failed(d, r.error, `abgelehnt: ${r.error}`);
  const spec = (() => { try { return followDiagram(d, r.xml, ctx); } catch (e) { return e instanceof Error ? e : new Error(String(e)); } })();
  if (spec instanceof Error) return failed(d, `Nicht übernommen – das Diagramm ist so nicht lesbar: ${spec.message}`);
  const next = { ...d, xml: r.xml, spec };
  return {
    draft: next,
    content: `ok – ID ${r.id}\nAblauf:\n${processOutline(spec.steps).join('\n')}\nBefunde:\n${findingsText(processFindings(spec, ctx))}`,
    summary,
  };
}

/** A step of the spec changed - in the whole tree (branches, error paths, subprocesses). */
function patchStep(steps: Step[], id: string, patch: Partial<Step>): Step[] {
  return steps.map((s) => {
    const self = s.id === id ? { ...s, ...patch } : s;
    return {
      ...self,
      ...(self.branches ? { branches: self.branches.map((b) => ({ ...b, steps: patchStep(b.steps, id, patch) })) } : {}),
      ...(self.errors ? { errors: self.errors.map((e) => (e.steps ? { ...e, steps: patchStep(e.steps, id, patch) } : e)) } : {}),
      ...(self.children ? { children: patchStep(self.children, id, patch) } : {}),
    };
  });
}

// ---------------------------------------------------------------- the data model

/** A type of the process by its id or name - «In» and «Out» are the roles of the process; a name
  * means a type of the process itself (not of an interaction, where In and Out repeat). */
function typeOf(spec: ProcessSpec, ref: string | undefined): TypeDef | string {
  const types = spec.types ?? [];
  const r = ref?.trim() ?? '';
  if (!r) return '«type» fehlt – die id oder der Name des Typs (In, Out für den Prozess).';
  const byId = types.find((t) => t.id === r);
  if (byId) return byId;
  const role = r === 'In' ? types.find((t) => t.root) : r === 'Out' ? types.find((t) => t.processOut) : undefined;
  if (role) return role;
  const named = types.filter((t) => !t.interactionId && t.name === r);
  if (named.length === 1) return named[0];
  return named.length ? `«${r}» gibt es mehrmals – mit der id angeben (read_process).` : `Einen Typ «${r}» gibt es im Datenmodell nicht (read_process zeigt die Typen mit id).`;
}

/** The types the AI does not change: those of an interaction (they follow the flow), the InitIn (from the init worker). */
function notEditable(t: TypeDef): string | null {
  if (t.interactionId && !t.root && !t.processOut) return `«${t.name}» gehört zu einer Interaktion – ihr In und Out legt der RE an (Datenmodell → aus dem Ablauf); mit report_open_point melden.`;
  if (t.initIn) return 'Das InitIn kommt vom Init-Worker – es wird nicht hier geändert.';
  return null;
}

const TYPE_NAME = /^[A-Z][A-Za-z0-9]*$/;

function typeNameIssue(name: string, spec: ProcessSpec): string | null {
  if (!TYPE_NAME.test(name)) return `«${name}» ist kein Name für einen Typ – PascalCase, nur Buchstaben und Ziffern (z.B. ClientResult).`;
  if (name === 'In' || name === 'Out') return 'In und Out sind die Rollen des Prozesses – einen anderen Namen wählen, oder update_type mit «In»/«Out».';
  if ((spec.types ?? []).some((t) => !t.interactionId && t.name === name)) return `Einen Typ «${name}» gibt es schon – update_type nehmen oder einen anderen Namen.`;
  return null;
}

/** The type of a field: a simple type, a type of the process (name or id) or a class of the domain by its name. */
function fieldType(name: string, spec: ProcessSpec, model: Model | null): string | { error: string } {
  const n = name.trim();
  if ((SCALA_TYPES as readonly string[]).includes(n)) return n;
  const own = (spec.types ?? []).filter((t) => t.id === n || (!t.interactionId && t.name === n));
  if (own.length === 1) return own[0].id;
  const domain = (model?.domainTypes ?? []).filter((t) => t.name === n || t.name.endsWith(`.${n}`));
  const exact = domain.filter((t) => t.name === n);
  const hit = exact.length === 1 ? exact[0] : domain.length === 1 ? domain[0] : undefined;
  if (hit) return domainRef(hit.id);
  if (own.length > 1 || domain.length > 1) return { error: `Den Typ «${n}» gibt es mehrmals – genauer angeben (z.B. GetClient.Out).` };
  return { error: `Einen Typ «${n}» gibt es nicht – ${SCALA_TYPES.join(', ')} oder eine Klasse des Datenmodells (zuerst add_type) oder der Domain.` };
}

/** The fields of the input - a field of the same name keeps its id (comments, references). */
function fieldsOf(input: unknown, spec: ProcessSpec, model: Model | null, existing: Field[], where: string): Field[] | string {
  if (!Array.isArray(input)) return `${where}: «fields» ist eine Liste.`;
  const seen = new Set<string>();
  const out: Field[] = [];
  for (const raw of input) {
    const f = isObject(raw) ? raw : {};
    const name = str(f.name)?.trim() ?? '';
    if (!/^[a-z][A-Za-z0-9]*$/.test(name)) return `${where}: «${name}» ist kein Feldname – camelCase (z.B. naturalPerson).`;
    if (seen.has(name)) return `${where}: das Feld «${name}» kommt doppelt vor.`;
    seen.add(name);
    const type = fieldType(str(f.type) ?? '', spec, model);
    if (typeof type !== 'string') return `${where}, «${name}»: ${type.error}`;
    const old = existing.find((x) => x.name === name);
    out.push({
      ...(old ?? {}), id: old?.id ?? uid('f'), name, type,
      optional: f.optional === true ? true : undefined,
      collection: f.list === true ? true : undefined,
      description: str(f.description)?.trim() || (old && f.description === undefined ? old.description : undefined),
    });
  }
  return out;
}

/** Fields and cases of a type from the input - what is not given stays as `current`. */
function buildMembers(kind: 'case' | 'enum', args: Record<string, unknown>, spec: ProcessSpec, ctx: ProcessContext, current: { fields: Field[]; values: EnumValue[] }): { fields: Field[]; values?: EnumValue[] } | string {
  const fields = args.fields === undefined ? current.fields : fieldsOf(args.fields, spec, ctx.model, current.fields, 'fields');
  if (typeof fields === 'string') return fields;
  if (kind === 'case') {
    if (args.cases !== undefined) return 'Eine Klasse hat keine Fälle – kind enum nehmen.';
    return { fields };
  }
  if (args.cases === undefined) return current.values.length ? { fields, values: current.values } : 'Eine Auswahl braucht ihre Fälle (cases).';
  if (!Array.isArray(args.cases) || !args.cases.length) return 'Eine Auswahl braucht mindestens einen Fall (cases).';
  const values: EnumValue[] = [];
  for (const raw of args.cases) {
    const c = isObject(raw) ? raw : {};
    const name = str(c.name)?.trim() ?? '';
    if (!TYPE_NAME.test(name)) return `«${name}» ist kein Name für einen Fall – PascalCase (z.B. Company).`;
    if (values.some((v) => v.name === name)) return `Den Fall «${name}» gibt es doppelt.`;
    const old = current.values.find((v) => v.name === name);
    const own = c.fields === undefined ? old?.fields ?? [] : fieldsOf(c.fields, spec, ctx.model, old?.fields ?? [], `Fall «${name}»`);
    if (typeof own === 'string') return own;
    values.push({ ...(old ?? {}), name, description: str(c.description)?.trim() || old?.description, ...(own.length ? { fields: own } : { fields: undefined }) });
  }
  return { fields, values };
}

const fieldsAndCases = (t: TypeDef): Field[] => [...(t.fields ?? []), ...(t.values ?? []).flatMap((v) => v.fields ?? [])];

/** The findings of the classes (checkTypes) as lines «type: message». */
function typeFindings(types: TypeDef[], ctx: ProcessContext, withWarnings = true): { level: 'error' | 'warning'; line: string }[] {
  const nameOf = (id: string) => types.find((t) => t.id === id)?.name ?? id;
  return checkTypes(types, ctx.model)
    .filter((i) => withWarnings || !i.warn)
    .map((i) => ({ level: i.warn ? 'warning' as const : 'error' as const, line: `Typ «${nameOf(i.typeId)}»: ${i.message}` }));
}

function afterTypeEdit(d: ProcessDraft, types: TypeDef[], touched: TypeDef | null, ctx: ProcessContext, summary: string): ToolOutcome<ProcessDraft> {
  const spec = { ...d.spec, types };
  const fs = typeFindings(types, ctx).filter((f) => !touched || f.line.startsWith(`Typ «${touched.name}»`));
  return {
    draft: { ...d, spec },
    content: `ok${touched ? ` – ${touched.name} (${touched.id})` : ''}\nDatenmodell:\n${processModelText(spec, ctx.model)}\nBefunde der Klassen:\n${findingsText(fs)}`,
    summary,
  };
}

export function runProcessTool(name: string, input: unknown, d: ProcessDraft, ctx: ProcessContext): ToolOutcome<ProcessDraft> {
  const args = isObject(input) ? input : {};
  const engine = d.spec.engine ?? 'c7';
  switch (name) {
    case 'read_process':
      return {
        draft: d,
        content: `Prozess «${d.spec.title}» (${d.spec.processId ?? d.slug}, ${engineLabel(engine)})\nAblauf:\n${processOutline(d.spec.steps).join('\n')}\n\n${processModelText(d.spec, ctx.model)}`,
        summary: `Prozess «${d.spec.title}» gelesen`,
      };
    case 'add_step': {
      const kind = str(args.kind) as NewStepKind | undefined;
      if (!kind || !kindsOf(ctx).includes(kind))
        return failed(d, `«kind» ist eines von: ${kindText(ctx)}.${ctx.serviceMode && kind ? ' Eine Orchestrierung ist ein Worker – Benutzer-Tasks, Timer und manuelle Schritte gibt es darin nicht; dafür braucht es einen Prozess (report_open_point).' : ''}`);
      const topic = str(args.topic)?.trim();
      if (ctx.serviceMode && kind === 'service' && !topic) return failed(d, '«topic» fehlt – ein Service-Schritt einer Orchestrierung ruft einen ihrer Services auf.');
      if (kind === 'service' && topic && !callableTopics(ctx).has(topic))
        return failed(d, ctx.serviceMode
          ? `Einen Service «${topic}» kann die Orchestrierung nicht aufrufen. Nicht erfinden – mit report_open_point melden.`
          : `Einen Worker «${topic}» gibt es im Datenmodell nicht. Nicht erfinden – mit report_open_point melden (und z.B. einen manuellen Schritt als Platzhalter nehmen).`);
      const r = insertStep(d.xml, engine, str(args.after) ?? '', { kind, name: str(args.name) ?? '', topic, timer: str(args.timer) }, str(args.branch));
      return afterEdit(d, r, ctx, `Schritt «${str(args.name)}» eingefügt`);
    }
    case 'add_decision': {
      const branches = Array.isArray(args.branches)
        ? args.branches.filter(isObject).map((b): BranchSpec => ({ label: str(b.label) ?? '', condition: str(b.condition), isDefault: b.isDefault === true }))
        : [];
      if (branches.some((b) => !b.label.trim())) return failed(d, 'Jeder Zweig braucht ein «label».');
      const r = insertDecision(d.xml, engine, str(args.after) ?? '', str(args.name) ?? '', branches, str(args.branch));
      return afterEdit(d, r, ctx, `Entscheid «${str(args.name)}» eingefügt (${branches.map((b) => b.label).join(' / ')})`);
    }
    case 'add_error_path': {
      const r = insertErrorPath(d.xml, engine, str(args.step) ?? '', str(args.code) ?? '', str(args.name) ?? '');
      return afterEdit(d, r, ctx, `Fehlerpfad «${str(args.code)}» an ${str(args.step)}`);
    }
    case 'remove_step': {
      const r = removeStep(d.xml, engine, str(args.id) ?? '');
      return afterEdit(d, r, ctx, `${str(args.id)} entfernt`);
    }
    case 'rename_step': {
      const r = renameElement(d.xml, engine, str(args.id) ?? '', str(args.name) ?? '');
      return afterEdit(d, r, ctx, `${str(args.id)} heisst «${str(args.name)}»`);
    }
    case 'update_step': {
      const id = str(args.id) ?? '';
      const step = allSteps(d.spec.steps).find((s) => s.id === id);
      if (!step) return failed(d, `Einen Schritt «${id}» gibt es nicht.`);
      const keys = ['description', 'candidateGroups', 'candidateUsers', 'assignee'] as const;
      const given = keys.filter((k) => typeof args[k] === 'string');
      if (!given.length) return failed(d, 'Nichts angegeben – description, candidateGroups, candidateUsers oder assignee.');
      if (given.some((k) => k !== 'description') && step.kind !== 'user') return failed(d, `«${id}» ist kein Benutzer-Task – nur er hat candidateGroups, candidateUsers und assignee.`);
      const patch = Object.fromEntries(given.map((k) => [k, (args[k] as string).trim() || undefined])) as Partial<Step>;
      const spec = { ...d.spec, steps: patchStep(d.spec.steps, id, patch) };
      return { draft: { ...d, spec }, content: `ok\nBefunde:\n${findingsText(processFindings(spec, ctx))}`, summary: `${id}: ${given.join(', ')} geändert` };
    }
    case 'check_process': {
      const fs = processFindings(d.spec, ctx);
      return { draft: d, content: findingsText(fs), summary: `geprüft: ${fs.filter((f) => f.level === 'error').length} Fehler, ${fs.filter((f) => f.level === 'warning').length} Warnungen` };
    }
    case 'add_type': {
      const name = str(args.name)?.trim() ?? '';
      const kind = args.kind === 'enum' ? 'enum' : args.kind === 'case' ? 'case' : undefined;
      if (!kind) return failed(d, '«kind» ist case (Klasse) oder enum (Auswahl).');
      const nameIssue = typeNameIssue(name, d.spec);
      if (nameIssue) return failed(d, nameIssue);
      const built = buildMembers(kind, args, d.spec, ctx, { fields: [], values: [] });
      if (typeof built === 'string') return failed(d, built);
      const t: TypeDef = { id: uid('t'), name, kind, status: 'draft', ...(str(args.description)?.trim() ? { description: str(args.description)!.trim() } : {}), ...built };
      return afterTypeEdit(d, [...(d.spec.types ?? []), t], t, ctx, `${kind === 'enum' ? 'Auswahl' : 'Klasse'} «${name}» angelegt`);
    }
    case 'update_type': {
      const t = typeOf(d.spec, str(args.type));
      if (typeof t === 'string') return failed(d, t);
      const locked = notEditable(t);
      if (locked) return failed(d, locked);
      const name = str(args.name)?.trim();
      if (name !== undefined && name !== t.name) {
        if (t.root || t.processOut) return failed(d, 'In und Out des Prozesses behalten ihren Namen.');
        const nameIssue = typeNameIssue(name, d.spec);
        if (nameIssue) return failed(d, nameIssue);
      }
      const kind = args.kind === 'enum' ? 'enum' : args.kind === 'case' ? 'case' : t.kind;
      if (kind === 'enum' && t.kind !== 'enum' && !Array.isArray(args.cases)) return failed(d, 'Eine Auswahl braucht ihre Fälle (cases).');
      // a choice that becomes a class: its shared and specific fields together, if no fields are given
      const current = kind === 'case' && t.kind === 'enum'
        ? { fields: [...(t.fields ?? []), ...(t.values ?? []).flatMap((v) => v.fields ?? [])].filter((f, i, all) => all.findIndex((o) => o.name === f.name) === i), values: [] }
        : { fields: t.fields ?? [], values: t.values ?? [] };
      const built = buildMembers(kind, args, d.spec, ctx, current);
      if (typeof built === 'string') return failed(d, built);
      const description = typeof args.description === 'string' ? args.description.trim() || undefined : t.description;
      const next: TypeDef = { ...t, kind, ...(name ? { name } : {}), description, ...built, ...(kind === 'case' ? { values: undefined } : {}) };
      return afterTypeEdit(d, (d.spec.types ?? []).map((x) => (x.id === t.id ? next : x)), next, ctx, `«${next.name}» geändert`);
    }
    case 'remove_type': {
      const t = typeOf(d.spec, str(args.type));
      if (typeof t === 'string') return failed(d, t);
      const locked = notEditable(t) ?? (t.root || t.processOut ? 'In und Out des Prozesses bleiben – ändern mit update_type.' : null);
      if (locked) return failed(d, locked);
      const users = (d.spec.types ?? []).filter((x) => x.id !== t.id && fieldsAndCases(x).some((f) => f.type === t.id));
      if (users.length) return failed(d, `«${t.name}» wird noch verwendet – in ${users.map((u) => `«${u.name}»`).join(', ')}. Zuerst dort ändern.`);
      return afterTypeEdit(d, (d.spec.types ?? []).filter((x) => x.id !== t.id), null, ctx, `«${t.name}» entfernt`);
    }
    case 'report_open_point': {
      const text = str(args.text)?.trim();
      if (!text) return failed(d, '«text» fehlt.');
      return { draft: { ...d, openPoints: [...d.openPoints, text] }, content: 'notiert', summary: `offener Punkt: ${text}` };
    }
    default:
      return failed(d, `Ein Werkzeug «${name}» gibt es nicht.`);
  }
}

/** The errors the draft has and the process before did not - those Claude corrects itself. In a
  * service orchestration not the missing inputs of a step Claude added: the RE maps them in the
  * step, Claude has no tool for it (the skill says to name them as open). */
export function newProcessErrors(d: ProcessDraft, ctx: ProcessContext): string[] {
  if (!processDraftChanged(d)) return [];
  const errors = (s: ProcessSpec) => [...processFindings(s, ctx, false), ...typeFindings(s.types ?? [], ctx, false)].map((f) => f.line);
  const before = new Set(errors(d.base.spec));
  const known = new Set(allSteps(d.base.spec.steps).map((s) => s.id));
  const added = allSteps(d.spec.steps).map((s) => s.id).filter((id) => !known.has(id));
  const toMap = (l: string) =>
    !!ctx.serviceMode && MAPPING_ERROR.test(l) && added.some((id) => l.startsWith(`${id} `) || l.startsWith(`${id}:`));
  return errors(d.spec).filter((l) => !before.has(l) && !toMap(l));
}

/** The error of a required input that is not mapped (findings.ts). */
const MAPPING_ERROR = /Pflichtfeld «[^»]+» fehlt in den Eingaben/;

/** The tools - in a service orchestration add_step offers only its kinds. */
const toolsFor = (ctx: ProcessContext): ToolKit<ProcessDraft>['tools'] =>
  ctx.serviceMode
    ? tools.map((t) => (t.name !== 'add_step' ? t : {
      ...t,
      description: `Inserts a service step after the step \`after\` - on its only outgoing flow, or on the branch \`branch\` (its label) after a decision. Kinds: ${SERVICE_KIND_TEXT}. Answers with the new ID, the flow and the findings.`,
      input_schema: {
        ...t.input_schema,
        properties: {
          // no timer in a worker
          ...Object.fromEntries(Object.entries(t.input_schema.properties as Record<string, unknown>).filter(([k]) => k !== 'timer')),
          kind: { type: 'string', enum: SERVICE_KINDS },
          topic: { type: 'string', description: 'kind service: the topic of a service the orchestration can call' },
        },
      },
    }))
    : tools;

/** The tools of stage B for one process - or one service orchestration. */
export const processToolKit = (ctx: ProcessContext): ToolKit<ProcessDraft> => ({
  tools: toolsFor(ctx),
  run: (name, input, d) => runProcessTool(name, input, d, ctx),
  remainingErrors: (d) => newProcessErrors(d, ctx),
});
