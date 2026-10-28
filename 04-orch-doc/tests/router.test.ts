// The app scrolls to the top on a new page - not when another operation is selected.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageKey, parseHash } from '../src/router';

const key = (hash: string) => pageKey(parseHash(hash));

test('pageKey: another operation on the same API page is the same page', () => {
  assert.equal(key('#/acme/api/acme-patterns?op=Process%20start'), key('#/acme/api/acme-patterns'));
  assert.equal(key('#/acme/api/acme-patterns?op=a'), key('#/acme/api/acme-patterns?op=b'));
});

test('pageKey: another project, company or kind is another page', () => {
  assert.notEqual(key('#/acme/api/acme-patterns?op=a'), key('#/acme/api/acme-customer?op=a'));
  assert.notEqual(key('#/acme/api/acme-patterns'), key('#/other/api/acme-patterns'));
  assert.notEqual(key('#/acme/api/acme-patterns'), key('#/acme/dependencies/acme-patterns'));
  assert.notEqual(key('#/acme/p/guide/a'), key('#/acme/p/guide/b'));
});

test('pageKey: a new catalog search is a new page', () => {
  assert.notEqual(key('#/acme/catalog?q=a'), key('#/acme/catalog?q=b'));
});
