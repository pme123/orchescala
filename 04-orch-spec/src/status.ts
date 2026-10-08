// Der Status der Spezifikation wird nicht gesetzt — er ist der kleinste Status
// ihrer Teile (Reihenfolge STATUSES): die Schritte des Ablaufs und, was im
// Datenmodell einen Status trägt (Klassen, Interaktionen). Steht ein Schritt
// noch auf «Entwurf», ist die ganze Spezifikation ein Entwurf.
import { STATUSES, type Interaction, type ProcessSpec, type Status, type Step, type TypeDef } from './types';
import { allSteps } from './bpmn';

const rank = (s: Status) => STATUSES.indexOf(s);

/** Der kleinste Status aller Teile — ohne Teile mit Status der zuletzt gespeicherte (sonst «Entwurf»). */
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

/** Der Start des Prozesses — er trägt die Klassen des Prozesses (In, InitIn, InConfig, Out, `schema/`). */
export const processStartId = (spec: Pick<ProcessSpec, 'steps'>): string | null =>
  (spec.steps ?? []).find(s => s.kind === 'start')?.id ?? null;

/** Die Klassen des Prozesses: alle ohne Interaktion an einem Schritt des Ablaufs. */
export function processClasses(spec: Parts): TypeDef[] {
  const ids = new Set(allSteps(spec.steps ?? []).map(s => s.id));
  const withStep = new Set((spec.interactions ?? []).filter(i => ids.has(i.stepId)).map(i => i.id));
  return (spec.types ?? []).filter(t => !(t.interactionId && withStep.has(t.interactionId)));
}

/** Der kleinste Status einer Interaktion samt ihren In/Out-Klassen — null ohne Status. */
export function interactionStatus(ia: Interaction, spec: Pick<ProcessSpec, 'types'>): Status | null {
  return lowest([ia.status, ...(spec.types ?? []).filter(t => t.id === ia.inTypeId || t.id === ia.outTypeId || t.interactionId === ia.id).map(t => t.status)]);
}

/**
 * Das Datenmodell eines Schritts: seine Interaktion samt Klassen — beim Start des
 * Prozesses dessen Klassen. Der kleinste Status und die Klasse, zu der ein Klick führt.
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

/** Steht das Datenmodell des Schritts tiefer als der Schritt? Dann dessen Status und Klasse. */
export function dataBelow(step: Step, spec: Parts): { status: Status; typeId: string | null; label: string } | null {
  const d = stepData(step, spec);
  return d && rank(d.status) < rank(step.status) ? d : null;
}

/**
 * Die Status, die ein Schritt trägt: sein eigener und der seines Datenmodells (siehe
 * stepData) — so findet der Filter jeden Teil, der den Gesamtstatus bestimmt.
 */
export function stepStatuses(step: Step, spec: Parts): Status[] {
  const ia = (spec.interactions ?? []).find(i => i.stepId === step.id);
  const own = ia ? (spec.types ?? []).filter(t => t.id === ia.inTypeId || t.id === ia.outTypeId || t.interactionId === ia.id)
    : step.id === processStartId(spec) ? processClasses(spec) : [];
  return [...new Set([step.status, ia?.status, ...own.map(t => t.status)])]
    .filter((x): x is Status => !!x && rank(x) >= 0);
}

/**
 * Je Status: wie viele Schritte ihn tragen (siehe stepStatuses) und welche Klassen
 * an keinem Schritt hängen (ohne Start im Ablauf) — zusammen ergeben sie den Gesamtstatus.
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
 * Ein neuer Status für Schritte gilt auch für ihr Datenmodell (siehe stepData): die
 * Interaktion samt In und Out — beim Start des Prozesses dessen Klassen.
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
