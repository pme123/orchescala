// What a step of a service orchestration may be — what one worker runs in one go. Shared by
// the findings of a process in service mode and the checks of the orchestration export.
import { isEventBoundary } from '../bpmn.ts';
import type { Step } from '../types';

export interface ServiceStepIssue {
  level: 'error' | 'warn';
  text: string;
}

/**
 * Service and script tasks, parallel and exclusive gateways — nothing that waits or loops.
 * `chosen`: whether the step's service counts as chosen (an orchestration of before keeps it apart).
 */
export function serviceStepIssues(s: Step, chosen = !!(s.topic || s.serviceId)): ServiceStepIssue[] {
  const out: ServiceStepIssue[] = [];
  const name = s.name || s.id;
  if (s.kind === 'gateway') {
    if (s.gatewayType !== 'parallel' && s.gatewayType !== 'exclusive') out.push({ level: 'error', text: `«${name}»: nur parallele und exklusive Gateways.` });
  } else if (!['start', 'end', 'service', 'script'].includes(s.kind)) {
    out.push({ level: 'error', text: `«${name}» (${s.kind}): eine Orchestrierung kennt nur Service- und Script-Tasks.` });
  }
  if (s.loop || s.multiInstance) out.push({ level: 'error', text: `«${name}»: Schleifen gibt es in einer Orchestrierung nicht.` });
  const errors = s.errors ?? [];
  // a boundary error is described as in a process — the worker handles it in code (a TODO in the export)
  if (errors.some(e => !e.side && !e.timer && !isEventBoundary(e))) out.push({ level: 'warn', text: `«${name}»: Fehlerpfad — im Export ein TODO, der Worker behandelt den Fehler im Code.` });
  if (errors.some(e => e.side || e.timer || isEventBoundary(e))) out.push({ level: 'error', text: `«${name}»: Timer und Ereignisse am Rand gibt es in einem Worker nicht.` });
  if (s.kind === 'service' && !chosen) out.push({ level: 'error', text: `«${name}»: kein Service gewählt.` });
  return out;
}
