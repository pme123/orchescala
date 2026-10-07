// Ein fester Fall (`processStatus: ProcessStatus.succeeded.type = ProcessStatus.succeeded`):
// die Vorgabe ist der Fall selbst — keine Meldung «Vorgabe wird nicht verwendet».
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkTypes, scalaFiles } from '../src/scala';
import { isFixedCaseDefault } from '../src/scalaTypes';
import type { ProcessSpec } from '../src/types';

const spec = {
  slug: 's', name: 'acme-demo-orderV1', project: 'acme-demo', processId: 'acme-demo-orderV1', engine: 'c7', steps: [],
  types: [{
    id: 'out', name: 'Out', kind: 'case', processOut: true,
    fields: [{ id: 'f', name: 'processStatus', type: 'dom:orchescala.domain.ProcessStatus', enumCase: 'succeeded', default: 'ProcessStatus.succeeded' }],
  }],
} as unknown as ProcessSpec;

test('the default of a fixed case is the case itself', () => {
  assert.ok(isFixedCaseDefault('succeeded', 'ProcessStatus.succeeded'));
  assert.ok(isFixedCaseDefault('output-mocked', 'ProcessStatus.`output-mocked`'));
  assert.ok(!isFixedCaseDefault('succeeded', 'ProcessStatus.canceled'));
  assert.ok(!isFixedCaseDefault(undefined, 'ProcessStatus.succeeded'));
});

test('no «Vorgabe wird nicht verwendet» for a fixed case in Out - the export writes it anyway', () => {
  const issues = checkTypes(spec.types, null).filter(i => /Vorgabe/.test(i.message));
  assert.deepEqual(issues, []);
  const all = scalaFiles(spec, null).map(f => f.content).join('\n');
  assert.match(all, /processStatus: ProcessStatus\.succeeded\.type = ProcessStatus\.succeeded/);
});
