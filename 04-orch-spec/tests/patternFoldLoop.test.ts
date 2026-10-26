// A block of its own that belongs to a pattern (link target → call → end) is shown in the tree as
// a pattern row; its content is the same steps again. Grouped again, its head would open the same
// block - the tree contained itself without end (the page ran out of memory, e.g. after converting
// to Camunda 7). Inside its block the head does not open it again.
import assert from 'node:assert/strict';
import { test } from 'node:test';
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
