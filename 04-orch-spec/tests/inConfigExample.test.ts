// `inConfig: Option[InConfig] = None` — wie in Orchescala: die Vorgabe steht in
// der Klasse, in `example` und `exampleMinimal` fehlt das Feld.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { indexTypes, renderType } from '../src/scala';
import type { TypeDef } from '../src/types';

const inConfig: TypeDef = { id: 'cfg', name: 'InConfig', kind: 'case', inConfig: true, fields: [] } as unknown as TypeDef;
const cfgField = { id: 'f9', name: 'inConfig', type: 'cfg', optional: true, example: 'None' };

test('case class: inConfig has the default None and is not in the examples', () => {
  const t = { id: 'in', name: 'In', kind: 'case', fields: [
    { id: 'f1', name: 'fileId', type: 'String', optional: true },
    { id: 'f2', name: 'formNr', type: 'String' },
    cfgField,
  ] } as unknown as TypeDef;
  const out = renderType(t, indexTypes([t, inConfig]));
  assert.match(out, /inConfig: Option\[InConfig\] = None/);
  assert.doesNotMatch(out, /inConfig = /);
  assert.match(out, /lazy val exampleMinimal = example\.copy\(\n\s+fileId = None\n\s+\)/);
});

test('case class with only inConfig: In() as example', () => {
  const t = { id: 'in', name: 'In', kind: 'case', fields: [cfgField] } as unknown as TypeDef;
  const out = renderType(t, indexTypes([t, inConfig]));
  assert.match(out, /lazy val example = In\(\)/);
  assert.match(out, /lazy val exampleMinimal = example$/m);
});

test('enum cases: inConfig = None in each case, not in their examples', () => {
  const t = { id: 'in', name: 'In', kind: 'enum', fields: [cfgField], values: [
    { name: 'ByFile', fields: [{ id: 'f1', name: 'fileId', type: 'String' }] },
    { name: 'ByLink', fields: [{ id: 'f2', name: 'fileLink', type: 'String' }] },
  ] } as unknown as TypeDef;
  const out = renderType(t, indexTypes([t, inConfig]));
  assert.equal(out.match(/inConfig: Option\[InConfig\] = None/g)?.length, 2, out);
  assert.doesNotMatch(out, /inConfig = /);
});
