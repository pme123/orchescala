import type { EngineId, ProcessSpec, Step } from './types';

// ── Send a catching message ──────────────────────────────────────────────────
//
// The gateway takes `POST /message/{messageName}` with `businessKey` or
// `processInstanceId` as query parameter — the two ways to correlate; at the
// step one of them is chosen. For this Camunda 8 has the correlation key of the
// message (`zeebe:subscription`): `=camunda.processInstance.businessId` or
// `=string(camunda.processInstance.key)` (business id and own instance, in FEEL from
// Camunda 8.10) — the gateway gives it the
// `processInstanceId`, otherwise the `businessKey` (as in Camunda 7: the ID wins).
// Camunda 7 correlates directly via one of the two; there the choice is only in
// the specification (docs and the migration to Camunda 8).

export type CorrelationChoice = 'businessKey' | 'processInstanceId';

/** The correlation key per choice — that is how it appears in the BPMN in Camunda 8 */
export const CORRELATION_KEY: Record<CorrelationChoice, string> = {
  businessKey: '=camunda.processInstance.businessId',
  processInstanceId: '=string(camunda.processInstance.key)',
};

/** The own process instance in FEEL (Camunda 8.10) — with or without `string(…)` */
const OWN_KEY = /^(string\(\s*camunda\.processInstance\.key\s*\)|camunda\.processInstance\.key)$/;

/** The business id of the instance in FEEL (Camunda 8.10) */
const BUSINESS_ID = /^camunda\.processInstance\.businessId$/;

/** The old variables of the InitWorker — in Camunda 8 no worker sets them any more */
const OLD_ID = new Set(['processInstanceId', 'processInstanceKey']);

export interface MessageCorrelation {
  /** one of the two ways — `null`: none chosen or another expression */
  choice: CorrelationChoice | null;
  /** Query parameter of the gateway */
  param: CorrelationChoice;
  /** Placeholder for the value, e.g. `{{businessKey}}` */
  value: string;
  /** the expression as it is at the step */
  expression?: string;
  /** Camunda 8 without a key — the message finds no waiting instance */
  missing?: boolean;
  /** Camunda 7 without a choice: the sender takes one of the two */
  either?: boolean;
  /** a fixed value instead of `= …` — all instances share it */
  fixed?: boolean;
  /**
   * Camunda 8 `= processInstanceId` (or the older `= processInstanceKey`) — the
   * InitWorker no longer sets it: the key stays empty, the event an incident.
   * The own instance is `camunda.processInstance.key`.
   */
  misnamed?: boolean;
  /**
   * Camunda 8 `= businessKey` — from 8.10 there is no such variable: the key stays
   * empty. The business key is `camunda.processInstance.businessId`.
   */
  oldBusinessKey?: boolean;
}

/** Does the step wait for a message (intermediate event, receive task)? */
export const waitsForMessage = (step: Step): boolean =>
  step.kind === 'receive' || (step.kind === 'event' && step.eventKind === 'message' && step.eventDirection === 'catch');

/** Only steps that wait for a message — otherwise `null`. */
export function messageCorrelation(step: Step, engine: EngineId | undefined): MessageCorrelation | null {
  return waitsForMessage(step) ? correlationOf(step.correlationKey, engine) : null;
}

/** A correlation key — at the waiting step or at a message on the boundary (boundary event). */
export function correlationOf(expression: string | undefined, engine: EngineId | undefined): MessageCorrelation {
  const of = (choice: CorrelationChoice) => ({ choice, param: choice, value: `{{${choice}}}`, expression });
  if (!expression?.trim()) {
    return (engine ?? 'c7') === 'c7'
      ? { choice: null, param: 'businessKey', value: '{{businessKey}}', either: true }
      : { choice: null, param: 'businessKey', value: '{{businessKey}}', missing: true };
  }
  if (!expression.trim().startsWith('=')) return { choice: null, param: 'businessKey', value: expression.trim(), expression, fixed: true };
  const body = expression.replace(/^=\s*/, '').trim();
  if (BUSINESS_ID.test(body)) return of('businessKey');
  // the older `=businessKey`: still the choice in Camunda 7, in Camunda 8 the variable is gone
  if (body === 'businessKey') return (engine ?? 'c7') !== 'c8' ? of('businessKey') : { ...of('businessKey'), choice: null, oldBusinessKey: true };
  if (OWN_KEY.test(body)) return of('processInstanceId');
  // Camunda 7 has no correlation key in the BPMN — an older choice stays a choice
  if (body === 'processInstanceId' && (engine ?? 'c7') !== 'c8') return of('processInstanceId');
  if (OLD_ID.has(body)) return { ...of('processInstanceId'), choice: null, misnamed: true };
  // another variable: its value is the key; otherwise an expression the sender computes
  const value = /^[A-Za-z_][\w.]*$/.test(body) ? `{{${body.split('.').pop()}}}` : `<${body}>`;
  return { choice: null, param: 'businessKey', value, expression };
}

/**
 * A key as Camunda 8 needs it — an older choice `=processInstanceId` becomes the own key,
 * `=businessKey` the business id of the instance
 */
const forC8 = (key: string): string => {
  const body = key.trim().replace(/^=\s*/, '');
  return OLD_ID.has(body) ? CORRELATION_KEY.processInstanceId : body === 'businessKey' ? CORRELATION_KEY.businessKey : key.trim();
};

/**
 * The chosen keys per step — for the migration to Camunda 8, which
 * otherwise suggests `=camunda.processInstance.businessId`.
 */
export function correlationKeysOf(spec: Pick<ProcessSpec, 'steps'>): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (steps: Step[]) => {
    for (const s of steps) {
      if (waitsForMessage(s) && s.correlationKey?.trim()) out[s.id] = forC8(s.correlationKey);
      // a message on the boundary waits too — its element is the boundary event
      for (const e of s.errors ?? []) {
        if (e.eventKind === 'message' && e.boundaryId && e.correlationKey?.trim()) out[e.boundaryId] = forC8(e.correlationKey);
      }
      walk([...(s.children ?? []), ...(s.branches ?? []).flatMap(b => b.steps), ...(s.errors ?? []).flatMap(e => e.steps ?? [])]);
    }
  };
  walk(spec.steps ?? []);
  return out;
}

/** The fields of the `In` of the message — empty if it has no own object. */
function inFields(step: Step, spec: Pick<ProcessSpec, 'interactions' | 'types'>): string[] {
  const ia = spec.interactions?.find(i => i.stepId === step.id);
  const t = ia?.inTypeId ? spec.types?.find(x => x.id === ia.inTypeId) : undefined;
  return (t?.fields ?? []).map(f => f.name);
}

/** The call at the gateway — as in Postman: `{{baseUrl}}` and the variables as placeholders. */
export function messageRequest(step: Step, corr: MessageCorrelation, spec: Pick<ProcessSpec, 'interactions' | 'types'>): string {
  const fields = inFields(step, spec);
  const body = fields.length ? `{\n${fields.map(f => `  "${f}": …`).join(',\n')}\n}` : '{ }';
  return [
    `POST {{baseUrl}}/message/${step.messageName}?${corr.param}=${corr.value}`,
    'Content-Type: application/json',
    '',
    body,
  ].join('\n');
}

/** Can the step carry a message or a signal? */
export const carriesMessage = (step: Step): boolean =>
  step.messageName !== undefined || step.eventKind === 'message' || step.eventKind === 'signal'
  || step.kind === 'receive' || step.kind === 'send';

/**
 * Rename the message of the step — the object of the interaction that
 * carries it under the old name (`val messageName`) follows along.
 */
export function withMessageName(spec: ProcessSpec, stepId: string, name: string): ProcessSpec {
  let old: string | undefined;
  const walk = (steps: Step[]): Step[] => steps.map(s => {
    let next = s;
    if (s.id === stepId) {
      old = s.messageName;
      next = { ...s, messageName: name };
    }
    if (next.children) next = { ...next, children: walk(next.children) };
    if (next.branches) next = { ...next, branches: next.branches.map(b => ({ ...b, steps: walk(b.steps) })) };
    if (next.errors) next = { ...next, errors: next.errors.map(e => (e.steps ? { ...e, steps: walk(e.steps) } : e)) };
    return next;
  });
  const steps = walk(spec.steps);
  const interactions = spec.interactions?.map(i => (i.stepId === stepId && old !== undefined && i.key === old ? { ...i, key: name } : i));
  return { ...spec, steps, ...(interactions ? { interactions } : {}) };
}
