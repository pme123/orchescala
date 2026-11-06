// orch-spec-core through its real Scala.js build (src/core/orchSpecCore.js, linked by
// `sbt orchSpecCoreJS/linkToOrchSpec`) - the export, the types in orchSpecCore.d.ts and core.ts fit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageDiff } from '../src/core/core';
import { pageDiffJson } from '../src/core/orchSpecCore.js';
import type { Page } from '../src/pages/runtime/spec';

const page = (body: Page['body'], state?: Record<string, unknown>): Page =>
  ({ path: 'p', title: 'T', access: 'public', ...(state ? { state } : {}), body });

test('core.ts pageDiff - the Scala.js build answers, absent fields stay undefined', () => {
  const changes = pageDiff(page([{ type: 'text', text: 'A' }]), page([{ type: 'text', text: 'A' }, { type: 'button', label: 'Go', actions: [] }]));
  assert.deepEqual(changes, [{ kind: 'added', key: '1', label: 'Button «Go»' }]);
  assert.equal(changes[0].detail, undefined);
});

test('keys in another order - the block changed, the state a change of the page (as JSON.stringify)', () => {
  const before = page([{ type: 'text', text: 'A' }], { a: 1, b: 2 });
  const after = page([{ text: 'A', type: 'text' } as Page['body'][number]], { b: 2, a: 1 });
  assert.deepEqual(pageDiff(before, after).map((c) => [c.kind, c.key, c.label]), [
    ['page', undefined, 'Anfangszustand'],
    ['changed', '0', 'Text «A»'],
  ]);
});

test('pageDiffJson - JSON that cannot be read throws an Error with the reason', () => {
  assert.throws(() => pageDiffJson('{', '{}'), /before is no JSON/);
});
