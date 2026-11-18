// The type of the value of a FEEL expression - for a variable no field and no conversion types.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { feelValueType } from '../src/services/feelValueType';

const vars = [
  { name: 'maxCount', type: 'Int' },
  { name: 'amount', type: 'BigDecimal' },
  { name: 'fileId', type: 'String' },
  { name: 'isDone', type: 'Boolean' },
  { name: 'items', type: 'Item', collection: true },
];
const type = (e: string) => feelValueType(e, vars);

test('literals and a variable it reads', () => {
  assert.equal(type('= 0'), 'Int');
  assert.equal(type('= 1.5'), 'BigDecimal');
  assert.equal(type('= "x"'), 'String');
  assert.equal(type('= true'), 'Boolean');
  assert.equal(type('= maxCount'), 'Int');
  assert.equal(type('= (fileId)'), 'String');
  // not sure: nothing
  assert.equal(type('= null'), undefined);
  assert.equal(type('= unknown'), undefined);
  assert.equal(type('= items'), undefined);
});

test('if then else: its branches - one unknown, null or the variable itself: the other', () => {
  assert.equal(type('= if checkStatusCount != null then checkStatusCount + 1 else 0'), 'Int');
  assert.equal(type('= if isDone then "fertig" else null'), 'String');
  assert.equal(type('= if isDone then 1 else amount'), 'BigDecimal');
  assert.equal(type('= if isDone then 1 else "x"'), undefined);
  assert.equal(type('= if isDone then if maxCount > 1 then 1 else 2 else 3'), 'Int');
});

test('comparisons, and/or, functions: Boolean; arithmetic: the wider number; + with a text: String', () => {
  assert.equal(type('= checkStatusCount >= maxCount'), 'Boolean');
  assert.equal(type('= isDone and maxCount > 1'), 'Boolean');
  assert.equal(type('= not(isDone)'), 'Boolean');
  assert.equal(type('= maxCount + 1'), 'Int');
  assert.equal(type('= maxCount * amount'), 'BigDecimal');
  assert.equal(type('= maxCount / 2'), 'BigDecimal');
  assert.equal(type('= -1'), 'Int');
  assert.equal(type('= "Datei " + fileId + " (" + string(maxCount) + ")"'), 'String');
  assert.equal(type('= count(items)'), 'Int');
});

test('a condition comparing with a value that may be missing: true only where it is there (FEEL: null is not true)', async () => {
  const { feelCondition } = await import('../src/services/feelScala');
  const v = (scala: string, type: string, optional: boolean) => ({ scala, type, optional, collection: false });
  const scope = new Map([['count', v('count', 'Int', false)], ['max', v('in.max', 'Int', true)], ['min', v('in.min', 'Int', true)]]);
  assert.equal(feelCondition('= count >= max', scope, []).scala, 'in.max.exists(count >= _)');
  assert.equal(feelCondition('= max > count', scope, []).scala, 'in.max.exists(_ > count)');
  assert.equal(feelCondition('= min < max', scope, []).scala, 'in.min.zip(in.max).exists((a, b) => a < b)');
});
