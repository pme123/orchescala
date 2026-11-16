// A mapping onto an enum with cases (ADT): the case of a source ADT of the In decides which case it
// becomes - in Scala a match, in each branch the source as that case, the target case field by field.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { renamedVar } from '../src/fieldMapping';
import { newOrchestration } from '../src/services/orchestration';
import { orchestrationFiles } from '../src/services/scalaOrchestration';
import type { ServiceOrchestrationSpec } from '../src/services/types';
import type { Field, FieldMapping, TypeDef } from '../src/types';

(globalThis as unknown as { DOMParser: unknown }).DOMParser ??= DOMParser;

const f = (name: string, type: string, more: Partial<Field> = {}): Field => ({ id: `f-${name}`, name, type, ...more });
const types: TypeDef[] = [
  { id: 'src', name: 'Src', kind: 'enum', fields: [f('id', 'String')], values: [{ name: 'A', fields: [f('id', 'String'), f('a', 'String')] }, { name: 'B', fields: [f('id', 'String'), f('b', 'String')] }] } as TypeDef,
  { id: 'dst', name: 'Dst', kind: 'enum', values: [{ name: 'X', fields: [f('id', 'String'), f('a', 'String'), f('extra', 'String', { optional: true })] }, { name: 'Y', fields: [f('id', 'String'), f('b', 'String')] }] } as TypeDef,
];

const worker = (m: FieldMapping) => {
  const o = newOrchestration({ title: 'Kunde', project: 'acme-crm', api: 'client', apiVersion: 1, name: 'MapClient' });
  o.types.find(x => x.id === o.inTypeId)!.fields = [f('src', 'src')];
  const spec: ServiceOrchestrationSpec = {
    ...o, types: [...o.types, ...types],
    bpmn: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="x">
  <bpmn:process id="acme-crm-clientV1-MapClient" isExecutable="false">
    <bpmn:startEvent id="Start" /><bpmn:scriptTask id="MapTask" name="Map Client" /><bpmn:endEvent id="End" />
    <bpmn:sequenceFlow id="f1" sourceRef="Start" targetRef="MapTask" /><bpmn:sequenceFlow id="f2" sourceRef="MapTask" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`,
    tasks: { MapTask: { script: '= {}', mapping: m } }, conditions: {}, outMappings: [],
  };
  return orchestrationFiles(spec, [], null).find(x => x.path.endsWith('/MapClientWorker.scala'))!.content;
};
const lines: FieldMapping['fields'] = [{ field: 'dst.id', from: ['src.id'] }, { field: 'dst.a', from: ['src.a'] }, { field: 'dst.b', from: ['src.b'] }];

test('an ADT built from the case of the source: a match, the source as its case in the branch; a case without a target fails', () => {
  const w = worker({ in: [f('src', 'src')], out: [f('dst', 'dst')], fields: lines, caseLinks: [{ field: 'dst', from: 'src', cases: [{ from: 'A', to: 'X' }, { from: 'B', to: '' }] }] });
  assert.match(w, /def mapClient\(src: Src\): Dst =\n\s+src match\n\s+case src: Src\.A =>\n\s+Dst\.X\(\n\s+id = src\.id,\n\s+a = src\.a,\n\s+extra = None\n\s+\)\n\s+case other => throw IllegalArgumentException\(s"Map Client: Src \$other - kein Fall von Dst gewählt"\)/, w);
  // both cases chosen: no default; a line from a field the case does not have is none in that branch
  const both = worker({ in: [f('src', 'src')], out: [f('dst', 'dst')], fields: lines, caseLinks: [{ field: 'dst', from: 'src', cases: [{ from: 'A', to: 'X' }, { from: 'B', to: 'Y' }] }] });
  assert.match(both, /case src: Src\.B =>\n\s+Dst\.Y\(\n\s+id = src\.id,\n\s+b = src\.b\n\s+\)/, both);
  assert.doesNotMatch(both, /case other/);
});

test('an ADT without a case table: a TODO that says what is missing', () => {
  const w = worker({ in: [f('src', 'src')], out: [f('dst', 'dst')], fields: lines });
  assert.match(w, /\?\?\? \/\* TODO dst: ein Enum mit Fällen - im Mapping je Fall der Quelle einen Fall wählen \*\//, w);
});

test('a rename follows into the case table; a removed In leaves it without its source', () => {
  const m: FieldMapping = { in: [f('src', 'src')], out: [f('dst', 'dst')], fields: [], caseLinks: [{ field: 'dst', from: 'src', cases: [] }] };
  assert.deepEqual(renamedVar(m, 'in', 'src', 'source').caseLinks, [{ field: 'dst', from: 'source', cases: [] }]);
  assert.deepEqual(renamedVar(m, 'out', 'dst', 'target').caseLinks, [{ field: 'target', from: 'src', cases: [] }]);
  assert.deepEqual(renamedVar(m, 'in', 'src', null).caseLinks, []);
});
