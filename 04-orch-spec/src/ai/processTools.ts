// Stage B of the AI mode: Claude changes a process as a draft (E19) - its structure in the BPMN
// (bpmnEdit.ts), its details in the spec. After every change of the diagram the spec follows it the
// way it does after a change by hand: import, merge with the spec (mergeSpec keeps the texts by the
// ID of the step), the findings of the spec (collectFindings) - the same checks as in the designer.
import { allSteps, importBpmn, mergeSpec } from '../bpmn';
import { engineLabel } from '../engineLabels';
import { collectFindings } from '../findings';
import { targetsOf } from '../pages/designer/model';
import type { Model, ProcessSpec, Step } from '../types';
import {
  insertDecision, insertErrorPath, insertStep, NEW_STEP_KINDS, removeStep, renameElement, type BranchSpec, type EditResult, type NewStepKind,
} from './bpmnEdit';
import { failed, isObject, type ToolKit, type ToolOutcome } from './toolkit';

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

export type ProcessContext = { model: Model | null };

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

/** The data model of the process: its interactions (user tasks, workers) with In/Out, its classes. */
export function processModelText(spec: ProcessSpec): string {
  const typeName = (id?: string) => spec.types?.find((t) => t.id === id)?.name;
  return [
    '# Interaktionen (Schritt – Art – Name – In/Out)',
    ...(spec.interactions ?? []).map((i) => `- ${i.stepId} – ${i.kind} – ${i.name} (${i.key})${typeName(i.inTypeId) ? ` In: ${typeName(i.inTypeId)}` : ''}${typeName(i.outTypeId) ? ` Out: ${typeName(i.outTypeId)}` : ''}`),
    '# Klassen',
    ...(spec.types ?? []).map((t) => `- ${t.name}${t.root ? ' (In des Prozesses)' : ''}: ${t.kind === 'enum' ? (t.values ?? []).map((v) => v.name).join(' | ') : (t.fields ?? []).map((f) => `${f.name}${f.optional ? '?' : ''}: ${f.type.replace(/^dom:/, '').split('.').pop()}`).join(', ')}`),
  ].join('\n');
}

/** The findings of the spec as lines «step: message» - errors and (optionally) warnings. */
export function processFindings(spec: ProcessSpec, ctx: ProcessContext, withWarnings = true): { level: 'error' | 'warning'; line: string }[] {
  const byId = new Map(allSteps(spec.steps).map((s) => [s.id, s]));
  return [...collectFindings(spec, ctx.model, allSteps(spec.steps)).entries()].flatMap(([id, f]) => {
    const where = `${id}${byId.get(id)?.name ? ` «${byId.get(id)!.name}»` : ''}`;
    return [
      ...f.errors.map((m) => ({ level: 'error' as const, line: `${where}: ${m}` })),
      ...(withWarnings ? f.warnings.map((m) => ({ level: 'warning' as const, line: `${where}: ${m}` })) : []),
    ];
  });
}

const findingsText = (fs: { level: string; line: string }[]) => (fs.length ? fs.map((f) => `- ${f.level}: ${f.line}`).join('\n') : 'keine');

/** The worker topics of the domain - what a service step may call. */
export const workerTopics = (model: Model | null) => new Set(model ? targetsOf(model, []).services.map((s) => s.topic) : []);

// ---------------------------------------------------------------- the tools

const KIND_TEXT = 'user (Benutzer-Task), service (Worker mit topic), manual (manuell), timer (warten, ISO-Dauer wie P1D), end (benennt das Ende des Zweigs)';

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
    name: 'report_open_point',
    description: 'Reports what cannot be done in the spec - above all a worker (service) that is missing in the data model. Do not invent it; a developer implements it.',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
];

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** The spec after a change of the diagram - as after a change by hand (ProcessView.planXml). */
export function followDiagram(d: ProcessDraft, xml: string, ctx: ProcessContext): ProcessSpec {
  const opts = { patterns: ctx.model?.patterns };
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

export function runProcessTool(name: string, input: unknown, d: ProcessDraft, ctx: ProcessContext): ToolOutcome<ProcessDraft> {
  const args = isObject(input) ? input : {};
  const engine = d.spec.engine ?? 'c7';
  switch (name) {
    case 'read_process':
      return {
        draft: d,
        content: `Prozess «${d.spec.title}» (${d.spec.processId ?? d.slug}, ${engineLabel(engine)})\nAblauf:\n${processOutline(d.spec.steps).join('\n')}\n\n${processModelText(d.spec)}`,
        summary: `Prozess «${d.spec.title}» gelesen`,
      };
    case 'add_step': {
      const kind = str(args.kind) as NewStepKind | undefined;
      if (!kind || !NEW_STEP_KINDS.includes(kind)) return failed(d, `«kind» ist eines von: ${KIND_TEXT}.`);
      const topic = str(args.topic)?.trim();
      if (kind === 'service' && topic && !workerTopics(ctx.model).has(topic))
        return failed(d, `Einen Worker «${topic}» gibt es im Datenmodell nicht. Nicht erfinden – mit report_open_point melden (und z.B. einen manuellen Schritt als Platzhalter nehmen).`);
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
    case 'report_open_point': {
      const text = str(args.text)?.trim();
      if (!text) return failed(d, '«text» fehlt.');
      return { draft: { ...d, openPoints: [...d.openPoints, text] }, content: 'notiert', summary: `offener Punkt: ${text}` };
    }
    default:
      return failed(d, `Ein Werkzeug «${name}» gibt es nicht.`);
  }
}

/** The errors the draft has and the process before did not - those Claude corrects itself. */
export function newProcessErrors(d: ProcessDraft, ctx: ProcessContext): string[] {
  if (!processDraftChanged(d)) return [];
  const errors = (s: ProcessSpec) => processFindings(s, ctx, false).map((f) => f.line);
  const before = new Set(errors(d.base.spec));
  return errors(d.spec).filter((l) => !before.has(l));
}

/** The tools of stage B for one process. */
export const processToolKit = (ctx: ProcessContext): ToolKit<ProcessDraft> => ({
  tools,
  run: (name, input, d) => runProcessTool(name, input, d, ctx),
  remainingErrors: (d) => newProcessErrors(d, ctx),
});
