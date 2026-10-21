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
}

/** Nur wer auf eine Nachricht wartet (Zwischenereignis, Empfangsaufgabe) — sonst `null`. */
export function messageCorrelation(step: Step, engine: EngineId | undefined): MessageCorrelation | null {
  const waits = step.kind === 'receive' || (step.kind === 'event' && step.eventKind === 'message' && step.eventDirection === 'catch');
  if (!waits || !step.messageName) return null;
  if ((engine ?? 'c7') === 'c7') return { param: 'businessKey', value: '{{businessKey}}', either: true };
  const expression = step.correlationKey;
  if (!expression) return { param: 'businessKey', value: '{{businessKey}}', missing: true };
  const body = expression.replace(/^=\s*/, '').trim();
  if (body === 'processInstanceKey') return { param: 'processInstanceId', value: '{{processInstanceId}}', expression };
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
