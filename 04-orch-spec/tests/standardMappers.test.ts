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
import { converter, mapperBody, mapperChoices, mapperExtension, mapperIssues } from '../src/typeMappers';
import { indexTypes } from '../src/scala';
import { mappingIssues, withLink } from '../src/fieldMapping';
import type { VarNode } from '../src/feel';
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

// ── value tables with a name: chosen per line ─────────────────────────────────

const language: TypeMapper = { id: 'lang', from: 'Int', to: 'String', kind: 'table', name: 'Language', cases: [{ from: '1', to: 'de' }, { from: '2', to: '"fr"' }] };
const country: TypeMapper = { id: 'country', from: 'Int', to: 'String', kind: 'table', name: 'Country', cases: [{ from: '756', to: 'CH' }] };

test('a value table between simple types: a value and what it becomes, the others fail', () => {
  assert.equal(mapperBody(language, r => r, null, null),
    'x match\n  case 1 => "de"\n  case 2 => "fr"\n  case other => throw IllegalArgumentException(s"Int $other: kein Wert in String")');
  // an enum onto values: its cases, the values as written
  assert.equal(mapperBody({ id: 'e', from: 'Kind', to: 'String', kind: 'table', cases: [{ from: 'Person', to: 'P' }] }, r => r, ['Person'], null),
    'x match\n  case Kind.Person => "P"');
  assert.equal(mapperExtension(language, r => r), 'toLanguage');
});

test('a mapper with a name only where a line chooses it - otherwise the one of the types', () => {
  const chosen = (mapper?: string) => {
    const o = newOrchestration({ title: 'Kunde', project: 'acme-crm', api: 'client', apiVersion: 1, name: 'MapClient' });
    o.types.find(x => x.id === o.inTypeId)!.fields = [f('src', 'src')];
    const m: FieldMapping = { in: [f('src', 'src')], out: [f('dst', 'dst')], fields: [{ field: 'dst.n', from: ['src.n'], ...(mapper ? { mapper } : {}) }] };
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
    const fs = orchestrationFiles(spec, [], { version: 1, services: [], typeMappers: [language, country] });
    return { w: fs.find(x => x.path.endsWith('/MapClientWorker.scala'))!.content, file: fs.find(x => /TypeMappers\.scala$/.test(x.path))?.content };
  };
  // not chosen: the standard one (the method of Int) - the two with a name stay out
  assert.match(chosen().w, /n = src\.n\.toString,/);
  assert.equal(chosen().file, undefined);
  // chosen: its extension, in the project's schema (Int, String: no class of a level)
  const lang = chosen('lang');
  assert.match(lang.w, /n = src\.n\.toLanguage,/, lang.w);
  assert.match(lang.file!, /\/\*\* Int → String \(Language\) \*\/\n  extension \(x: Int\) def toLanguage: String =\n    x match\n      case 1 => "de"/, lang.file);
  assert.match(chosen('country').w, /n = src\.n\.toCountry,/);
});

test('the checks of a value table: a name, whole rows; of the same types with another name is no duplicate', () => {
  const idx = indexTypes([], null);
  assert.deepEqual(mapperIssues(language, [language, country], idx), []);
  assert.deepEqual(mapperIssues({ ...language, name: undefined, cases: [{ from: '1', to: '' }] }, [language], idx), [
    '1 Zeile(n) ohne Wert oder Ziel.',
    'Eine Wertetabelle braucht einen Namen (Sprache, Land …) - sie gilt nur, wo eine Linie sie wählt.',
  ]);
  assert.deepEqual(mapperIssues({ ...country, id: 'c2' }, [country], idx), ['«Country» gibt es für diese Typen zweimal.']);
});

test('a value table: a value that is no literal of its type is said, a text stays text; a name needs letters', () => {
  const idx = indexTypes([], null);
  const bad = { ...language, cases: [{ from: '1 + sys.exit(1)', to: 'de' }, { from: '2', to: '"a" + foo' }] };
  assert.deepEqual(mapperIssues(bad, [bad], idx), ['Kein Wert seines Typs: 1 + sys.exit(1) - nur ein Literal (1, 1.5, true).']);
  // a String is always text: what is no single literal becomes one, quotes escaped
  assert.match(mapperBody(bad, r => r, null, null), /case 2 => "\\"a\\" \+ foo"/);
  assert.equal(mapperBody(language, r => r, null, null).includes('case 2 => "fr"'), true);
  const toInt: TypeMapper = { id: 'n', from: 'String', to: 'Int', kind: 'table', name: 'Number', cases: [{ from: 'one', to: '1L' }, { from: 'two', to: '2' }] };
  assert.deepEqual(mapperIssues(toInt, [toInt], idx), ['Kein Wert seines Typs: 1L - nur ein Literal (1, 1.5, true).']);
  assert.deepEqual(mapperIssues({ ...language, name: '!!' }, [], idx), ['«!!» gibt keinen Namen im Code - Buchstaben oder Ziffern.']);
});

test('the editor: a line keeps its mapper; a chosen one that does not fit the types is said', () => {
  const m: FieldMapping = { in: [], out: [], fields: [] };
  const withMapper = withLink(m, 'dst.n', { from: ['src.n'], mapper: 'lang' });
  assert.deepEqual(withMapper.fields, [{ field: 'dst.n', from: ['src.n'], mapper: 'lang' }]);
  const node = (name: string, label: string, children?: VarNode[]): VarNode => ({ name, label, type: children ? 'context' : 'string', source: 'In', ...(children ? { children } : {}) });
  const sources = [node('src', 'Src', [node('n', 'Int'), node('text', 'String')])];
  const target = node('Out', 'Out', [node('dst', 'Dst', [node('n', 'String')])]);
  const convert = converter([language, country], r => r);
  assert.deepEqual(mappingIssues(withMapper, target, sources, convert).filter(i => i.level === 'warn'), []);
  const wrong = { ...m, fields: [{ field: 'dst.n', from: ['src.text'], mapper: 'lang' }] };
  assert.deepEqual(mappingIssues(wrong, target, sources, convert).map(i => i.text), ['«dst.n»: der gewählte Typ-Mapper passt nicht zu String → String.']);
  assert.deepEqual(mapperChoices([language, country], r => r)(sources[0].children![0], target.children![0].children![0]).map(o => o.label), ['Language', 'Country']);
});
