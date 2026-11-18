// The Out of an orchestration against the process variables: each field needs one (its name or type) -
// or a mapping - of its type; the variables the Out could get, as fields.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { installNodeDom } from '../src/core';
import { newServiceProcess } from '../src/services/serviceProcess';
import { fieldOfVariable, outFieldIssues, outVariables } from '../src/services/outVariables';
import type { Field, ProcessSpec } from '../src/types';

installNodeDom(DOMParser);

function spec(out: Field[], outMappings?: { name: string; expression: string }[]): ProcessSpec {
  const { spec: s } = newServiceProcess({ title: 'Datei', project: 'acme-crm', api: 'file', apiVersion: 1, name: 'CheckFile' });
  const f = (name: string, type: string, optional = false): Field => ({ id: `in-${name}`, name, type, ...(optional ? { optional: true } : {}) });
  return {
    ...s,
    ...(outMappings ? { service: { ...s.service, outMappings } } : {}),
    types: s.types!.map(t => (t.root ? { ...t, fields: [f('fileId', 'String'), f('count', 'Int', true), f('amount', 'BigDecimal')] }
      : t.processOut ? { ...t, fields: out } : t)),
  } as ProcessSpec;
}
const field = (name: string, type: string, optional = false): Field => ({ id: `out-${name}`, name, type, ...(optional ? { optional: true } : {}) });
const messages = (s: ProcessSpec) => outFieldIssues(s, null).map(i => i.message);

test('a field of the Out: a variable of its name and type is fine; none, another type or one that may be missing is said', () => {
  assert.deepEqual(messages(spec([field('fileId', 'String'), field('count', 'Int', true)])), []);
  const m = messages(spec([field('docId', 'Long'), field('amount', 'String'), field('count', 'Int')]));
  assert.equal(m.length, 3, m.join('\n'));
  assert.match(m[0], /«docId»: keine Prozessvariable dieses Namens oder Typs/);
  assert.match(m[1], /«amount» ist String, die Prozessvariable ist BigDecimal \(In\)/);
  assert.match(m[2], /«count»: die Prozessvariable ist Option\[Int\] und kann fehlen/);
  // a mapping at the end decides - nothing to say
  assert.deepEqual(messages(spec([field('docId', 'String')], [{ name: 'docId', expression: '= fileId' }])), []);
});

test('the variables the Out could get - as a field of the type their source gives', () => {
  const s = spec([]);
  const vars = outVariables(s, null);
  assert.deepEqual(vars.map(v => v.name).filter(n => ['fileId', 'count', 'amount'].includes(n)), ['fileId', 'count', 'amount']);
  const count = fieldOfVariable(vars.find(v => v.name === 'count')!, s.types ?? []);
  assert.deepEqual([count.name, count.type, count.optional], ['count', 'Int', true]);
});
