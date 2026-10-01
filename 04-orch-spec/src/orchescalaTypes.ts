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

/** Die eingebauten Typen dazu — ausser ein Katalog bringt sie schon mit. */
export function withOrchescalaTypes(types: DomainType[] | undefined): DomainType[] {
  const have = new Set((types ?? []).map(t => t.id));
  return [...(types ?? []), ...ORCHESCALA_TYPES.filter(t => !have.has(t.id))];
}
