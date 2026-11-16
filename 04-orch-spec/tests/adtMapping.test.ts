// A mapping onto an enum with cases (ADT): the case of a source ADT of the In decides which case it
// becomes - in Scala a match that calls a method per case: the source as that case, the target case
// field by field, each with its test.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { caseLinkIssues, renamedVar } from '../src/fieldMapping';
import { prefilledAdtCases } from '../src/typeMappers';
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

const files = (m: FieldMapping) => {
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
  const fs = orchestrationFiles(spec, [], null);
  return {
    worker: fs.find(x => x.path.endsWith('/MapClientWorker.scala'))!.content,
    test: fs.find(x => x.path.endsWith('/MapClientWorkerTest.scala'))!.content,
  };
};
const worker = (m: FieldMapping) => files(m).worker;
const lines: FieldMapping['fields'] = [{ field: 'dst.id', from: ['src.id'] }, { field: 'dst.a', from: ['src.a'] }, { field: 'dst.b', from: ['src.b'] }];

test('an ADT built from the case of the source: a match calling a method per case; a case without a target fails', () => {
  const { worker: w, test: t } = files({ in: [f('src', 'src')], out: [f('dst', 'dst')], fields: lines, caseLinks: [{ field: 'dst', from: 'src', cases: [{ from: 'A', to: 'X' }, { from: 'B', to: '' }] }] });
  // ZIOs: the match calls the method of the case, a case without one fails
  assert.match(w, /dst <- mapClient\(in\.src\)\n/, w);
  assert.match(w, /def mapClient\(src: Src\): IO\[CustomError, Dst\] =\n\s+src match\n\s+case src: Src\.A => mapClientA\(src\)\n\s+case other => ZIO\.fail\(CustomError\(s"Map Client: Src \$other - kein Fall von Dst gewählt"\)\)/, w);
  // the case: the source as it, the target case as its result - field by field
  assert.match(w, /def mapClientA\(src: Src\.A\): IO\[CustomError, Dst\.X\] =\n\s+ZIO\.succeed\(\n\s+Dst\.X\(\n\s+id = src\.id,\n\s+a = src\.a,\n\s+extra = None\n\s+\)\n\s+\)/, w);
  // its test: with the example of the case, the fields of the result
  assert.match(t, /test\("mapClientA"\):\n\s+val src = Src\.A\.example\n\s+val result = runIO\(Mocked\(\)\.mapClientA\(src\)\)\n\s+assertEquals\(result\.id, src\.id\)\n\s+assertEquals\(result\.a, src\.a\)/, t);
  // both cases chosen: no default; a line from a field the case does not have is none in that branch
  const both = worker({ in: [f('src', 'src')], out: [f('dst', 'dst')], fields: lines, caseLinks: [{ field: 'dst', from: 'src', cases: [{ from: 'A', to: 'X' }, { from: 'B', to: 'Y' }] }] });
  assert.match(both, /case src: Src\.B => mapClientB\(src\)/, both);
  assert.match(both, /def mapClientB\(src: Src\.B\): IO\[CustomError, Dst\.Y\] =\n\s+ZIO\.succeed\(\n\s+Dst\.Y\(\n\s+id = src\.id,\n\s+b = src\.b\n\s+\)/, both);
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

test('the checks: an ADT Out without a case table is an error, a source case without a target a warning', () => {
  const cases = (ref: string) => (ref === 'src' ? ['A', 'B'] : ref === 'dst' ? ['X', 'Y'] : null);
  const base: FieldMapping = { in: [f('src', 'src')], out: [f('dst', 'dst'), f('plain', 'String')], fields: [] };
  assert.deepEqual(caseLinkIssues(base, cases).map(i => `${i.level}: ${i.text}`),
    ['error: «dst» ist ein Enum mit Fällen - unter «Fälle» die Quelle und je Fall einen Fall wählen.']);
  assert.deepEqual(caseLinkIssues({ ...base, caseLinks: [{ field: 'dst', from: 'src', cases: [{ from: 'A', to: 'X' }] }] }, cases).map(i => `${i.level}: ${i.text}`),
    ['warn: «dst»: für B von «src» kein Fall - zur Laufzeit ein Fehler.']);
});

test('a line from a field only some cases of the source have: a warning naming the case, in the worker a TODO that says why', () => {
  const cases = (ref: string) => (ref === 'src' ? ['A', 'B'] : ref === 'dst' ? ['X', 'Y'] : null);
  const fieldsOf = (ref: string, c: string) => ({ 'src A': ['id', 'a'], 'src B': ['id', 'b'], 'dst X': ['id', 'a', 'b'], 'dst Y': ['id', 'b'] } as Record<string, string[]>)[`${ref} ${c}`] ?? null;
  const m: FieldMapping = { in: [f('src', 'src')], out: [f('dst', 'dst')], caseLinks: [{ field: 'dst', from: 'src', cases: [{ from: 'A', to: 'X' }, { from: 'B', to: 'Y' }] }],
    fields: [{ field: 'dst.id', from: ['src.id'] }, { field: 'dst.b', from: ['src.b'] }] };
  // `b` only in B: in A the line gives X's `b` nothing, in B Y's `b` - normal, no warning
  assert.deepEqual(caseLinkIssues(m, cases, fieldsOf), []);
  // `a` onto Y's `b`, both cases become Y: in A it gives - no warning
  const never: FieldMapping = { ...m, caseLinks: [{ field: 'dst', from: 'src', cases: [{ from: 'A', to: 'Y' }, { from: 'B', to: 'Y' }] }], fields: [{ field: 'dst.b', from: ['src.a'] }] };
  assert.deepEqual(caseLinkIssues(never, cases, fieldsOf).map(i => `${i.level} ${i.field}: ${i.text}`), []);
  // `a` only in A, but only B becomes X with `a`: the line never gives anything
  const onlyB: FieldMapping = { ...m, caseLinks: [{ field: 'dst', from: 'src', cases: [{ from: 'A', to: 'Y' }, { from: 'B', to: 'X' }] }], fields: [{ field: 'dst.a', from: ['src.a'] }] };
  assert.deepEqual(caseLinkIssues(onlyB, cases, fieldsOf).map(i => `${i.level} ${i.field}: ${i.text}`),
    ['warn dst.a: «dst.a»: src.a gibt es im Fall B von «src» nicht - nur dort gibt es das Feld, die Linie bewirkt nichts (es ist nur in A).']);
  // in the worker: the case method says why
  const w = worker({ in: [f('src', 'src')], out: [f('dst', 'dst')], fields: [{ field: 'dst.id', from: ['src.id'] }, { field: 'dst.a', from: ['src.b'] }, { field: 'dst.b', from: ['src.b'] }],
    caseLinks: [{ field: 'dst', from: 'src', cases: [{ from: 'A', to: 'X' }, { from: 'B', to: 'Y' }] }] });
  assert.match(w, /a = \?\?\? \/\* TODO dst\.a: src\.b gibt es im Fall A von src nicht \*\//, w);
  assert.match(w, /def mapClientB\(src: Src\.B\): IO\[CustomError, Dst\.Y\] =\n\s+ZIO\.succeed\(\n\s+Dst\.Y\(\n\s+id = src\.id,\n\s+b = src\.b\n/, w);
});

test('the cases prefilled: names alike first, otherwise by their order when both have as many', () => {
  assert.deepEqual(prefilledAdtCases(['Person', 'MultiplePersons', 'Company'], ['privateIndividual', 'severalPrivateIndividuals', 'companiesAndOther']),
    [{ from: 'Person', to: 'privateIndividual' }, { from: 'MultiplePersons', to: 'severalPrivateIndividuals' }, { from: 'Company', to: 'companiesAndOther' }]);
  // a name alike wins, a case of the target only once
  assert.deepEqual(prefilledAdtCases(['A', 'Company'], ['Company', 'Other']), [{ from: 'A', to: 'Other' }, { from: 'Company', to: 'Company' }]);
  // other counts: only by name
  assert.deepEqual(prefilledAdtCases(['A', 'B'], ['X']), [{ from: 'A', to: '' }, { from: 'B', to: '' }]);
});

test('in ZIO: a required value of a case resolved first, the match inside an object bound, an optional object with one a ZIO.foreach', () => {
  const o = newOrchestration({ title: 'Kunde', project: 'acme-crm', api: 'client', apiVersion: 1, name: 'MapClient' });
  const own: TypeDef[] = [
    { id: 'src', name: 'Src', kind: 'enum', fields: [f('id', 'String')], values: [{ name: 'A', fields: [f('a', 'String', { optional: true }), f('p', 'per', { optional: true })] }] } as TypeDef,
    { id: 'per', name: 'Per', kind: 'case', fields: [f('name', 'String', { optional: true })] } as TypeDef,
    { id: 'pout', name: 'POut', kind: 'case', fields: [f('name', 'String')] } as TypeDef,
    { id: 'dst', name: 'Dst', kind: 'enum', values: [{ name: 'X', fields: [f('a', 'String'), f('p', 'pout', { optional: true })] }] } as TypeDef,
    { id: 'wrap', name: 'Wrap', kind: 'case', fields: [f('dst', 'dst')] } as TypeDef,
  ];
  const spec: ServiceOrchestrationSpec = {
    ...o, types: [...o.types, ...own],
    bpmn: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="x">
  <bpmn:process id="acme-crm-clientV1-MapClient" isExecutable="false">
    <bpmn:startEvent id="Start" /><bpmn:scriptTask id="MapTask" name="Map Client" /><bpmn:endEvent id="End" />
    <bpmn:sequenceFlow id="f1" sourceRef="Start" targetRef="MapTask" /><bpmn:sequenceFlow id="f2" sourceRef="MapTask" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`,
    tasks: { MapTask: { script: '= {}', mapping: {
      in: [f('src', 'src')], out: [f('wrap', 'wrap')],
      fields: [{ field: 'wrap.dst.a', from: ['src.a'] }, { field: 'wrap.dst.p', from: ['src.p'] }, { field: 'wrap.dst.p.name', from: ['src.p.name'] }],
      caseLinks: [{ field: 'wrap.dst', from: 'src', cases: [{ from: 'A', to: 'X' }] }],
    } } }, conditions: {}, outMappings: [],
  };
  const w = orchestrationFiles(spec, [], null).find(x => x.path.endsWith('/MapClientWorker.scala'))!.content;
  // the match is a ZIO: bound before the object is built
  assert.match(w, /def mapClient\(src: Src\): IO\[CustomError, Wrap\] =\n\s+for\n\s+dst <- src match\n\s+case src: Src\.A => mapClientA\(src\)\n\s+yield Wrap\(\n\s+dst = dst\n\s+\)/, w);
  // in the case: the required one first; the optional object (a copy of the line onto it) per value in a for of its own
  assert.match(w, /def mapClientA\(src: Src\.A\): IO\[CustomError, Dst\.X\] =\n\s+for\n\s+a <- ZIO\.fromOption\(src\.a\)\.orElseFail\(CustomError\("Map Client: wrap\.dst\.a fehlt"\)\)\n\s+p <- ZIO\.foreach\(src\.p\)\(p =>\n\s+for\n\s+name <- ZIO\.fromOption\(src\.p\.flatMap\(_\.name\)\)\.orElseFail\(CustomError\("Map Client: wrap\.dst\.p\.name fehlt"\)\)\n\s+yield p\.copy\(\n\s+name = name\n\s+\)\n\s+\)\n\s+yield Dst\.X\(\n\s+a = a,\n\s+p = p\n\s+\)/, w);
});

test('the tree of an enum with cases: the fields not all cases have carry their cases - shared ones none', async () => {
  const { fieldVariables } = await import('../src/feel');
  const own: TypeDef[] = [{ id: 'src', name: 'Src', kind: 'enum', fields: [f('id', 'String')], values: [
    { name: 'A', fields: [f('a', 'String'), f('both', 'String'), f('all', 'String')] },
    { name: 'B', fields: [f('b', 'String'), f('both', 'String'), f('all', 'String')] },
    { name: 'C', fields: [f('all', 'String')] },
  ] } as TypeDef];
  const [src] = fieldVariables([f('src', 'src')], 'In', own, null);
  assert.deepEqual(src.children?.map(n => `${n.name}${n.cases ? `: ${n.cases.join(', ')}` : ''}`), ['id', 'a: A', 'both: A, B', 'all', 'b: B']);
});
