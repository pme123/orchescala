// The standard type mappers: generic conversions no project defines - a method of the type itself
// (`x.toString`) as it is, the others extensions of `orchescala.domain.StandardTypeMappers`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { scanMappers } from '../src/domainScan';
import { newOrchestration } from '../src/services/orchestration';
import { orchestrationFiles } from '../src/services/scalaOrchestration';
import type { ServiceOrchestrationSpec } from '../src/services/types';
import { isMember, ORCHESCALA_MAPPERS, STANDARD_MAPPERS } from '../src/standardMappers';
import { mapperExtension } from '../src/typeMappers';
import type { Field, FieldMapping, TypeDef, TypeMapper } from '../src/types';

(globalThis as unknown as { DOMParser: unknown }).DOMParser ??= DOMParser;

const f = (name: string, type: string, more: Partial<Field> = {}): Field => ({ id: `f-${name}`, name, type, ...more });
const types: TypeDef[] = [
  { id: 'src', name: 'Src', kind: 'case', fields: [f('n', 'Int'), f('text', 'String'), f('day', 'LocalDate', { optional: true }), f('w', 'wrap')] } as TypeDef,
  { id: 'wrap', name: 'Wrap', kind: 'case', fields: [f('value', 'BigDecimal')] } as TypeDef,
  { id: 'dst', name: 'Dst', kind: 'case', fields: [f('n', 'String'), f('text', 'BigDecimal'), f('day', 'String', { optional: true }), f('w', 'BigDecimal')] } as TypeDef,
];
const worker = (mappers: TypeMapper[]) => {
  const o = newOrchestration({ title: 'Kunde', project: 'acme-crm', api: 'client', apiVersion: 1, name: 'MapClient' });
  o.types.find(x => x.id === o.inTypeId)!.fields = [f('src', 'src')];
  const m: FieldMapping = { in: [f('src', 'src')], out: [f('dst', 'dst')], fields: ['n', 'text', 'day', 'w'].map(n => ({ field: `dst.${n}`, from: [`src.${n}`] })) };
  const spec: ServiceOrchestrationSpec = {
    ...o, types: [...o.types, ...types],
    bpmn: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="x">
  <bpmn:process id="p" isExecutable="false">
    <bpmn:startEvent id="Start" /><bpmn:scriptTask id="MapTask" name="Map Client" /><bpmn:endEvent id="End" />
    <bpmn:sequenceFlow id="f1" sourceRef="Start" targetRef="MapTask" /><bpmn:sequenceFlow id="f2" sourceRef="MapTask" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`,
    tasks: { MapTask: { script: '= {}', mapping: m } }, conditions: {}, outMappings: [],
  };
  const fs = orchestrationFiles(spec, [], { version: 1, services: [], typeMappers: mappers });
  return { worker: fs.find(x => x.path.endsWith('/MapClientWorker.scala'))!.content, files: fs.map(x => x.path) };
};

test('without a mapper of the model: Int → String, String → BigDecimal, LocalDate → String by the standard ones', () => {
  const { worker: w, files } = worker([]);
  assert.match(w, /n = src\.n\.toString,/, w);
  assert.match(w, /text = src\.text\.toBigDecimal,/, w);
  assert.match(w, /day = src\.day\.map\(_\.toString\),/, w);
  assert.match(w, /^import orchescala\.domain\.StandardTypeMappers\.\*$/m, w);
  // no file - they are in orchescala, or a method of the type
  assert.equal(files.filter(p => /TypeMappers/.test(p)).length, 0);
});

test('a mapper of the project named like a standard one: the project\'s an extension, the standard one on its object', () => {
  const wrap: TypeMapper = { id: 'w', from: 'wrap', to: 'BigDecimal', kind: 'field', path: 'value' };
  const { worker: w } = worker([wrap]);
  assert.match(w, /w = src\.w\.toBigDecimal$/m, w);
  assert.match(w, /text = StandardTypeMappers\.toBigDecimal\(src\.text\),/, w);
  assert.match(w, /^import orchescala\.domain\.StandardTypeMappers$/m, w);
  assert.doesNotMatch(w, /^import orchescala\.domain\.StandardTypeMappers\.\*$/m, w);
});

test('a mapper of the project into String is no `toString` - Scala would call the method of the type', () => {
  assert.equal(mapperExtension({ id: 'x', from: 'wrap', to: 'String', kind: 'field', path: 'value' }, r => r), 'asString');
  assert.equal(mapperExtension(STANDARD_MAPPERS.find(m => m.id === 'std:Int→String')!, r => r), 'toString');
});

test('the standard extensions are those of orchescala.domain.StandardTypeMappers', () => {
  const code = scanMappers(readFileSync('../01-domain/src/main/scala/orchescala/domain/StandardTypeMappers.scala', 'utf8'));
  const inCode = code.map(m => `${m.from}→${m.to} ${m.object}.${m.method}`).sort();
  const listed = STANDARD_MAPPERS.filter(m => !isMember(m)).map(m => `${m.from}→${m.to} ${ORCHESCALA_MAPPERS.object}.${m.code!.method}`).sort();
  assert.deepEqual(listed, inCode);
});
