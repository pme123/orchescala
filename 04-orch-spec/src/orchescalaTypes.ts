// Typen aus `orchescala.domain`, die jede Spezifikation kennt — auch ohne
// Katalog. Sie stehen im Orchescala-Quelltext (01-domain), nicht in den
// Projekten, und kommen deshalb mit keinem Katalog-Aufbau herein.

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
    // `notSucceeded` hat in orchescala.domain keine Givens für den Singleton-Typ
    fixedCases: ['succeeded', 'output-mocked', 'failed', 'notValid', 'canceled'],
    generated: true,
  },
];

const withBuiltIn = new WeakMap<DomainType[], DomainType[]>();

/**
 * Die eingebauten Typen dazu — ausser ein Katalog bringt sie schon mit. Je
 * Katalog einmal gerechnet: das läuft bei jeder Typ-Auflösung.
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

/** Ein Katalog, nach ID, Name und letztem Namensteil nachschlagbar. */
export interface CatalogIndex {
  all: DomainType[];
  byId: Map<string, DomainType>;
  /** `GetAccount.Out` → die Typen mit genau diesem Namen, in Katalog-Reihenfolge */
  byName: Map<string, DomainType[]>;
  /** `Out` → die Typen, deren Name so endet (`GetAccount.Out`), in Katalog-Reihenfolge */
  byLast: Map<string, DomainType[]>;
}

const indexes = new WeakMap<DomainType[], CatalogIndex>();

/** Der Index eines Katalogs (samt den eingebauten Typen) — je Katalog einmal gebaut. */
export function catalogIndex(types: DomainType[] | undefined): CatalogIndex {
  const all = withOrchescalaTypes(types);
  const known = indexes.get(all);
  if (known) return known;
  const byId = new Map<string, DomainType>();
  const byName = new Map<string, DomainType[]>();
  const byLast = new Map<string, DomainType[]>();
  const push = (m: Map<string, DomainType[]>, k: string, t: DomainType) => {
    const l = m.get(k);
    if (l) l.push(t); else m.set(k, [t]);
  };
  for (const t of all) {
    if (!byId.has(t.id)) byId.set(t.id, t);
    push(byName, t.name, t);
    const dot = t.name.lastIndexOf('.');
    if (dot >= 0) push(byLast, t.name.slice(dot + 1), t);
  }
  const index = { all, byId, byName, byLast };
  indexes.set(all, index);
  return index;
}
