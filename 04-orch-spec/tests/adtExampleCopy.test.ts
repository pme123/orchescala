// The example of an ADT is typed with the enum (`lazy val example: Out = Graviton.example`),
// which has no `.copy`. Differing example values of an interaction therefore go to a case
// example, which is typed with the case.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scalaFiles } from '../src/scala';
import type { Interaction, ProcessSpec, TypeDef } from '../src/types';

const out: TypeDef = {
  id: 't-out', name: 'Out', kind: 'enum', interactionId: 'ia',
  fields: [{ name: 'key', type: 'String' }],
  values: [
    { name: 'Graviton', fields: [{ name: 'score', type: 'Int' }] },
    { name: 'CAM', fields: [{ name: 'text', type: 'String' }] },
  ],
} as unknown as TypeDef;
const inT: TypeDef = { id: 't-in', name: 'In', kind: 'case', interactionId: 'ia', fields: [{ name: 'clientKey', type: 'Long' }] } as unknown as TypeDef;

const exported = (outExample?: Record<string, string>): string => {
  const ia = { id: 'ia', stepId: 's', kind: 'customTask', name: 'GetStatus', key: 'get-status', inTypeId: 't-in', outTypeId: 't-out', inExample: { clientKey: '2L' }, outExample } as Interaction;
  const spec = { processId: 'acme-demo-statusV1', name: 'acme-demo-statusV1', project: 'acme-demo', steps: [{ id: 's', kind: 'service', name: 'get status', status: 'accepted' }], types: [inT, out], interactions: [ia] } as unknown as ProcessSpec;
  return scalaFiles(spec).map(f => f.content).find(c => c.includes('object GetStatus'))!;
};

test('interaction example: the values of an ADT Out go to the case that has them', () => {
  assert.match(exported({ text: '"x"' }), /Out\.CAM\.example\.copy\(text = "x"\)/);
  assert.match(exported({ score: '3' }), /Out\.Graviton\.example\.copy\(score = 3\)/);
  // a shared field: the first case
  assert.match(exported({ key: '"k"' }), /Out\.Graviton\.example\.copy\(key = "k"\)/);
  // no Out.example.copy, which would not compile
  assert.doesNotMatch(exported({ text: '"x"' }), /Out\.example\.copy/);
});

test('interaction example: without values Out.example; a class In keeps In.example.copy', () => {
  const content = exported();
  assert.match(content, /In\.example\.copy\(clientKey = 2L\)/);
  assert.match(content, /lazy val example: Out = Graviton\.example/);
  assert.doesNotMatch(content, /Out\.\w+\.example\.copy/);
});
