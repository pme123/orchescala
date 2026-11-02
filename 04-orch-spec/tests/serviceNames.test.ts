// Names of imported types and services: as the helper's OpenAPI generator, without repeats.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withMethod, withoutRepeatedPrefix } from '../src/services/names.ts';
import { addOperations, readApi } from '../src/services/openApiRest.ts';
import { newCollection } from '../src/services/collection.ts';

test('a leading part that comes again in the rest falls away - also in the singular', () => {
  assert.equal(withoutRepeatedPrefix('MultipleNaturalPersonsReadMultipleNaturalPerson2Request'), 'ReadMultipleNaturalPerson2Request');
  assert.equal(withoutRepeatedPrefix('MultipleNaturalPersonsMultipleNaturalPerson2'), 'MultipleNaturalPerson2');
  assert.equal(withoutRepeatedPrefix('NaturalPersonReadNaturalPerson2Response'), 'ReadNaturalPerson2Response');
  assert.equal(withoutRepeatedPrefix('NaturalPersonNaturalPerson3'), 'NaturalPerson3');
  assert.equal(withoutRepeatedPrefix('MultipleNaturalPersonsReadMultipleNaturalPerson2'), 'ReadMultipleNaturalPerson2');
  // nothing repeated: stays
  for (const n of ['NaturalPersonGender1', 'TypeDateWrapper', 'AddressDtoV2', 'GetClient', 'Client']) assert.equal(withoutRepeatedPrefix(n), n);
});

test('the HTTP method first - not twice', () => {
  assert.equal(withMethod('POST', 'ReadMultipleNaturalPerson2'), 'PostReadMultipleNaturalPerson2');
  assert.equal(withMethod('GET', 'GetClient'), 'GetClient');
  assert.equal(withMethod('delete', 'Rules'), 'DeleteRules');
  // «Getter» is no «Get»
  assert.equal(withMethod('GET', 'GetterInfo'), 'GetGetterInfo');
});

// as a generated API names them: the package in front of each message
const doc = {
  openapi: '3.0.3',
  info: { title: 'ClientMaster - MultipleNaturalPersons', version: '1' },
  paths: {
    '/api/ClientMaster/v1/MultipleNaturalPersons/ReadMultipleNaturalPerson2': {
      post: {
        operationId: 'MultipleNaturalPersons_ReadMultipleNaturalPerson2',
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/MultipleNaturalPersonsReadMultipleNaturalPerson2Request' } } } },
        responses: { 200: { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/MultipleNaturalPersonsReadMultipleNaturalPerson2Response' } } } } },
      },
    },
    '/clients/{clientKey}': {
      get: { operationId: 'getClient', parameters: [{ name: 'clientKey', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'ok' } } },
    },
  },
  components: {
    schemas: {
      MultipleNaturalPersonsReadMultipleNaturalPerson2Request: { type: 'object', properties: { clientKeys: { type: 'array', items: { type: 'string' } } } },
      MultipleNaturalPersonsReadMultipleNaturalPerson2Response: { type: 'object', properties: { persons: { type: 'array', items: { $ref: '#/components/schemas/MultipleNaturalPersonsMultipleNaturalPerson2' } } } },
      MultipleNaturalPersonsMultipleNaturalPerson2: { type: 'object', properties: { gender: { $ref: '#/components/schemas/MultipleNaturalPersonsGender1' }, birthDate: { $ref: '#/components/schemas/typeDateWrapper' } } },
      MultipleNaturalPersonsGender1: { type: 'string', enum: ['GENDER1_FEMALE', 'GENDER1_MALE'] },
      typeDateWrapper: { type: 'object', properties: { value: { type: 'string' } } },
    },
  },
};

test('import: services and types without the repeated package', () => {
  const api = readApi(doc);
  assert.deepEqual(api.operations.map(o => o.name), ['PostReadMultipleNaturalPerson2', 'GetClient']);
  const c = newCollection({ title: 'T', project: 'acme-crm', api: 'clientMaster', apiVersion: 1 });
  const { spec } = addOperations(c, api, api.operations.map(o => o.key));
  assert.deepEqual(spec.services.map(s => s.name), ['PostReadMultipleNaturalPerson2', 'GetClient']);
  const names = spec.types.filter(t => !t.interactionId).map(t => t.name).sort();
  for (const n of ['ReadMultipleNaturalPerson2Request', 'ReadMultipleNaturalPerson2Response', 'MultipleNaturalPerson2', 'MultipleNaturalPersonsGender1', 'TypeDateWrapper']) {
    assert.ok(names.includes(n), `${n} in ${names.join(', ')}`);
  }
});

test('import: two schemas that would get the same name keep theirs', () => {
  const twice = {
    ...doc,
    components: {
      schemas: {
        ...doc.components.schemas,
        // without the prefix both would be `ReadMultipleNaturalPerson2Request`
        ReadMultipleNaturalPerson2Request: { type: 'object', properties: { other: { type: 'string' } } },
      },
    },
  };
  const api = readApi(twice);
  const c = newCollection({ title: 'T', project: 'acme-crm', api: 'clientMaster', apiVersion: 1 });
  const { spec } = addOperations(c, api, [api.operations[0].key]);
  assert.ok(spec.types.some(t => t.name === 'MultipleNaturalPersonsReadMultipleNaturalPerson2Request'));
});
