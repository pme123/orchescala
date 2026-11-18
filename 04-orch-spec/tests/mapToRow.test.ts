// «umwandeln in» closes only when the type is taken away - choosing the case keeps it open.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearsMapTo } from '../src/mapTo';

test('clearsMapTo: only a patch that takes the type away', () => {
  assert.equal(clearsMapTo({ mapToCase: 'Person' }), false);
  assert.equal(clearsMapTo({ mapToCase: undefined }), false);
  assert.equal(clearsMapTo({ mapTo: 'client', mapToCase: undefined }), false);
  assert.equal(clearsMapTo({ mapTo: undefined, mapToCase: undefined }), true);
});
