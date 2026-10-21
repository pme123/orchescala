import type { EngineId, ProcessSpec, Step } from './types';

// ── Eine fangende Nachricht senden ───────────────────────────────────────────
//
// Das Gateway nimmt `POST /message/{messageName}` mit `businessKey` oder
// `processInstanceId` als Query-Parameter. Camunda 7 korreliert direkt über einen
// der beiden — der Sender wählt. Camunda 8 hat nur den Korrelationsschlüssel der
// Nachricht (`zeebe:subscription`); das Gateway gibt ihm den `businessKey`, sonst
// die `processInstanceId`. Welcher passt, sagt also der Ausdruck im BPMN:
// `=processInstanceKey` → `processInstanceId`, alles andere → `businessKey`.

export interface MessageCorrelation {
  /** Query-Parameter des Gateways */
  param: 'businessKey' | 'processInstanceId';
  /** Platzhalter für den Wert, z. B. `{{businessKey}}` */
  value: string;
  /** Camunda 8: der Ausdruck aus dem BPMN */
  expression?: string;
  /** Camunda 8 ohne Schlüssel — die Nachricht findet keine wartende Instanz */
  missing?: boolean;
  /** Camunda 7: statt `businessKey` geht auch `processInstanceId` */
  either?: boolean;
  /** Camunda 8: ein fester Wert statt `= …` — alle Instanzen teilen ihn */
  fixed?: boolean;
  /**
   * Camunda 8: `= processInstanceId` — die Variable gibt es dort nicht (der
   * InitWorker setzt `processInstanceKey`); gemeint ist sicher diese
   */
  misnamed?: boolean;
}

/** Der Schlüssel, wenn mit der ID der Instanz korreliert wird */
export const INSTANCE_KEY = '=processInstanceKey';

/** Nur wer auf eine Nachricht wartet (Zwischenereignis, Empfangsaufgabe) — sonst `null`. */
export function messageCorrelation(step: Step, engine: EngineId | undefined): MessageCorrelation | null {
  const waits = step.kind === 'receive' || (step.kind === 'event' && step.eventKind === 'message' && step.eventDirection === 'catch');
  if (!waits || !step.messageName) return null;
  if ((engine ?? 'c7') === 'c7') return { param: 'businessKey', value: '{{businessKey}}', either: true };
  const expression = step.correlationKey;
  if (!expression) return { param: 'businessKey', value: '{{businessKey}}', missing: true };
  if (!expression.trim().startsWith('=')) return { param: 'businessKey', value: expression.trim(), expression, fixed: true };
  const body = expression.replace(/^=\s*/, '').trim();
  if (body === 'processInstanceKey') return { param: 'processInstanceId', value: '{{processInstanceId}}', expression };
  if (body === 'processInstanceId') return { param: 'processInstanceId', value: '{{processInstanceId}}', expression, misnamed: true };
  // eine Variable: ihr Wert ist der Schlüssel; sonst ein Ausdruck, den der Sender ausrechnet
  const value = /^[A-Za-z_][\w.]*$/.test(body) ? `{{${body.split('.').pop()}}}` : `<${body}>`;
  return { param: 'businessKey', value, expression };
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
