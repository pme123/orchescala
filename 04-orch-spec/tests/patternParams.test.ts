// The value of a pattern parameter in the form of the engine - shown as FEEL or text.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paramForChecked, paramStored, paramStoredChecked, paramView } from '../src/patternParams';

test('fixed text stays text on both engines', () => {
  for (const engine of ['c7', 'c8'] as const) assert.equal(paramStored('Kunde gesperrt.', engine), 'Kunde gesperrt.');
  assert.equal(paramView('Kunde gesperrt.'), 'Kunde gesperrt.');
});

test('FEEL is stored as =… on C8 and as ${…} on C7 - and shown as FEEL again', () => {
  const feel = '= "Kunde " + customerName';
  assert.equal(paramStored(feel, 'c8'), '="Kunde " + customerName');
  const c7 = paramStored(feel, 'c7');
  assert.equal(c7, '${"Kunde ".concat(customerName)}');
  assert.equal(paramView(c7), '= "Kunde " + string(customerName)');
  assert.equal(paramView('="Kunde " + customerName'), feel);
});

test('FEEL without JUEL counterpart: stays FEEL on C7, with the reason', () => {
  const r = paramStoredChecked('= string join(["a", "b"], ", ")', 'c7');
  assert.equal(r.value, '= string join(["a", "b"], ", ")');
  assert.ok(r.untranslated?.includes('string join'), r.untranslated);
  assert.equal(paramStoredChecked('= string join(["a"], ",")', 'c8').untranslated, undefined);
});

test('from one engine to the other', () => {
  assert.equal(paramForChecked('${"Kunde ".concat(customerName)}', 'c8').value, '="Kunde " + string(customerName)');
  assert.equal(paramForChecked('="Kunde " + customerName', 'c7').value, '${"Kunde ".concat(customerName)}');
  assert.equal(paramForChecked('Kunde gesperrt.', 'c8').value, 'Kunde gesperrt.');
});
