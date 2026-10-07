// Die exportierten Dateien teilen ihre Paket-Zeile nach `domain` — wie die
// Domain-Dateien von Hand: alles aus `valiant.product.domain` ist ohne Import sichtbar.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packageClause } from '../src/scala';

test('package clause split after domain', () => {
  assert.equal(packageClause('valiant.product.domain.lilaSet.v2'), 'package valiant.product.domain\npackage lilaSet.v2');
  assert.equal(packageClause('valiant.product.domain.lilaSet.v2.schema'), 'package valiant.product.domain\npackage lilaSet.v2.schema');
  // ohne `domain` — oder nichts danach: eine Zeile
  assert.equal(packageClause('acme.demo'), 'package acme.demo');
  assert.equal(packageClause('acme.domain'), 'package acme.domain');
});
