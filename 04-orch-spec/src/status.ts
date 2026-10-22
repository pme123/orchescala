// The status of the specification is not set — it is the lowest status
// of its parts (order STATUSES): the steps of the flow and whatever carries a status
// in the data model (classes, interactions). If a step is still
// at «Entwurf», the whole specification is a draft.
import { STATUSES, type Interaction, type ProcessSpec, type Status, type Step, type TypeDef } from './types';
import { allSteps } from './bpmn';

const rank = (s: Status) => STATUSES.indexOf(s);

/** The lowest status of all parts — without parts with a status, the last saved one (otherwise «Entwurf»). */
export function overallStatus(spec: Pick<ProcessSpec, 'steps' | 'types' | 'interactions' | 'status'>): Status {
  const all = [
    ...allSteps(spec.steps ?? []).filter(s => s.kind !== 'goto').map(s => s.status),
    ...(spec.types ?? []).map(t => t.status),
    ...(spec.interactions ?? []).map(i => i.status),
  ].filter((s): s is Status => !!s && rank(s) >= 0);
  if (!all.length) return spec.status ?? 'draft';
  return all.reduce((min, s) => (rank(s) < rank(min) ? s : min));
}

type Parts = Pick<ProcessSpec, 'steps' | 'types' | 'interactions'>;

const lowest = (all: Array<Status | undefined>): Status | null => {
  const known = all.filter((x): x is Status => !!x && rank(x) >= 0);
  return known.length ? known.reduce((min, s) => (rank(s) < rank(min) ? s : min)) : null;
};

/** The start of the process — it carries the classes of the process (In, InitIn, InConfig, Out, `schema/`). */
export const processStartId = (spec: Pick<ProcessSpec, 'steps'>): string | null =>
  (spec.steps ?? []).find(s => s.kind === 'start')?.id ?? null;

/** The classes of the process: all without an interaction on a step of the flow. */
export function processClasses(spec: Parts): TypeDef[] {
  const ids = new Set(allSteps(spec.steps ?? []).map(s => s.id));
  const withStep = new Set((spec.interactions ?? []).filter(i => ids.has(i.stepId)).map(i => i.id));
  return (spec.types ?? []).filter(t => !(t.interactionId && withStep.has(t.interactionId)));
}

/** The lowest status of an interaction including its In/Out classes — null without a status. */
export function interactionStatus(ia: Interaction, spec: Pick<ProcessSpec, 'types'>): Status | null {
  return lowest([ia.status, ...(spec.types ?? []).filter(t => t.id === ia.inTypeId || t.id === ia.outTypeId || t.interactionId === ia.id).map(t => t.status)]);
}

/**
 * The data model of a step: its interaction with its classes — at the start of the
 * process, its classes. The lowest status and the class a click leads to.
 */
export function stepData(step: Step, spec: Parts): { status: Status; typeId: string | null; label: string } | null {
  const ia = (spec.interactions ?? []).find(i => i.stepId === step.id);
  if (ia) {
    const st = interactionStatus(ia, spec);
    return st ? { status: st, typeId: ia.inTypeId ?? ia.outTypeId ?? null, label: ia.name } : null;
  }
  if (step.id !== processStartId(spec)) return null;
  const classes = processClasses(spec);
  const st = lowest(classes.map(t => t.status));
  if (!st) return null;
  const at = classes.find(t => t.status === st);
  return { status: st, typeId: at?.id ?? null, label: at?.name ?? 'Datenmodell' };
}

/**
 * The classes at the start of the process: In, InitIn and InConfig always (the contract of the
 * process), further classes of the process only if they rank lower than the start.
 * `below`: the status ranks lower — it belongs on the chip.
 */
export function startClasses(step: Step, spec: Parts): Array<{ id: string; name: string; status: Status | null; below: boolean }> {
  if (step.id !== processStartId(spec)) return [];
  const below = (t: TypeDef) => !!t.status && rank(t.status) >= 0 && rank(t.status) < rank(step.status);
  const order = (t: TypeDef) => (t.root ? 0 : t.initIn ? 1 : t.inConfig ? 2 : 3);
  return processClasses(spec)
    .filter(t => t.root || t.initIn || t.inConfig || below(t))
    .sort((a, b) => order(a) - order(b))
    .map(t => ({ id: t.id, name: t.name || '(ohne Namen)', status: t.status ?? null, below: below(t) }));
}

/** Does the data model of the step rank lower than the step? Then its status and class. */
export function dataBelow(step: Step, spec: Parts): { status: Status; typeId: string | null; label: string } | null {
  const d = stepData(step, spec);
  return d && rank(d.status) < rank(step.status) ? d : null;
}

/**
 * The statuses a step carries: its own and that of its data model (see
 * stepData) — so the filter finds every part that determines the overall status.
 */
export function stepStatuses(step: Step, spec: Parts): Status[] {
  const ia = (spec.interactions ?? []).find(i => i.stepId === step.id);
  const own = ia ? (spec.types ?? []).filter(t => t.id === ia.inTypeId || t.id === ia.outTypeId || t.interactionId === ia.id)
    : step.id === processStartId(spec) ? processClasses(spec) : [];
  return [...new Set([step.status, ia?.status, ...own.map(t => t.status)])]
    .filter((x): x is Status => !!x && rank(x) >= 0);
}

/**
 * Per status: how many steps carry it (see stepStatuses) and which classes
 * hang on no step (without a start in the flow) — together they make up the overall status.
 */
export function statusParts(spec: Parts): Record<Status, { steps: number; model: string[] }> {
  const out = Object.fromEntries(STATUSES.map(s => [s, { steps: 0, model: [] as string[] }])) as Record<Status, { steps: number; model: string[] }>;
  for (const step of allSteps(spec.steps ?? []).filter(s => s.kind !== 'goto')) for (const st of stepStatuses(step, spec)) out[st].steps++;
  if (!processStartId(spec)) {
    for (const t of processClasses(spec)) if (t.status && rank(t.status) >= 0) out[t.status].model.push(t.name || '(ohne Namen)');
  }
  const ids = new Set(allSteps(spec.steps ?? []).map(s => s.id));
  for (const i of spec.interactions ?? []) {
    if (i.status && rank(i.status) >= 0 && !ids.has(i.stepId)) out[i.status].model.push(i.name || '(ohne Namen)');
  }
  return out;
}

/**
 * A new status for steps also applies to their data model (see stepData): the
 * interaction with In and Out — at the start of the process its classes.
 */
export function withDataStatus<T extends Parts>(spec: T, stepIds: Set<string>, status: Status): T {
  const ias = new Set((spec.interactions ?? []).filter(i => stepIds.has(i.stepId)).map(i => i.id));
  const start = processStartId(spec);
  const own = new Set(start && stepIds.has(start) ? processClasses(spec).map(t => t.id) : []);
  return {
    ...spec,
    interactions: (spec.interactions ?? []).map(i => (ias.has(i.id) ? { ...i, status } : i)),
    types: (spec.types ?? []).map(t => ((t.interactionId && ias.has(t.interactionId)) || own.has(t.id) ? { ...t, status } : t)),
  };
}
