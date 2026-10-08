// Der Status der Spezifikation wird nicht gesetzt — er ist der kleinste Status
// ihrer Teile (Reihenfolge STATUSES): die Schritte des Ablaufs und, was im
// Datenmodell einen Status trägt (Klassen, Interaktionen). Steht ein Schritt
// noch auf «Entwurf», ist die ganze Spezifikation ein Entwurf.
import { STATUSES, type Interaction, type ProcessSpec, type Status, type Step } from './types';
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

/** Der kleinste Status einer Interaktion samt ihren In/Out-Klassen — null ohne Status. */
export function interactionStatus(ia: Interaction, spec: Pick<ProcessSpec, 'types'>): Status | null {
  const all = [ia.status, ...(spec.types ?? []).filter(t => t.id === ia.inTypeId || t.id === ia.outTypeId || t.interactionId === ia.id).map(t => t.status)]
    .filter((x): x is Status => !!x && rank(x) >= 0);
  return all.length ? all.reduce((min, s) => (rank(s) < rank(min) ? s : min)) : null;
}

/** Steht die Interaktion tiefer als ihr Schritt? Dann ihr Status, sonst null. */
export function interactionBelow(step: Step, ia: Interaction | null, spec: Pick<ProcessSpec, 'types'>): Status | null {
  const st = ia ? interactionStatus(ia, spec) : null;
  return st && rank(st) < rank(step.status) ? st : null;
}

/**
 * Die Status, die ein Schritt trägt: sein eigener und der seiner Interaktion samt
 * deren In/Out-Klassen — eine Interaktion im Entwurf macht den Schritt im Filter
 * «Entwurf» sichtbar, sonst fände der Gesamtstatus keinen Schritt dazu.
 */
export function stepStatuses(step: Step, spec: Parts): Status[] {
  const ia = (spec.interactions ?? []).find(i => i.stepId === step.id);
  const own = ia ? (spec.types ?? []).filter(t => t.id === ia.inTypeId || t.id === ia.outTypeId || t.interactionId === ia.id) : [];
  return [...new Set([step.status, ia?.status, ...own.map(t => t.status)])]
    .filter((x): x is Status => !!x && rank(x) >= 0);
}

/**
 * Je Status: wie viele Schritte ihn tragen (siehe stepStatuses) und welche Klassen
 * des Datenmodells ohne Schritt (In/Out des Prozesses, `schema/`) — zusammen ergeben
 * sie den Gesamtstatus (overallStatus).
 */
export function statusParts(spec: Parts): Record<Status, { steps: number; model: string[] }> {
  const out = Object.fromEntries(STATUSES.map(s => [s, { steps: 0, model: [] as string[] }])) as Record<Status, { steps: number; model: string[] }>;
  for (const step of allSteps(spec.steps ?? []).filter(s => s.kind !== 'goto')) for (const st of stepStatuses(step, spec)) out[st].steps++;
  const withStep = new Set((spec.interactions ?? []).filter(i => allSteps(spec.steps ?? []).some(s => s.id === i.stepId)).map(i => i.id));
  for (const t of spec.types ?? []) {
    if (!t.status || rank(t.status) < 0 || (t.interactionId && withStep.has(t.interactionId))) continue;
    out[t.status].model.push(t.name || '(ohne Namen)');
  }
  for (const i of spec.interactions ?? []) {
    if (i.status && rank(i.status) >= 0 && !withStep.has(i.id)) out[i.status].model.push(i.name || '(ohne Namen)');
  }
  return out;
}
