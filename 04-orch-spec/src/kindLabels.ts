import type { StepKind } from './types.ts';

/** The kind of a step in words - for the app (ui.tsx re-exports it) and for Node (comments.ts). */
export const KIND_LABEL: Record<StepKind, string> = {
  start: 'Start', end: 'Ende', service: 'Service', user: 'Benutzeraufgabe', call: 'Teilprozess',
  send: 'Senden', receive: 'Empfangen', rule: 'Entscheidung', script: 'Skript', manual: 'Manuell',
  subprocess: 'Subprozess', gateway: 'Verzweigung', event: 'Ereignis', goto: 'Verweis',
};
