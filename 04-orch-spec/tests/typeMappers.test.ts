// Type mappers: defined once in the model, a line of a mapping between their types converts with
// them - in the worker a method each (a table a match, a field its path, a Scala expression, the
// code's deserializer), an Option or a list mapped along; the checks and the automatic mapping know them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import type { VarNode } from '../src/feel';
import { autoMapped, mappingFeel, mappingIssues } from '../src/fieldMapping';
import { newOrchestration } from '../src/services/orchestration';
import { orchestrationFiles } from '../src/services/scalaOrchestration';
import type { ServiceOrchestrationSpec } from '../src/services/types';
import { converter, importedMappers, mapperBody, mapperFile, mapperIssues, prefilledCases } from '../src/typeMappers';
import { indexTypes } from '../src/scala';
import type { Field, FieldMapping, Model, TypeDef, TypeMapper } from '../src/types';

(globalThis as unknown as { DOMParser: unknown }).DOMParser ??= DOMParser;

const f = (name: string, type: string, more: Partial<Field> = {}): Field => ({ id: `f-${name}`, name, type, ...more });
const enumOf = (id: string, name: string, values: string[]): TypeDef => ({ id, name, kind: 'enum', values: values.map(v => ({ name: v })) } as TypeDef);
const types: TypeDef[] = [
  enumOf('mainType', 'ClientMainType', ['Person', 'Company']),
  enumOf('clientType', 'ClientType', ['PERSON', 'COMPANY']),
  { id: 'bdw', name: 'BigDecimalWrapper', kind: 'case', fields: [f('value', 'BigDecimal')] } as TypeDef,
  { id: 'composed', name: 'ComposedClient', kind: 'case', fields: [f('kind', 'mainType'), f('amount', 'bdw'), f('tags', 'mainType', { collection: true }), f('maybe', 'mainType', { optional: true })] } as TypeDef,
  { id: 'read', name: 'ClientRead', kind: 'case', fields: [f('kind', 'clientType'), f('amount', 'BigDecimal'), f('tags', 'clientType', { collection: true }), f('maybe', 'clientType', { optional: true })] } as TypeDef,
];
const table: TypeMapper = { id: 'm1', from: 'mainType', to: 'clientType', kind: 'table', cases: [{ from: 'Person', to: 'PERSON' }, { from: 'Company', to: 'COMPANY' }] };
const wrapper: TypeMapper = { id: 'm2', from: 'bdw', to: 'BigDecimal', kind: 'field', path: 'value' };
const model = (mappers: TypeMapper[]): Model => ({ version: 1, services: [], typeMappers: mappers });

const files = (m: FieldMapping, mappers: TypeMapper[]) => {
  const o = newOrchestration({ title: 'Kunde lesen', project: 'acme-crm', api: 'client', apiVersion: 1, name: 'ReadClient' });
  o.types.find(x => x.id === o.inTypeId)!.fields = [f('existing', 'composed')];
  o.types.find(x => x.id === o.outTypeId)!.fields = [f('client', 'read')];
  const spec: ServiceOrchestrationSpec = {
    ...o, types: [...o.types, ...types],
    bpmn: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="x">
  <bpmn:process id="acme-crm-clientV1-ReadClient" isExecutable="false">
    <bpmn:startEvent id="Start" /><bpmn:scriptTask id="MapTask" name="Map Client" /><bpmn:endEvent id="End" />
    <bpmn:sequenceFlow id="f1" sourceRef="Start" targetRef="MapTask" /><bpmn:sequenceFlow id="f2" sourceRef="MapTask" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`,
    tasks: { MapTask: { script: mappingFeel(m), mapping: m } }, conditions: {}, outMappings: [{ name: 'client', expression: '= client' }],
  };
  const fs = orchestrationFiles(spec, [], model(mappers));
  return {
    worker: fs.find(x => x.path.endsWith('/ReadClientWorker.scala'))!.content,
    test: fs.find(x => x.path.endsWith('/ReadClientWorkerTest.scala'))!.content,
  };
};
const all: FieldMapping = {
  in: [f('existing', 'composed')], out: [f('client', 'read')],
  fields: ['kind', 'amount', 'tags', 'maybe'].map(n => ({ field: `client.${n}`, from: [`existing.${n}`] })),
};

test('in Scala a line between two types converts with their mapper - a method of the worker, a list and an Option mapped along', () => {
  const { worker, test: t } = files(all, [table, wrapper]);
  assert.match(worker, /ClientRead\(\n\s+kind = clientMainTypeToClientType\(existing\.kind\),\n\s+amount = bigDecimalWrapperToBigDecimal\(existing\.amount\),\n\s+tags = existing\.tags\.map\(clientMainTypeToClientType\),\n\s+maybe = existing\.maybe\.map\(clientMainTypeToClientType\)\n\s+\)/, worker);
  assert.match(worker, /def clientMainTypeToClientType\(x: ClientMainType\): ClientType =\n\s+x match\n\s+case ClientMainType\.Person => ClientType\.PERSON\n\s+case ClientMainType\.Company => ClientType\.COMPANY\n/, worker);
  assert.match(worker, /def bigDecimalWrapperToBigDecimal\(x: BigDecimalWrapper\): BigDecimal =\n\s+x\.value\n/, worker);
  // the test calls the mapper of the worker
  assert.match(t, /assertEquals\(result\.kind, Mocked\(\)\.clientMainTypeToClientType\(existing\.kind\)\)/, t);
  assert.match(t, /assertEquals\(result\.tags, existing\.tags\.map\(Mocked\(\)\.clientMainTypeToClientType\)\)/, t);
  // without a mapper: as it is - and no method
  const none = files(all, []);
  assert.match(none.worker, /kind = existing\.kind,/);
  assert.doesNotMatch(none.worker, /def clientMainTypeToClientType/);
});

test('the kinds of a mapper in Scala: a table with a case missing fails at runtime, the deserializer of the code, an expression', () => {
  const nameOf = (ref: string) => ({ mainType: 'ClientMainType', clientType: 'ClientType', date: 'TypeDateWrapper', LocalDate: 'LocalDate' } as Record<string, string>)[ref] ?? ref;
  assert.equal(mapperBody({ ...table, cases: [{ from: 'Person', to: 'PERSON' }, { from: 'Company', to: '' }] }, nameOf),
    'x match\n  case ClientMainType.Person => ClientType.PERSON\n  case other => throw IllegalArgumentException(s"ClientMainType $other: kein Fall in ClientType")');
  assert.equal(mapperBody({ ...table, kind: 'decoder' }, nameOf), 'x.asJson.as[ClientType].fold(e => throw IllegalArgumentException(s"ClientMainType → ClientType: ${e.getMessage}"), identity)');
  assert.equal(mapperBody({ id: 'm3', from: 'date', to: 'LocalDate', kind: 'scala', scala: 'LocalDate.parse(x.date)' }, nameOf), 'LocalDate.parse(x.date)');
  const { worker } = files(all, [{ ...table, kind: 'decoder' }]);
  assert.match(worker, /import io\.circe\.syntax\.\*/);
});

test('a table prefilled by names alike; its checks', () => {
  assert.deepEqual(prefilledCases(['Person', 'Company', 'Other'], ['PERSON', 'COMPANY']), [{ from: 'Person', to: 'PERSON' }, { from: 'Company', to: 'COMPANY' }, { from: 'Other', to: '' }]);
  assert.deepEqual(prefilledCases(['CLIENT_MAIN_TYPE_PERSON', 'CLIENT_MAIN_TYPE_COMPANY'], ['PERSON', 'COMPANY', 'PERSON_COMPANY']), [{ from: 'CLIENT_MAIN_TYPE_PERSON', to: 'PERSON' }, { from: 'CLIENT_MAIN_TYPE_COMPANY', to: 'COMPANY' }]);
  const idx = indexTypes(types, null);
  assert.deepEqual(mapperIssues({ ...table, cases: [{ from: 'Person', to: 'PERSONS' }] }, [table], idx), ['Ohne Fall: Company - zur Laufzeit ein Fehler.', 'Gibt es in ClientType nicht: PERSONS.']);
  assert.deepEqual(mapperIssues(wrapper, [wrapper, { ...wrapper, id: 'x' }], idx), ['Diesen Mapper gibt es zweimal.']);
  assert.deepEqual(mapperIssues({ ...wrapper, path: '' }, [], idx), ['Welches Feld?']);
});

test('the mapping knows the mappers: no warning on a line between their types, the automatic mapping takes such a field', () => {
  const idx = indexTypes(types, null);
  const convert = converter([table], idx.nameOf);
  const node = (name: string, label: string, children?: VarNode[]): VarNode => ({ name, label, type: children ? 'context' : 'string', source: 'In', ...(children ? { children } : {}) });
  const sources = [node('existing', 'ComposedClient', [node('kind', 'ClientMainType'), node('tags', 'Seq[ClientMainType]')])];
  const target = node('Out', 'Out', [node('client', 'ClientRead', [node('kind', 'ClientType'), node('tags', 'Seq[ClientType]'), node('amount', 'BigDecimal')])]);
  const m: FieldMapping = { in: [], out: [], fields: [{ field: 'client.kind', from: ['existing.kind'] }, { field: 'client.tags', from: ['existing.tags'] }, { field: 'client.amount', from: ['existing.kind'] }] };
  assert.deepEqual(mappingIssues(m, target, sources, convert).map(i => i.text), ['«client.amount»: existing.kind ist ClientMainType, das Feld BigDecimal - ohne Typ-Mapper dazwischen.']);
  const auto = autoMapped({ in: [], out: [], fields: [] }, target, sources, new Set(['client']), undefined, convert);
  assert.deepEqual(auto.fields, [{ field: 'client.kind', from: ['existing.kind'] }, { field: 'client.tags', from: ['existing.tags'] }]);
  assert.equal(convert(sources[0].children![0], target.children![0].children![0]), 'ClientMainType → ClientType');
});

test('type mappers: an export file imports again - same id or From → To replaced, others stay', () => {
  const a: TypeMapper = { id: 'a', from: 'dom:A', to: 'dom:B', kind: 'table', cases: [{ from: 'X', to: 'Y' }], path: 'unused' };
  const b: TypeMapper = { id: 'b', from: 'dom:W', to: 'BigDecimal', kind: 'field', path: ' value ' };
  const file = mapperFile([a, b]);
  const parsed = JSON.parse(file);
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.typeMappers[0], { id: 'a', from: 'dom:A', to: 'dom:B', kind: 'table', cases: [{ from: 'X', to: 'Y' }] });
  assert.equal(parsed.typeMappers[1].path, 'value');

  const have: TypeMapper[] = [
    { id: 'other', from: 'dom:A', to: 'dom:B', kind: 'decoder' }, // same From → To as a
    { id: 'b', from: 'dom:Old', to: 'dom:Old2', kind: 'decoder' }, // same id as b
    { id: 'keep', from: 'dom:K', to: 'dom:L', kind: 'decoder' },
  ];
  const r = importedMappers(have, file);
  assert.deepEqual(r.all.map(m => m.id), ['keep', 'a', 'b']);
  assert.equal(r.replaced, 2);
  assert.equal(r.added, 0);
  assert.equal(importedMappers([], file).added, 2);
  assert.throws(() => importedMappers(have, '{"patterns": []}'), /Keine Typ-Mapper/);
});

test('type mappers: an import file with an entry twice keeps the last one; a broken file says so', () => {
  const a: TypeMapper = { id: 'a', from: 'dom:A', to: 'dom:B', kind: 'decoder' };
  const file = JSON.stringify({ typeMappers: [a, { ...a, id: 'a2', description: 'last' }, { ...a, from: 'dom:C' }, { ...a, from: 'dom:C', id: 'c' }] });
  const r = importedMappers([], file);
  assert.deepEqual(r.all.map(m => `${m.id} ${m.description ?? ''}`.trim()), ['a2 last', 'c']);
  assert.equal(r.added, 2);
  assert.throws(() => importedMappers([], '{oops'), /Kein JSON/);
  assert.throws(() => importedMappers([], 'null'), /Keine Typ-Mapper/);
  assert.throws(() => importedMappers([], '[1, "x", null]'), /Keine Typ-Mapper/);
});

test('type mappers: the same names in other packages - no match by name, and the mapper says so', () => {
  const nameOf = (ref: string) => ({ a1: 'p1.Kind', a2: 'p2.Kind', b: 'q.ClientType' } as Record<string, string>)[ref] ?? ref;
  const one: TypeMapper = { id: 'one', from: 'a1', to: 'b', kind: 'decoder' };
  const two: TypeMapper = { id: 'two', from: 'a2', to: 'b', kind: 'decoder' };
  const node = (label: string): VarNode => ({ name: 'x', label, type: 'string', source: 'In' });
  assert.equal(converter([one], nameOf)(node('Kind'), node('ClientType')), 'Kind → ClientType');
  assert.equal(converter([one, two], nameOf)(node('Kind'), node('ClientType')), null);
  const idx = { ...indexTypes([], null), nameOf };
  assert.match(mapperIssues(one, [one, two], idx).join(), /dieselben Namen \(kindToClientType\)/);
});
