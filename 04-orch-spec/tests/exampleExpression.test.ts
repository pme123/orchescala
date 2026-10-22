// Beispiele aus der Domain kommen als Scala-Ausdruck — der Export schreibt sie so zurück.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exampleValue, looksLikeScala } from '../src/scala';
import type { Field } from '../src/types';

const idx = { nameOf: (t: string) => t, domainOf: () => undefined } as never;
const field = (f: Partial<Field>): Field => ({ id: 'f', name: 'x', type: 'String', ...f });

test('a path with backticks is Scala, not text - SubStatusKeyDocuments.`documents-prepared`.toString', () => {
  assert.ok(looksLikeScala('SubStatusKeyDocuments.`documents-prepared`.toString', 'example'));
  assert.equal(exampleValue(field({ example: 'SubStatusKeyDocuments.`documents-prepared`.toString' }), idx),
    'SubStatusKeyDocuments.`documents-prepared`.toString');
  // Prosa bleibt Text
  assert.equal(exampleValue(field({ example: 'documents prepared' }), idx), '"documents prepared"');
});

test('an optional field: Option(…) is already the wrapper - no Some(Option(…))', () => {
  assert.equal(exampleValue(field({ optional: true, example: 'Option("a7788e13")' }), idx), 'Option("a7788e13")');
  assert.equal(exampleValue(field({ optional: true, example: 'Some("x")' }), idx), 'Some("x")');
  assert.equal(exampleValue(field({ optional: true, example: '"x"' }), idx), 'Some("x")');
});
