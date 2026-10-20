// Links into the API page: Redoc's `#tag/<Tag>` (a process) and `#operation/<id>`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rewriteLinks, safeDecode, tagOperation } from '../src/components/ApiDoc';

const ops = [
  { tag: 'Basisvertrag', operationId: 'Process start' },
  { tag: 'Identification', operationId: 'Process start' },
  { tag: 'Identification', operationId: 'Init Worker' },
  { tag: 'General Cancel', operationId: 'Worker: general.cancel.X' },
];
const tag = (op: string) => tagOperation(op, ops);

test('tagOperation: the first operation of the tag', () => {
  assert.equal(tag('tag/Identification'), ops[1]);
  assert.equal(tag('tag/identification'), ops[1], 'case does not matter');
  assert.equal(tag('tag/General-Cancel'), ops[3], 'blanks are dashes in the anchor');
  assert.equal(tag('tag/General Cancel'), ops[3]);
});

test('tagOperation: an unknown tag or no tag link - undefined', () => {
  assert.equal(tag('tag/Nope'), undefined);
  assert.equal(tag('Process start'), undefined);
  assert.equal(tagOperation(undefined, ops), undefined);
});

test('safeDecode: a malformed escape stays as it is', () => {
  assert.equal(safeDecode('General%20Cancel'), 'General Cancel');
  assert.equal(safeDecode('100%'), '100%');
  assert.equal(tag(`tag/${safeDecode('100%')}`), undefined);
});

test('rewriteLinks: OpenApi.html with #tag, #operation and without anchor into the app', () => {
  const md = '[a](https://h/site/valiant/valiant-cms/OpenApi.html#tag/Identification) '
    + '[b](../valiant-cms/OpenApi.html#operation/Bpmn:%20x) [c](../valiant-cms/OpenApi.html)';
  assert.equal(rewriteLinks(md, 'valiant'),
    '[a](#/valiant/api/valiant-cms?op=tag/Identification) '
    + '[b](#/valiant/api/valiant-cms?op=Bpmn:%20x) [c](#/valiant/api/valiant-cms)');
});
