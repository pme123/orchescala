// A type name of a catalog class resolved as Scala sees it: its own package, those below it, then the
// packages around it (the nearest first) - before a class of the same name of another project.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveType } from '../src/interactions';
import type { DomainType, Model } from '../src/types';

const type = (pkg: string, name: string): DomainType => ({ id: `${pkg}.${name}`, name, pkg, kind: 'case', importPath: `${pkg}.${name}` }) as DomainType;

test('a name of a field: the class of the package around it wins over one of the same name of another project', () => {
  // the local collection comes first in the catalog - it must not win over the package around the field
  const model = { version: 1, services: [], domainTypes: [type('acme.crm.domain.client.v1.schema', 'ClientType'), type('globex.core.domain', 'ClientType')] } as unknown as Model;
  assert.equal(resolveType('ClientType', model, 'globex.core.domain.client.v1.schema')?.id, 'globex.core.domain.ClientType');
  // its own package first
  const own = { ...model, domainTypes: [...model.domainTypes!, type('globex.core.domain.client.v1.schema', 'ClientType')] } as Model;
  assert.equal(resolveType('ClientType', own, 'globex.core.domain.client.v1.schema')?.id, 'globex.core.domain.client.v1.schema.ClientType');
  // nothing around it: the first of the name
  assert.equal(resolveType('ClientType', model, 'initech.domain.v1.schema')?.id, 'acme.crm.domain.client.v1.schema.ClientType');
});
