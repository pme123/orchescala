// An OpenAPI chosen at «Neue Collection»: read once, it suggests title and API,
// and waits for the new collection to open its import.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectionSuggestion, handOverOpenApi, parseOpenApi, takeOpenApi } from '../src/services/openApiFile.ts';

const yaml = `
openapi: 3.0.1
info: { title: Natural Person API, version: '2' }
paths:
  /persons/{key}:
    get: { responses: { '200': { description: ok } } }
  /persons:
    post: { responses: { '201': { description: created } } }
  /addresses:
    get: { responses: { '200': { description: ok } } }
`;

test('YAML or JSON, a problem named with the file', () => {
  const r = parseOpenApi(yaml, 'person.yml');
  assert.ok(r.ok);
  const bad = parseOpenApi('{', 'person.json');
  assert.ok(!bad.ok && /person\.json.*nicht lesbar/.test(bad.message));
  const old = parseOpenApi(JSON.stringify({ swagger: '1.2', paths: {} }), 'old.json');
  assert.ok(!old.ok && /Swagger 1\.2/.test(old.message));
});

test('title and the API most operations suggest — under the sub path', () => {
  const r = parseOpenApi(yaml, 'person.yml');
  assert.ok(r.ok);
  assert.deepEqual(collectionSuggestion(r.value), { title: 'Natural Person API', api: 'person' });
  assert.deepEqual(collectionSuggestion(r.value, '/addresses'), { title: 'Natural Person API', api: 'address' });
});

test('the file waits for its collection — once', () => {
  const r = parseOpenApi(yaml, 'person.yml');
  assert.ok(r.ok);
  handOverOpenApi('acme-crm-personen', r.value);
  assert.equal(takeOpenApi('acme-crm-other'), null);
  assert.equal(takeOpenApi('acme-crm-personen')?.file, 'person.yml');
  assert.equal(takeOpenApi('acme-crm-personen'), null);
});
