import type { Model, StatusDef } from './types.ts';

// The status values of the Confluence page — starting point for an empty folder.
export const DEFAULT_STATUSES: StatusDef[] = [
  { label: 'OFFEN', color: 'neutral' },
  { label: 'IN BEARBEITUNG', color: 'blue' },
  { label: 'FINANZIERUNG NOTWENDIG', color: 'yellow' },
  { label: 'UNLÖSBAR', color: 'red' },
  { label: 'GELÖST', color: 'green', done: true },
];

export const DEFAULT_MODEL: Model = {
  version: 1,
  company: '',
  statuses: DEFAULT_STATUSES,
  howto: '',
};
