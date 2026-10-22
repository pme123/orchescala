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

const merge = (previous: TypeDef[]) => {
  const fresh = spec([root('t-fresh'), enumType('t-fresh', ['ACTIVE', 'COMPLETED'])]);
  const { spec: merged } = mergeDomain(spec(previous), fresh, { status: { added: 'implemented', changed: 'changed' } });
  return (id: string) => merged.types?.find(t => t.id === id)?.values?.map(v => v.name) ?? [];
};

test('the used copy wins also when it stands first', () => {
  const values = merge([root('t-used'), enumType('t-used'), enumType('t-unused')]);
  assert.deepEqual(values('t-used'), ['ACTIVE', 'COMPLETED']);
  assert.deepEqual(values('t-unused'), []);
});

test('a reference from a stale type does not count - only what the root reaches', () => {
  // `Old.state` points to the unused copy, but `Old` is not reachable from `In`
  const old = { id: 't-old', name: 'Old', kind: 'case', status: 'implemented', fields: [{ id: 'f-old', name: 'state', type: 't-unused' }] } as TypeDef;
  const values = merge([root('t-used'), old, enumType('t-unused'), enumType('t-used')]);
  assert.deepEqual(values('t-used'), ['ACTIVE', 'COMPLETED']);
  assert.deepEqual(values('t-unused'), []);
});

test('no field points to either copy: falls back to the first one (no better choice)', () => {
  const values = merge([root('t-other'), enumType('t-first'), enumType('t-second')]);
  assert.deepEqual(values('t-first'), ['ACTIVE', 'COMPLETED']);
  assert.deepEqual(values('t-second'), []);
});

test('a copy reachable only through an interaction or an ADT case wins', () => {
  // no root points to the enum: In of an interaction → ADT case `Done(state)` → the used copy
  const adt = { id: 't-adt', name: 'Result', kind: 'enum', status: 'implemented', values: [{ name: 'Done', fields: [{ id: 'f-s', name: 'state', type: 't-used' }] }] } as TypeDef;
  const iaIn = { id: 't-ia-in', name: 'In', kind: 'case', status: 'implemented', fields: [{ id: 'f-r', name: 'result', type: 't-adt' }] } as TypeDef;
  const previous = { ...spec([iaIn, adt, enumType('t-unused'), enumType('t-used')]), interactions: [{ id: 'ia1', stepId: 'step1', inTypeId: 't-ia-in' }] } as unknown as ProcessSpec;
  const fresh = spec([enumType('t-fresh', ['ACTIVE', 'COMPLETED'])]);
  const { spec: merged } = mergeDomain(previous, fresh, { status: { added: 'implemented', changed: 'changed' } });
  const values = (id: string) => merged.types?.find(t => t.id === id)?.values?.map(v => v.name) ?? [];
  assert.deepEqual(values('t-used'), ['ACTIVE', 'COMPLETED']);
  assert.deepEqual(values('t-unused'), []);
});
