// FEEL compares a simple enum as text: after `=` or `!=` with such a variable the completion
// offers its values as strings — typed is a part of a value or of the name of the enum.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanScala } from '../src/domainScan';
import { completions, fieldVariables } from '../src/feel';
import type { Model, TypeDef } from '../src/types';

const shared = `package acme.crm.domain
package clientMaster.schema

enum ClientMainType1:
  case Person, Company, Group
`;
const model = { version: 1, domainTypes: scanScala(shared, 'clientMaster/schema/ClientMainType1.scala') } as unknown as Model;
const own: TypeDef = { id: 'k', name: 'Kind', kind: 'enum', values: [{ name: 'gold' }, { name: 'silver' }] } as TypeDef;
const vars = fieldVariables([
  { id: 'a', name: 'clientMainType', type: 'dom:acme.crm.domain.clientMaster.schema.ClientMainType1', optional: true },
  { id: 'b', name: 'client', type: 'c' },
], 'Ausgabe von Service aufrufen', [own, { id: 'c', name: 'Client', kind: 'case', fields: [{ id: 'x', name: 'kind', type: 'k' }] } as TypeDef], model);

const values = (text: string, cursor = text.length) => {
  const r = completions(text, cursor, vars);
  return r?.items.map(i => i.insert);
};

test('after = with an enum of the domain: its values as strings - also before anything is typed', () => {
  assert.deepEqual(vars[0].values, ['Person', 'Company', 'Group']);
  assert.deepEqual(values('= clientMainType = '), ['"Person"', '"Company"', '"Group"']);
  assert.equal(completions('= clientMainType = ', 19, vars)?.values, true);
  assert.deepEqual(values('= clientMainType != Co'), ['"Company"']);
  // a part of the name of the enum: all of them
  assert.deepEqual(values('= clientMainType = ClientMainT'), ['"Person"', '"Company"', '"Group"']);
});

test('inside the quotes: the value replaces them; a field of an own enum in a path', () => {
  const text = '= clientMainType = "Pe"';
  const r = completions(text, text.length - 1, vars)!;
  assert.deepEqual(r.items.map(i => i.insert), ['"Person"']);
  assert.deepEqual([r.from, r.to], [text.indexOf('"'), text.length]);
  assert.deepEqual(values('= client.kind = g'), ['"gold"']);
  assert.ok(completions('= client.kind = g', 18, vars)?.items[0].enumOf);
});

test('no enum: the variables as before', () => {
  assert.deepEqual(values('= clientMa'), ['clientMainType']);
  assert.equal(values('= client.kind = x'), undefined);
});
