// Types from `orchescala.domain` that every specification knows — even without a
// catalog. They live in the Orchescala source (01-domain), not in the
// projects, and therefore never come in with a catalog build.

import type { DomainType } from './types';

export const ORCHESCALA_TYPES: DomainType[] = [
  {
    id: 'orchescala.domain.ProcessStatus',
    name: 'ProcessStatus',
    pkg: 'orchescala.domain',
    kind: 'enum',
    importPath: 'orchescala.domain.ProcessStatus',
    descr: 'Status, mit dem ein Prozess endet — als fester Fall im Out: `processStatus: ProcessStatus.succeeded.type = ProcessStatus.succeeded`.',
    values: ['succeeded', 'notSucceeded', 'output-mocked', 'failed', 'notValid', 'canceled'],
    // `notSucceeded` has no givens for the singleton type in orchescala.domain
    fixedCases: ['succeeded', 'output-mocked', 'failed', 'notValid', 'canceled'],
    generated: true,
  },
  {
    // who started a process or completed a task — set by the gateway from the
    // token (signed, `_identityCorrelation`); a subprocess gets it as input
    id: 'orchescala.domain.IdentityCorrelation',
    name: 'IdentityCorrelation',
    pkg: 'orchescala.domain',
    kind: 'case',
    importPath: 'orchescala.domain.IdentityCorrelation',
    descr: 'Wer den Prozess gestartet bzw. mit ihm interagiert hat — der Gateway setzt sie aus dem Token und signiert sie (`_identityCorrelation`).',
    fields: [
      { name: 'username', type: 'String', description: 'The username of the user that started or interacted with the process' },
      { name: 'email', type: 'Option[String]', description: 'The email of the user that started or interacted with the process' },
      { name: 'impersonateProcessValue', type: 'Option[String]', description: 'An optional value that you need to verify the identity. E.g. the id of the customer.' },
      { name: 'issuedAt', type: 'Long', description: 'The timestamp (milliseconds since epoch) when the identity correlation was created' },
      { name: 'processInstanceId', type: 'Option[String]', description: 'The process instance ID this correlation is bound to (set after process start)' },
      { name: 'signature', type: 'Option[String]', description: 'HMAC signature binding the identity to the process instance' },
    ],
    generated: true,
  },
];

const withBuiltIn = new WeakMap<DomainType[], DomainType[]>();

/**
 * The built-in types on top — unless a catalog already brings them. Computed
 * once per catalog: this runs on every type resolution.
 */
export function withOrchescalaTypes(types: DomainType[] | undefined): DomainType[] {
  if (!types) return ORCHESCALA_TYPES;
  const known = withBuiltIn.get(types);
  if (known) return known;
  const have = new Set(types.map(t => t.id));
  const all = ORCHESCALA_TYPES.every(t => have.has(t.id)) ? types : [...types, ...ORCHESCALA_TYPES.filter(t => !have.has(t.id))];
  withBuiltIn.set(types, all);
  return all;
}

/** A catalog that can be looked up by ID, name and last name segment. */
export interface CatalogIndex {
  all: DomainType[];
  byId: Map<string, DomainType>;
  /** `GetAccount.Out` → the types with exactly this name, in catalog order */
  byName: Map<string, DomainType[]>;
  /** `Out` → the types whose name ends like this (`GetAccount.Out`), in catalog order */
  byLast: Map<string, DomainType[]>;
  /** Types with an owner (process or worker object) by `processName`, `topicName` and owner */
  byProcess: Map<string, DomainType[]>;
  byTopic: Map<string, DomainType[]>;
  byOwner: Map<string, DomainType[]>;
}

const indexes = new WeakMap<DomainType[], CatalogIndex>();

/** The index of a catalog (including the built-in types) — built once per catalog. */
export function catalogIndex(types: DomainType[] | undefined): CatalogIndex {
  const all = withOrchescalaTypes(types);
  const known = indexes.get(all);
  if (known) return known;
  const byId = new Map<string, DomainType>();
  const byName = new Map<string, DomainType[]>();
  const byLast = new Map<string, DomainType[]>();
  const byProcess = new Map<string, DomainType[]>();
  const byTopic = new Map<string, DomainType[]>();
  const byOwner = new Map<string, DomainType[]>();
  const push = (m: Map<string, DomainType[]>, k: string, t: DomainType) => {
    const l = m.get(k);
    if (l) l.push(t); else m.set(k, [t]);
  };
  for (const t of all) {
    if (!byId.has(t.id)) byId.set(t.id, t);
    push(byName, t.name, t);
    const dot = t.name.lastIndexOf('.');
    if (dot >= 0) push(byLast, t.name.slice(dot + 1), t);
    if (t.owner) {
      if (t.processName) push(byProcess, t.processName, t);
      if (t.topicName) push(byTopic, t.topicName, t);
      push(byOwner, t.owner, t);
    }
  }
  const index = { all, byId, byName, byLast, byProcess, byTopic, byOwner };
  indexes.set(all, index);
  return index;
}
