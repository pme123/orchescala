// The typeRef of a DMN column: what Orch Spec writes for a field, and what it reads back.
// dmn-js 18 lists the names of the DMN spec (`date and time` …) - Orch Spec keeps writing the
// names the engines know (`date` for C7, `dateTime` for C8) and reads both spellings.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newDmn, scalaTypeOf, typeRefOf } from '../src/dmn';
import type { Field } from '../src/types';

test('typeRefOf: the typeRef Orch Spec writes per engine', () => {
  assert.equal(typeRefOf('LocalDateTime', 'c8'), 'dateTime');
  assert.equal(typeRefOf('LocalDateTime', 'c7'), 'date');
  assert.equal(typeRefOf('LocalDate', 'c8'), 'date');
  assert.equal(typeRefOf('Long', 'c8'), 'number');
  assert.equal(typeRefOf('Long', 'c7'), 'long');
  assert.equal(typeRefOf('Boolean', 'c7'), 'boolean');
  assert.equal(typeRefOf('Segment', 'c8'), 'string'); // an enum is a text
});

test('scalaTypeOf: both spellings of a date-time read as LocalDateTime', () => {
  assert.equal(scalaTypeOf('dateTime', 'c8'), 'LocalDateTime');
  assert.equal(scalaTypeOf('date and time', 'c8'), 'LocalDateTime');
  assert.equal(scalaTypeOf('date', 'c8'), 'LocalDate');
  assert.equal(scalaTypeOf('date', 'c7'), 'LocalDateTime');
});

test('newDmn: a new C8 table writes dateTime for a LocalDateTime field', () => {
  const inFields = [{ id: 'f1', name: 'orderedAt', type: 'LocalDateTime' }] as Field[];
  const outFields = [{ id: 'f2', name: 'ok', type: 'Boolean' }] as Field[];
  const xml = newDmn('check', 'Check', inFields, outFields, 'singleEntry', 'c8');
  assert.match(xml, /<inputExpression id="InputExpression_1" typeRef="dateTime">/);
  assert.match(xml, /name="ok" typeRef="boolean"/);
});
