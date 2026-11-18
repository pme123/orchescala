// Brackets while typing an expression - only where one would be missing: wrap a selection, close a
// pair where no closing one waits for it, step over one that is there.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bracketEdit, type BracketEdit } from '../src/bracketPairs.ts';

const apply = (text: string, ed: BracketEdit | null) =>
  ed ? `${text.slice(0, ed.from)}${ed.insert}${text.slice(ed.to)}|${ed.selStart}-${ed.selEnd}` : null;

test('a selection is wrapped and stays selected — also outside an expression', () => {
  assert.equal(apply('= a + b', bracketEdit('= a + b', 2, 7, '(', true)), '= (a + b)|3-8');
  assert.equal(apply('Text', bracketEdit('Text', 0, 4, '"', false)), '"Text"|1-5');
  assert.equal(apply('= x', bracketEdit('= x', 2, 3, '[', true)), '= [x]|3-4');
  assert.equal(bracketEdit('= x', 2, 3, 'a', true), null);
});

test('an opening bracket brings the closing one - only where none waits for it', () => {
  assert.equal(apply('= sum', bracketEdit('= sum', 5, 5, '(', true)), '= sum()|6-6');
  assert.equal(apply('= {}', bracketEdit('= {}', 3, 3, '[', true)), '= {[]}|4-4');
  // inside a call that is closed: the new one gets its own
  assert.equal(apply('= f(x)', bracketEdit('= f(x)', 5, 5, '(', true)), '= f(x())|6-6');
  // a closing one too many is there: it waits for this one
  assert.equal(bracketEdit('= not isDone)', 6, 6, '(', true), null);
  // before a word it stays alone, and outside an expression too
  assert.equal(bracketEdit('= x', 2, 2, '(', true), null);
  assert.equal(bracketEdit('Text', 4, 4, '(', false), null);
  // a quote after a word ends a string
  assert.equal(apply('= ', bracketEdit('= ', 2, 2, '"', true)), '= ""|3-3');
  assert.equal(bracketEdit('= "abc', 6, 6, '"', true), null);
});

test('a closing one that is there: the cursor steps over it - unless one is missing', () => {
  assert.equal(apply('= sum()', bracketEdit('= sum()', 6, 6, ')', true)), '= sum()|7-7');
  assert.equal(apply('= ""', bracketEdit('= ""', 3, 3, '"', true)), '= ""|4-4');
  assert.equal(bracketEdit('= sum(', 6, 6, ')', true), null);
  // `= f(g(x|)`: one is missing - typed, not stepped over
  assert.equal(bracketEdit('= f(g(x)', 7, 7, ')', true), null);
});

test('a quote steps over only where it ends a string — before a string it opens one', () => {
  assert.equal(bracketEdit('= "abc"', 2, 2, '"', true), null);
  assert.equal(apply('= "abc"', bracketEdit('= "abc"', 6, 6, '"', true)), '= "abc"|7-7');
  assert.equal(apply('= "a\\"b"', bracketEdit('= "a\\"b"', 7, 7, '"', true)), '= "a\\"b"|8-8');
});

test('a quote after a value ends one', () => {
  assert.equal(bracketEdit('= f(x)', 6, 6, '"', true), null);
  assert.equal(bracketEdit('= [1]', 5, 5, '"', true), null);
});
