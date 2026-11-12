// The type of an output comes from its source, not from its name: `existingClient = composedClient`
// writes a new process variable that has the type of `composedClient` - a field of the Out with the
// name `existingClient` does not exist and is no yardstick.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expectedOfNode, outputSource, type VarNode } from '../src/feel';
import type { TypeDef } from '../src/types';

const composed: VarNode = {
  name: 'composedClient', type: 'context', label: 'ComposedClient', source: 'Ergebnis (GetClient.Out)',
  children: [{ name: 'client', type: 'context', label: 'Client', source: 'Feld von ComposedClient', children: [] }],
};
const vars: VarNode[] = [composed, { name: 'status', type: 'string', label: 'Status', source: 'In', values: ['open', 'closed'] }];

test('outputSource: a plain path into the variables - null for anything else', () => {
  assert.equal(outputSource('= composedClient', vars)?.label, 'ComposedClient');
  assert.equal(outputSource('=composedClient . client', vars)?.label, 'Client');
  assert.equal(outputSource('= composedClient.unknown', vars), null);
  assert.equal(outputSource('= if true then composedClient else null', vars), null);
  assert.equal(outputSource('composedClient', vars), null);
});

test('expectedOfNode: the kind of the chip from the node', () => {
  const client: TypeDef = { id: 'client', name: 'Client', kind: 'enum', values: [{ name: 'Person', fields: [] }] };
  assert.deepEqual(expectedOfNode(composed), { accepts: ['context'], label: 'ComposedClient', kind: 'class' });
  assert.equal(expectedOfNode(composed.children![0], [client])?.kind, 'enum');
  assert.deepEqual(expectedOfNode({ ...vars[1], optional: true }), { accepts: ['string', 'nil'], label: 'Status', kind: 'enum', values: ['open', 'closed'] });
  assert.equal(expectedOfNode({ name: 'xs', type: 'list', label: 'Seq[Client]', source: 'In' })?.kind, 'list');
  assert.equal(expectedOfNode({ name: 'm', type: 'context', label: 'Map[String, Json]', source: 'In', open: true })?.kind, 'map');
  assert.equal(expectedOfNode({ name: 'x', type: 'any', label: '?', source: 'Ausgabe' }), null);
});
