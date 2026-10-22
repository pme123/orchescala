import type { EngineId, ProcessSpec, Step } from './types';

// ── Send a catching message ──────────────────────────────────────────────────
//
// The gateway takes `POST /message/{messageName}` with `businessKey` or
// `processInstanceId` as query parameter — the two ways to correlate; at the
// step one of them is chosen. For this Camunda 8 has the correlation key of the
// message (`zeebe:subscription`): `=businessKey` or `=processInstanceId`
// (the ID of the instance, set by the InitWorker) — the gateway gives it the
// `processInstanceId`, otherwise the `businessKey` (as in Camunda 7: the ID wins).
// Camunda 7 correlates directly via one of the two; there the choice is only in
// the specification (docs and the migration to Camunda 8).

export type CorrelationChoice = 'businessKey' | 'processInstanceId';

/** The correlation key per choice — that is how it appears in the BPMN in Camunda 8 */
export const CORRELATION_KEY: Record<CorrelationChoice, string> = {
  businessKey: '=businessKey',
  processInstanceId: '=processInstanceId',
};

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
   * `= processInstanceKey` — the old name of the variable; today the InitWorker
   * sets `processInstanceId` (engine-agnostic, like the gateway)
   */
  misnamed?: boolean;
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
  if (body === 'businessKey') return of('businessKey');
  if (body === 'processInstanceId') return of('processInstanceId');
  if (body === 'processInstanceKey') return { ...of('processInstanceId'), choice: null, misnamed: true };
  // another variable: its value is the key; otherwise an expression the sender computes
  const value = /^[A-Za-z_][\w.]*$/.test(body) ? `{{${body.split('.').pop()}}}` : `<${body}>`;
  return { choice: null, param: 'businessKey', value, expression };
}

/**
 * The chosen keys per step — for the migration to Camunda 8, which
 * otherwise suggests `=businessKey`.
 */
export function correlationKeysOf(spec: Pick<ProcessSpec, 'steps'>): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (steps: Step[]) => {
    for (const s of steps) {
      if (waitsForMessage(s) && s.correlationKey?.trim()) out[s.id] = s.correlationKey.trim();
      // a message on the boundary waits too — its element is the boundary event
      for (const e of s.errors ?? []) {
        if (e.eventKind === 'message' && e.boundaryId && e.correlationKey?.trim()) out[e.boundaryId] = e.correlationKey.trim();
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
