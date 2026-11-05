// Brackets while typing an expression: wrap a selection, close a pair, step over, remove an empty pair.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backspaceEdit, bracketEdit, type BracketEdit } from '../src/bracketPairs.ts';

const apply = (text: string, ed: BracketEdit | null) =>
  ed ? `${text.slice(0, ed.from)}${ed.insert}${text.slice(ed.to)}|${ed.selStart}-${ed.selEnd}` : null;

test('a selection is wrapped and stays selected — also outside an expression', () => {
  assert.equal(apply('= a + b', bracketEdit('= a + b', 2, 7, '(', true)), '= (a + b)|3-8');
  assert.equal(apply('Text', bracketEdit('Text', 0, 4, '"', false)), '"Text"|1-5');
  assert.equal(apply('= x', bracketEdit('= x', 2, 3, '[', true)), '= [x]|3-4');
  assert.equal(bracketEdit('= x', 2, 3, 'a', true), null);
});

test('an opening bracket brings the closing one — the cursor between them', () => {
  assert.equal(apply('= sum', bracketEdit('= sum', 5, 5, '(', true)), '= sum()|6-6');
  assert.equal(apply('= {}', bracketEdit('= {}', 3, 3, '[', true)), '= {[]}|4-4');
  // before a word it stays alone, and outside an expression too
  assert.equal(bracketEdit('= x', 2, 2, '(', true), null);
  assert.equal(bracketEdit('Text', 4, 4, '(', false), null);
  // a quote after a word ends a string
  assert.equal(apply('= ', bracketEdit('= ', 2, 2, '"', true)), '= ""|3-3');
  assert.equal(bracketEdit('= "abc', 6, 6, '"', true), null);
});

test('a closing one that is there already: the cursor steps over it', () => {
  assert.equal(apply('= sum()', bracketEdit('= sum()', 6, 6, ')', true)), '= sum()|7-7');
  assert.equal(apply('= ""', bracketEdit('= ""', 3, 3, '"', true)), '= ""|4-4');
  assert.equal(bracketEdit('= sum(', 6, 6, ')', true), null);
});

test('Backspace between an empty pair removes both', () => {
  assert.equal(apply('= sum()', backspaceEdit('= sum()', 6, 6)), '= sum|5-5');
  assert.equal(backspaceEdit('= sum(x)', 7, 7), null);
  assert.equal(backspaceEdit('= ()', 2, 4), null);
});
