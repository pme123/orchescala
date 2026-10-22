// The exported files split their package line at `domain` — like the
// hand-written domain files: everything from `valiant.product.domain` is visible without import.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packageClause } from '../src/scala';

test('package clause split after domain', () => {
  assert.equal(packageClause('valiant.product.domain.lilaSet.v2'), 'package valiant.product.domain\npackage lilaSet.v2');
  assert.equal(packageClause('valiant.product.domain.lilaSet.v2.schema'), 'package valiant.product.domain\npackage lilaSet.v2.schema');
  // without `domain` — or nothing after it: one line
  assert.equal(packageClause('acme.demo'), 'package acme.demo');
  assert.equal(packageClause('acme.domain'), 'package acme.domain');
});
