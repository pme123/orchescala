// `IdentityCorrelation` steht in orchescala.domain, nicht in den Projekten — also in
// keinem Katalog. Orch Spec kennt es eingebaut wie `ProcessStatus`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkTypes, scalaFiles } from '../src/scala';
import { domainTypeOf } from '../src/serviceTypes';
import type { Model, ProcessSpec } from '../src/types';

const model = { services: [], domainTypes: [{ id: 'acme.x.domain.Other', name: 'Other', pkg: 'acme.x.domain', kind: 'case', fields: [] }] } as unknown as Model;
const spec = {
  slug: 's', name: 'acme-demo-escalateV1', project: 'acme-demo', processId: 'acme-demo-escalateV1', engine: 'c7', steps: [],
  types: [{ id: 'in', name: 'In', kind: 'case', root: true,
    fields: [{ id: 'f', name: 'identityCorrelation', type: 'IdentityCorrelation', optional: true, example: 'None' }] }],
} as unknown as ProcessSpec;

test('IdentityCorrelation is known without a catalog entry', () => {
  assert.equal(domainTypeOf('IdentityCorrelation', model)?.id, 'orchescala.domain.IdentityCorrelation');
  assert.deepEqual(checkTypes(spec.types, model).filter(i => /nicht \(mehr\)/.test(i.message)), []);
});

test('the export writes it without an import - orchescala.domain comes with the company domain', () => {
  const all = scalaFiles(spec, model).map(f => f.content).join('\n');
  assert.match(all, /identityCorrelation: Option\[IdentityCorrelation\]/);
  assert.doesNotMatch(all, /import orchescala\.domain\.IdentityCorrelation/);
});

test('a project type of the same name wins over the built-in one', () => {
  const own = { services: [], domainTypes: [{ id: 'acme.x.domain.IdentityCorrelation', name: 'IdentityCorrelation', pkg: 'acme.x.domain', kind: 'case', fields: [] }] } as unknown as Model;
  assert.equal(domainTypeOf('IdentityCorrelation', own)?.id, 'acme.x.domain.IdentityCorrelation');
});
