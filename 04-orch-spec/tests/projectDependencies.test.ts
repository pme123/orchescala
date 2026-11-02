// Example values (`default…`) only from projects the generated code sees:
// the own one and its dependencies from `PROJECT.conf`, transitively.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dependenciesOfConf, visibleRoots } from '../src/projectConf.ts';
import { indexTypes } from '../src/scala.ts';
import { mergeGeneratedCatalog } from '../src/catalogMerge.ts';
import type { DomainType, Field, Model } from '../src/types.ts';

test('PROJECT.conf: dependencies and workerDependencies, without comments', () => {
  const conf = `// Project configuration
projectName: acme-orders
dependencies: [
  // acme-old
  acme-commons
  "acme-banking", # the bank
]
workerDependencies: [ "acme-services", acme-commons ]
`;
  assert.deepEqual(dependenciesOfConf(conf), ['acme-commons', 'acme-banking', 'acme-services']);
  assert.deepEqual(dependenciesOfConf('projectName: acme-x\ndependencies: [\n  // mycompany-commons\n]\n'), []);
});

const type = (pkg: string, project: string): DomainType =>
  ({ id: `${pkg}.T`, name: 'T', pkg, kind: 'case', source: `${project}/01-domain/T.scala` }) as DomainType;

const model = (projects: Model['projects']): Model => ({
  services: [],
  projects,
  domainTypes: [
    type('acme.banking.domain', 'acme-banking'),
    type('acme.commons.domain', 'acme-commons'),
    type('other.party.domain.client.v1.schema', 'other-party'),
  ],
  domainDefaults: [
    { name: 'defaultFirstName', pkg: 'other.party.domain.client.v1.schema', type: 'String' },
    { name: 'defaultNogaCode', pkg: 'other.party.domain.client.v1.schema', type: 'String' },
    { name: 'defaultNogaCode', pkg: 'acme.commons.domain', type: 'String' },
    { name: 'defaultLastName', pkg: 'acme.banking.domain', type: 'String' },
    { name: 'defaultCurrency', pkg: 'acme.orchescala.domain', type: 'String' },
  ],
}) as Model;

const field = (name: string): Field => ({ id: name, name, type: 'String' });

test('a default of a project outside the dependencies is not used', () => {
  const m = model([{ id: 'p1', name: 'acme-orders', dependencies: ['acme-banking'] }, { id: 'p2', name: 'acme-banking', dependencies: ['acme-commons'] }]);
  const idx = indexTypes([], m, 'acme.orders');
  assert.equal(idx.defaultOf(field('firstName')), null);
  // from a dependency — and from its dependency, transitively
  assert.equal(idx.defaultOf(field('lastName'))?.pkg, 'acme.banking.domain');
  assert.equal(idx.defaultOf(field('nogaCode'))?.pkg, 'acme.commons.domain');
  // the company library: always
  assert.equal(idx.defaultOf(field('currency'))?.pkg, 'acme.orchescala.domain');
});

test('a project without known dependencies sees only itself and the library', () => {
  const idx = indexTypes([], model([]), 'acme.orders');
  assert.equal(idx.defaultOf(field('lastName')), null);
  assert.equal(idx.defaultOf(field('currency'))?.pkg, 'acme.orchescala.domain');
  // without a project (no generation): everything, as before
  assert.equal(indexTypes([], model([])).defaultOf(field('firstName'))?.pkg, 'other.party.domain.client.v1.schema');
});

test('the dependencies of the bundled catalog — the own scan wins', () => {
  const merged = mergeGeneratedCatalog(model([{ id: 'p1', name: 'acme-banking', dependencies: [] }]), {
    projects: [{ id: 'g1', name: 'acme-orders', dependencies: ['acme-banking'] }, { id: 'g2', name: 'acme-banking', dependencies: ['acme-commons'] }],
  });
  assert.deepEqual(merged.projectDependencies, { 'acme-orders': ['acme-banking'], 'acme-banking': ['acme-commons'] });
  assert.deepEqual([...visibleRoots(merged, 'acme.orders')].sort(), ['acme.banking', 'acme.orders']);
});
