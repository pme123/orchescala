import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFolderJson } from '../src/companyFolder';

test('folder.json: the path of the company folder', () => {
  assert.equal(parseFolderJson({ path: '/co/00-docs/testdata/spec' }), '/co/00-docs/testdata/spec');
  assert.equal(parseFolderJson({ path: '  /co/00-docs/testdata/spec ' }), '/co/00-docs/testdata/spec');
});

test('folder.json: anything else is no hint', () => {
  for (const j of [null, undefined, {}, { path: '' }, { path: 3 }, 'index.html', []])
    assert.equal(parseFolderJson(j), null);
});
