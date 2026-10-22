// An enum whose cases carry a comment at the end of the line
// (`case ACTIVE // - running process instance`): the cases are read all the same.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanScala } from '../src/domainScan';
import { checkTypes } from '../src/scala';

const source = `package acme.demo.domain.send.v1.schema

enum CProcessState:
  case ACTIVE                // - running process instance
  case SUSPENDED             // - suspended process instances
  case EXTERNALLY_TERMINATED // - terminated externally
end CProcessState

enum Channel:
  case Mail, Phone // - both
  case Web(url: String = "https://acme.ch") // - with a default containing //
end Channel

object CProcessState:
  given ApiSchema[CProcessState] = deriveEnumApiSchema
`;

const byName = (name: string) => scanScala(source, 'X.scala').find(t => t.name === name)!;

test('enum cases with a comment at the end of the line are read', () => {
  assert.deepEqual(byName('CProcessState').values, ['ACTIVE', 'SUSPENDED', 'EXTERNALLY_TERMINATED']);
});

test('the comment does not break a list of cases or a case with parameters', () => {
  const channel = byName('Channel');
  assert.deepEqual(channel.values, ['Mail', 'Phone', 'Web']);
  assert.deepEqual(channel.cases?.find(c => c.name === 'Web')?.fields?.map(f => f.name), ['url']);
});

test('an enum value with underscores is a valid name - one with a hyphen is not', () => {
  const enumOf = (...names: string[]) => [{ id: 't1', name: 'CProcessState', kind: 'enum' as const, values: names.map(name => ({ name })) }];
  const messages = (...names: string[]) => checkTypes(enumOf(...names) as never).map(i => i.message);
  assert.deepEqual(messages('ACTIVE', 'EXTERNALLY_TERMINATED'), []);
  assert.ok(messages('QI-Deklaration').some(m => m.includes('kein gültiger Name')));
  assert.deepEqual(messages('`QI-Deklaration`'), []);
});
