import type { EngineId, ProcessSpec, Step } from './types';

// ── Eine fangende Nachricht senden ───────────────────────────────────────────
//
// Das Gateway nimmt `POST /message/{messageName}` mit `businessKey` oder
// `processInstanceId` als Query-Parameter — die beiden Wege zu korrelieren; am
// Schritt wird einer gewählt. Camunda 8 hat dafür den Korrelationsschlüssel der
// Nachricht (`zeebe:subscription`): `=businessKey` bzw. `=processInstanceKey`
// (die ID der Instanz, gesetzt vom InitWorker) — das Gateway gibt ihm die
// `processInstanceId`, sonst den `businessKey` (wie in Camunda 7: die ID gewinnt).
// Camunda 7 korreliert direkt über einen der beiden; die Wahl steht dort nur in
// der Spezifikation (Doku und die Umstellung auf Camunda 8).

export type CorrelationChoice = 'businessKey' | 'processInstanceId';

/** Der Korrelationsschlüssel je Wahl — so steht er in Camunda 8 im BPMN */
export const CORRELATION_KEY: Record<CorrelationChoice, string> = {
  businessKey: '=businessKey',
  processInstanceId: '=processInstanceKey',
};

export interface MessageCorrelation {
  /** einer der beiden Wege — `null`: keiner gewählt bzw. ein anderer Ausdruck */
  choice: CorrelationChoice | null;
  /** Query-Parameter des Gateways */
  param: CorrelationChoice;
  /** Platzhalter für den Wert, z. B. `{{businessKey}}` */
  value: string;
  /** der Ausdruck, wie er am Schritt steht */
  expression?: string;
  /** Camunda 8 ohne Schlüssel — die Nachricht findet keine wartende Instanz */
  missing?: boolean;
  /** Camunda 7 ohne Wahl: der Sender nimmt einen der beiden */
  either?: boolean;
  /** ein fester Wert statt `= …` — alle Instanzen teilen ihn */
  fixed?: boolean;
  /**
   * `= processInstanceId` — die Variable gibt es in Camunda 8 nicht (der
   * InitWorker setzt `processInstanceKey`); gemeint ist sicher diese
   */
  misnamed?: boolean;
}

/** Wartet der Schritt auf eine Nachricht (Zwischenereignis, Empfangsaufgabe)? */
export const waitsForMessage = (step: Step): boolean =>
  step.kind === 'receive' || (step.kind === 'event' && step.eventKind === 'message' && step.eventDirection === 'catch');

/** Nur wer auf eine Nachricht wartet — sonst `null`. */
export function messageCorrelation(step: Step, engine: EngineId | undefined): MessageCorrelation | null {
  if (!waitsForMessage(step)) return null;
  const expression = step.correlationKey;
  const of = (choice: CorrelationChoice) => ({ choice, param: choice, value: `{{${choice}}}`, expression });
  if (!expression?.trim()) {
    return (engine ?? 'c7') === 'c7'
      ? { choice: null, param: 'businessKey', value: '{{businessKey}}', either: true }
      : { choice: null, param: 'businessKey', value: '{{businessKey}}', missing: true };
  }
  if (!expression.trim().startsWith('=')) return { choice: null, param: 'businessKey', value: expression.trim(), expression, fixed: true };
  const body = expression.replace(/^=\s*/, '').trim();
  if (body === 'businessKey') return of('businessKey');
  if (body === 'processInstanceKey') return of('processInstanceId');
  if (body === 'processInstanceId') return { ...of('processInstanceId'), choice: null, misnamed: true };
  // eine andere Variable: ihr Wert ist der Schlüssel; sonst ein Ausdruck, den der Sender ausrechnet
  const value = /^[A-Za-z_][\w.]*$/.test(body) ? `{{${body.split('.').pop()}}}` : `<${body}>`;
  return { choice: null, param: 'businessKey', value, expression };
}

/**
 * Die gewählten Schlüssel je Schritt — für die Umstellung auf Camunda 8, die
 * sonst `=businessKey` vorschlägt.
 */
export function correlationKeysOf(spec: Pick<ProcessSpec, 'steps'>): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (steps: Step[]) => {
    for (const s of steps) {
      if (waitsForMessage(s) && s.correlationKey?.trim()) out[s.id] = s.correlationKey.trim();
      walk([...(s.children ?? []), ...(s.branches ?? []).flatMap(b => b.steps), ...(s.errors ?? []).flatMap(e => e.steps ?? [])]);
    }
  };
  walk(spec.steps ?? []);
  return out;
}

/** Die Felder des `In` der Nachricht — leer, wenn sie kein eigenes Objekt hat. */
function inFields(step: Step, spec: Pick<ProcessSpec, 'interactions' | 'types'>): string[] {
  const ia = spec.interactions?.find(i => i.stepId === step.id);
  const t = ia?.inTypeId ? spec.types?.find(x => x.id === ia.inTypeId) : undefined;
  return (t?.fields ?? []).map(f => f.name);
}

/** Der Aufruf am Gateway — wie in Postman: `{{baseUrl}}` und die Variablen als Platzhalter. */
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

/** Kann der Schritt eine Nachricht bzw. ein Signal tragen? */
export const carriesMessage = (step: Step): boolean =>
  step.messageName !== undefined || step.eventKind === 'message' || step.eventKind === 'signal'
  || step.kind === 'receive' || step.kind === 'send';

/**
 * Die Nachricht des Schritts umbenennen — das Objekt der Interaktion, das sie
 * unter dem alten Namen führt (`val messageName`), zieht mit.
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
