// A block of its own that belongs to a pattern (link target → call → end) is shown in the tree as
// a pattern row; its content is the same steps again. Grouped again, its head would open the same
// block - the tree contained itself without end (the page ran out of memory, e.g. after converting
// to Camunda 7). Inside its block the head does not open it again.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { blockGroups } from '../src/bpmn';
import type { Step } from '../src/types';

const step = (id: string, extra: Partial<Step> = {}) => ({ id, name: id, kind: 'task', status: 'draft', ...extra }) as unknown as Step;
const steps = [
  step('Start'), step('Work'), step('End'),
  step('SendEvent', { kind: 'event', orphan: true, pattern: 'send-process-event-ut' }),
  step('SendCall', { kind: 'call', pattern: 'send-process-event-ut' }),
  step('SentEnd', { kind: 'end', pattern: 'send-process-event-ut' }),
];

test('the main list opens the pattern block at its head', () => {
  const groups = blockGroups(steps);
  assert.deepEqual(groups.map(g => [g.head?.id ?? null, g.steps.map(s => s.id)]), [
    [null, ['Start', 'Work', 'End']],
    ['SendEvent', ['SendEvent', 'SendCall', 'SentEnd']],
  ]);
});

test('inside its block the head does not open it again - the tree ends', () => {
  const block = blockGroups(steps)[1].steps;
  const inner = blockGroups(block, 'SendEvent');
  assert.deepEqual(inner.map(g => [g.head?.id ?? null, g.steps.map(s => s.id)]), [[null, ['SendEvent', 'SendCall', 'SentEnd']]]);
});

test('like the tree: list → pattern block → list … stops after one level', () => {
  // what StepList and PatternFold do: a group with a pattern head is listed again with its head as `inside`
  const depth = (list: Step[], inside: string | undefined, level: number): number => {
    if (level > 20) return level; // would not end
    return Math.max(level, ...blockGroups(list, inside)
      .filter(g => g.head?.pattern)
      .map(g => depth(g.steps, g.steps[0]?.id, level + 1)));
  };
  assert.equal(depth(steps, undefined, 0), 1);
});

test('a second block in the same list still opens its own bracket', () => {
  const two = [...steps.slice(3), step('Other', { kind: 'event', orphan: true }), step('OtherEnd', { kind: 'end' })];
  const inner = blockGroups(two, 'SendEvent');
  assert.deepEqual(inner.map(g => g.head?.id ?? null), [null, 'Other']);
});

test('an error path starting with a pattern block head does not open it again inside its own fold', () => {
  // the PatternFold of an error path lists e.steps with its first step as `inside`
  const path = [step('Retry', { kind: 'event', orphan: true, pattern: 'init-process' }), step('RetryEnd', { kind: 'end', pattern: 'init-process' })];
  assert.deepEqual(blockGroups(path).map(g => g.head?.id ?? null), ['Retry']); // without it: the same block again
  assert.deepEqual(blockGroups(path, 'Retry').map(g => g.head?.id ?? null), [null]);
});

// The wiring in the tree itself (StepList ↔ PatternFold) - rendering ProcessView would pull in the
// modeler, so the guard reads the source: drop one of these and the tree contains itself again.
test('the tree passes the head of a pattern block to the list of its content', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/components/ProcessView.tsx', import.meta.url)), 'utf8');
  // the content list of a fold does not open the fold again
  assert.match(src, /<StepList [^>]*foldOf=\{head\}/);
  // StepList takes it as its own parameter (not via ListProps, so `{...p}` cannot carry it on) and groups with it
  assert.match(src, /function StepList\(\{ foldOf, \.\.\.p \}: ListProps & \{ foldOf\?: string \}\)/);
  assert.match(src, /blockGroups\(.*, foldOf\);/);
  assert.doesNotMatch(src.slice(src.indexOf('interface ListProps'), src.indexOf('function PatternFold')), /foldOf/);
  // every fold names its head: the block's head, the first step of an error path
  assert.match(src, /<PatternFold [^>]*head=\{g\.head\.id\}/);
  assert.match(src, /<PatternFold [^>]*head=\{e\.steps!\[0\]\.id\}/);
  // and a depth cap as the last guard against a tree without end
  assert.match(src, /if \(p\.depth > MAX_TREE_DEPTH\)/);
});
