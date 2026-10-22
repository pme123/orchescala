// A data model with two types of the same name — a duplicate left from an
// earlier sync (e.g. a second copy of the domain in `.claude/worktrees/…`).
// The sync gives the domain to the one the fields point to, not to the first
// in the list; the other one is reported as stale.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeDomain } from '../src/domainMerge';
import type { ProcessSpec, TypeDef } from '../src/types';

const enumType = (id: string, values: string[] = []): TypeDef =>
  ({ id, name: 'CProcessState', kind: 'enum', status: 'implemented', values: values.map(name => ({ name })) } as TypeDef);

const spec = (types: TypeDef[]): ProcessSpec => ({ slug: 's', processId: 'acme-demo-sendEvent', steps: [], types } as unknown as ProcessSpec);

const root = (stateType: string): TypeDef =>
  ({ id: 't-in', name: 'In', kind: 'case', root: true, status: 'implemented', fields: [{ id: 'f-state', name: 'state', type: stateType }] } as TypeDef);

test('of two types with the same name, the used one gets the domain - wherever it stands in the list', () => {
  // the unused duplicate first, the one In.state points to second
  const previous = spec([root('t-used'), enumType('t-unused'), enumType('t-used')]);
  const fresh = spec([root('t-fresh'), enumType('t-fresh', ['ACTIVE', 'COMPLETED'])]);
  const { spec: merged, report } = mergeDomain(previous, fresh, { status: { added: 'implemented', changed: 'changed' } });
  const byId = (id: string) => merged.types?.find(t => t.id === id);
  assert.deepEqual(byId('t-used')?.values?.map(v => v.name), ['ACTIVE', 'COMPLETED']);
  assert.equal(byId('t-in')?.fields?.[0].type, 't-used');
  assert.deepEqual(byId('t-unused')?.values ?? [], []);
  assert.ok(report.stale.includes('CProcessState'));
});
