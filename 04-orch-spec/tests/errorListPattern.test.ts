// Ein Pattern mit `_handledErrors` als Text (`="output-mocked"`) erkennt auch
// die Liste, die die Umwandlung nach Camunda 8 schreibt (`=["output-mocked"]`) —
// sonst ginge das Pattern (Init Process) beim Wechsel der Engine verloren.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { detectPatterns } from '../src/patterns';
import type { PatternDef } from '../src/types';

const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser ??= DOMParser;
g.XMLSerializer ??= class { serializeToString(doc: { toString(): string }) { return doc.toString(); } };

const NS = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:modeler="http://camunda.org/schema/modeler/1.0" modeler:executionPlatform="Camunda Cloud"';
const task = (id: string, source: string, target = '_handledErrors') => `<bpmn:serviceTask id="${id}" name="Init Process">
      <bpmn:extensionElements>
        <zeebe:taskDefinition type="{{processId}}" />
        <zeebe:ioMapping><zeebe:input source="${source}" target="${target}" /></zeebe:ioMapping>
      </bpmn:extensionElements>
    </bpmn:serviceTask>`;
const pattern = (source: string): PatternDef => ({
  id: 'init-process', name: 'Init Process', appliesTo: ['serviceTask'],
  bpmn: { c8: `<bpmn:definitions ${NS} id="PatternDefinitions"><bpmn:process id="PatternProcess">${task('PatternTarget', source)}</bpmn:process></bpmn:definitions>` },
} as unknown as PatternDef);
const diagram = (source: string, target?: string) => `<bpmn:definitions ${NS} id="d"><bpmn:process id="acme-demoV1" isExecutable="true">${task('InitTask', source, target).replace('{{processId}}', 'acme-demoV1')}</bpmn:process></bpmn:definitions>`;
const found = (pat: string, diag: string, target?: string) => detectPatterns(diagram(diag, target), [pattern(pat)], 'c8').hits.map(h => h.targetId);

const q = (s: string) => s.replace(/"/g, '&quot;');

test('a text in the pattern recognises the list of the conversion', () => {
  assert.deepEqual(found(q('="output-mocked"'), q('=["output-mocked"]')), ['InitTask']);
  assert.deepEqual(found(q('=["output-mocked"]'), q('="output-mocked"')), ['InitTask']);
});

test('other errors are still another pattern', () => {
  assert.deepEqual(found(q('="output-mocked"'), q('=["output-mocked", "validation-failed"]')), []);
});

test('the same errors under another variable are another pattern', () => {
  assert.deepEqual(found(q('="output-mocked"'), q('=["output-mocked"]'), '_regexHandledErrors'), []);
});
