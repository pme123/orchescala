// Camunda 7: a Spin path of unknown type (`printContent.content.docId`, the fields of
// `printContent` are not described) used to end without a value —
// `${printContent.prop("content").prop("docId")}` hands the JSON node to the
// called process, not the String. The target field knows the type: `docId: String`
// → `stringValue()`; an optional target first checks every step of unknown type
// (the variable at the start too), since `prop` and `stringValue()` on a missing
// or null field throw.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { allSteps, importBpmn } from '../src/bpmn';
import { writeBpmn } from '../src/bpmnWrite';
import { mappingTarget, type VarNode } from '../src/feel';
import { feelToJuel, type JuelTarget } from '../src/feelJuel';
import type { Interaction, Model, ProcessSpec, Step, TypeDef } from '../src/types';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;
(globalThis as unknown as { XMLSerializer: unknown }).XMLSerializer = class { serializeToString(n: Node) { return String(n); } };

const juel = (body: string, target: JuelTarget | null, vars?: VarNode[]) =>
  (feelToJuel(body, { target, vars }) as { juel: string }).juel;

/** the checks of an optional field — as the export writes them */
const has = (base: string, p: string) => `${base}.hasProp("${p}") && !${base}.prop("${p}").isNull()`;
const PATH = 'printContent.prop("content").prop("docId")';
/** the checks for `printContent.content.docId` into an optional target */
const GUARD = `execution.getVariable("printContent") != null && ${has('printContent', 'content')} && ${has('printContent.prop("content")', 'docId')}`;

test('unknown path: the target type decides the end', () => {
  assert.equal(juel('printContent.content.docId', null), PATH);
  assert.equal(juel('printContent.content.docId', { type: 'string', optional: false }), `${PATH}.stringValue()`);
  assert.equal(juel('printContent.content.docId', { type: 'number', optional: false }), `${PATH}.numberValue()`);
  assert.equal(juel('printContent.content.docId', { type: 'boolean', optional: false }), `${PATH}.boolValue()`);
});

test('unknown path into an optional target: every step of unknown type is checked first', () => {
  const guard = GUARD;
  assert.equal(juel('printContent.content.docId', { type: 'string', optional: true }), `(${guard} ? ${PATH}.stringValue() : null)`);
  assert.equal(juel('printContent.content.docId', { type: 'number', optional: true }), `(${guard} ? ${PATH}.numberValue() : null)`);
  assert.equal(juel('printContent.content.docId', { type: 'boolean', optional: true }), `(${guard} ? ${PATH}.boolValue() : null)`);
  // the unguarded value comes along — to compare with an older row
  assert.equal((feelToJuel('printContent.content.docId', { target: { type: 'string', optional: true } }) as { value?: string }).value, `${PATH}.stringValue()`);
});

test('a described required step is not checked, an unknown one is', () => {
  const vars: VarNode[] = [{ name: 'printContent', type: 'context', label: 'PrintContent', source: 'In',
    children: [{ name: 'content', type: 'context', label: 'Content', source: 'In' }] }];
  assert.equal(juel('printContent.content.docId', { type: 'string', optional: true }, vars),
    `(${has('printContent.prop("content")', 'docId')} ? ${PATH}.stringValue() : null)`);
  // a date or a duration is text in JSON
  assert.equal(juel('printContent.content.validFrom', { type: 'date', optional: false }), 'printContent.prop("content").prop("validFrom").stringValue()');
  assert.equal(juel('printContent.content.wait', { type: 'duration', optional: false }), 'printContent.prop("content").prop("wait").stringValue()');
});

test('a known source type wins, and only the whole expression takes the target', () => {
  const vars: VarNode[] = [{ name: 'card', type: 'context', label: 'Card', source: 'In', children: [
    { name: 'key', type: 'number', label: 'Long', source: 'In' },
    { name: 'holder', type: 'context', label: 'Holder', source: 'In' },
  ] }];
  assert.equal(juel('card.key', { type: 'string', optional: false }, vars), 'card.prop("key").numberValue()');
  // an object stays the JSON node — a String target does not make it text
  assert.equal(juel('card.holder', { type: 'string', optional: true }, vars), 'card.prop("holder")');
  // inside a calculation the path is not the value of the target
  assert.equal(juel('a.b + 1', { type: 'string', optional: false }), 'a.prop("b").value() + 1');
});

// ── mappingTarget: where the target type comes from ─────────────────────────

const archiveModel = (docId: string) => ({
  domainTypes: [
    { id: 'acme.demo.Archive', name: 'Archive', pkg: 'acme.demo', kind: 'case', importPath: 'acme.demo.Archive', processName: 'acme-demo-archive', owner: 'Archive' },
    { id: 'acme.demo.Archive.In', name: 'Archive.In', pkg: 'acme.demo', kind: 'member', owner: 'Archive', importPath: 'acme.demo.Archive',
      fields: [{ name: 'docId', type: docId }] },
    { id: 'acme.demo.DocKind', name: 'DocKind', pkg: 'acme.demo', kind: 'enum', importPath: 'acme.demo.DocKind', values: ['letter', 'contract'] },
  ],
}) as unknown as Model;

test('mappingTarget: domain In, simple enum, own class, init worker, output', () => {
  const call = { id: 'Archive', kind: 'call', calledProcess: 'acme-demo-archive' } as Step;
  const spec = { processId: 'acme-demo-printV1', steps: [call] } as unknown as ProcessSpec;
  assert.deepEqual(mappingTarget(call, spec, archiveModel('String'), 'in', 'docId'), { type: 'string', optional: false });
  assert.deepEqual(mappingTarget(call, spec, archiveModel('Option[Long]'), 'in', 'docId'), { type: 'number', optional: true });
  assert.deepEqual(mappingTarget(call, spec, archiveModel('DocKind'), 'in', 'docId'), { type: 'string', optional: false });
  assert.deepEqual(mappingTarget(call, spec, archiveModel('Option[DocKind]'), 'in', 'docId'), { type: 'string', optional: true });
  // an object is no simple type
  assert.equal(mappingTarget(call, spec, archiveModel('Archive.In'), 'in', 'docId'), null);

  // the own class of the interaction wins over the catalog
  const types = [{ id: 't-in', name: 'In', kind: 'case', fields: [{ id: 'f1', name: 'docId', type: 'Boolean', optional: true }] }] as TypeDef[];
  const ia = { id: 'i1', stepId: 'Archive', kind: 'userTask', name: 'Archive', key: 'archive', inTypeId: 't-in' } as Interaction;
  assert.deepEqual(mappingTarget(call, { ...spec, types, interactions: [ia] }, archiveModel('String'), 'in', 'docId'), { type: 'boolean', optional: true });
  // an optional own enum
  const withEnum = [{ id: 't-in', name: 'In', kind: 'case', fields: [{ id: 'f1', name: 'docId', type: 't-kind', optional: true }] },
    { id: 't-kind', name: 'Kind', kind: 'enum', values: [{ name: 'letter' }, { name: 'contract' }] }] as TypeDef[];
  assert.deepEqual(mappingTarget(call, { ...spec, types: withEnum, interactions: [ia] }, archiveModel('String'), 'in', 'docId'), { type: 'string', optional: true });

  // the init worker reads the In of the process itself — no target
  const init = { id: 'Init', kind: 'service', topic: 'acme-demo-printV1' } as Step;
  assert.equal(mappingTarget(init, { ...spec, steps: [init] }, archiveModel('String'), 'in', 'docId'), null);

  // an output goes into a process variable
  const withVar = { ...spec, types: [{ id: 't-root', name: 'In', kind: 'case', root: true,
    fields: [{ id: 'f2', name: 'archivedId', type: 'String', optional: true }] }] as TypeDef[] };
  assert.deepEqual(mappingTarget(call, withVar, null, 'out', 'archivedId'), { type: 'string', optional: true });
  assert.equal(mappingTarget(call, withVar, null, 'out', 'unknown'), null);
});

// ── Export ───────────────────────────────────────────────────────────────────

const bpmn = (extensions: string, loop = '') => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="d" targetNamespace="x">
  <bpmn:process id="acme-demo-printV1" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:callActivity id="ArchiveCallActivity" name="Archive" calledElement="acme-demo-archive">
      <bpmn:extensionElements>${extensions}</bpmn:extensionElements>
      <bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing>${loop}
    </bpmn:callActivity>
    <bpmn:endEvent id="EndEvent"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="ArchiveCallActivity"/>
    <bpmn:sequenceFlow id="f2" sourceRef="ArchiveCallActivity" targetRef="EndEvent"/>
  </bpmn:process>
</bpmn:definitions>`;

const xmlAttr = (s: string) => s.replace(/"/g, '&quot;').replace(/&&/g, '&amp;&amp;');
const oldIn = (expr: string) => `<camunda:in sourceExpression="${xmlAttr(expr)}" target="docId" />`;

const exported = (docId: string, existing = '', edit?: (spec: ProcessSpec, step: Step) => void, loop = '') => {
  const xml = bpmn(existing, loop);
  const spec = importBpmn(xml, 'print').spec;
  const step = allSteps(spec.steps).find(s => s.id === 'ArchiveCallActivity')!;
  step.inputs = [{ name: 'docId', expression: '= printContent.content.docId' }];
  edit?.(spec, step);
  return writeBpmn(xml, spec, archiveModel(docId)).xml.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
};
const contains = (xml: string, part: string) => assert.ok(xml.includes(part), `«${part}» missing in\n${xml}`);

test('export: the In of the called process gives the type', () => {
  // two exports with different models — nothing carries over from one to the other
  contains(exported('String'), `sourceExpression="\${${PATH}.stringValue()}"`);
  contains(exported('Option[String]'), `sourceExpression="\${(${GUARD} ? ${PATH}.stringValue() : null)}"`);
  contains(exported('LocalDate'), `sourceExpression="\${${PATH}.stringValue()}"`);
  // escaped once in the XML
  const xml = bpmn('');
  const spec = importBpmn(xml, 'print').spec;
  allSteps(spec.steps).find(s => s.id === 'ArchiveCallActivity')!.inputs = [{ name: 'docId', expression: '= printContent.content.docId' }];
  contains(writeBpmn(xml, spec, archiveModel('Option[String]')).xml, '!= null &amp;&amp; printContent.hasProp(&quot;content&quot;)');
});

test('export: an output takes the type of its process variable', () => {
  const xml = exported('String', '', (spec, step) => {
    spec.types = [{ id: 't-root', name: 'In', kind: 'case', root: true, fields: [{ id: 'f', name: 'archivedId', type: 'Long' }] }] as TypeDef[];
    step.inputs = [];
    step.outputs = [{ name: 'archivedId', expression: '= result.archive.id' }];
  });
  contains(xml, 'result.prop("archive").prop("id").numberValue()');
  // an optional process variable: the result is checked first
  const opt = exported('String', '', (spec, step) => {
    spec.types = [{ id: 't-root', name: 'In', kind: 'case', root: true, fields: [{ id: 'f', name: 'archivedId', type: 'Long', optional: true }] }] as TypeDef[];
    step.inputs = [];
    step.outputs = [{ name: 'archivedId', expression: '= result.archive.id' }];
  });
  contains(opt, `\${(execution.getVariable("result") != null && ${has('result', 'archive')} && ${has('result.prop("archive")', 'id')} ? result.prop("archive").prop("id").numberValue() : null)}`);
});

test('export: an existing row that only lacks its end is written anew', () => {
  // also a row that hands over the JSON node on purpose — it cannot be told apart from a missing end
  contains(exported('String', oldIn(`\${${PATH}}`)), `\${${PATH}.stringValue()}`);
  contains(exported('Option[String]', oldIn(`\${${PATH}}`)), `\${(${GUARD} ? ${PATH}.stringValue() : null)}`);
  // already guarded, only without the end
  contains(exported('Option[String]', oldIn(`\${(${GUARD} ? ${PATH} : null)}`)), `\${(${GUARD} ? ${PATH}.stringValue() : null)}`);
  // with the end, but without the checks — the field has become optional since
  contains(exported('Option[String]', oldIn(`\${${PATH}.stringValue()}`)), `\${(${GUARD} ? ${PATH}.stringValue() : null)}`);
});

test('export: a known optional source gets its checks, also in an older row without them', () => {
  // printContent.content.docId described in the In of the process, docId optional
  const described = (spec: ProcessSpec) => {
    spec.types = [
      { id: 't-root', name: 'In', kind: 'case', root: true, fields: [{ id: 'f1', name: 'printContent', type: 't-pc' }] },
      { id: 't-pc', name: 'PrintContent', kind: 'case', fields: [{ id: 'f2', name: 'content', type: 't-c' }] },
      { id: 't-c', name: 'Content', kind: 'case', fields: [{ id: 'f3', name: 'docId', type: 'String', optional: true }] },
    ] as TypeDef[];
  };
  const guarded = `\${(${has('printContent.prop("content")', 'docId')} ? ${PATH}.stringValue() : null)}`;
  contains(exported('String', '', described), guarded);
  // the row is the unguarded form of the export — it would throw on a missing docId
  contains(exported('String', oldIn(`\${${PATH}.stringValue()}`), described), guarded);
});

test('export: time targets, no simple type, multi-instance, a plain source and Camunda 8', () => {
  assert.equal(juel('a.b', { type: 'time', optional: false }), 'a.prop("b").stringValue()');
  assert.equal(juel('a.b', { type: 'date time', optional: false }), 'a.prop("b").stringValue()');
  // a list or an unknown target: no end, no checks
  assert.equal(juel('a.b', { type: 'list', optional: true }), 'a.prop("b")');
  assert.equal(juel('a.b', { type: 'any', optional: true }), 'a.prop("b")');
  // the element of a multi-instance is a local — checked without `execution.getVariable`
  const mi = exported('Option[String]', '', (_spec, step) => {
    step.inputs = [{ name: 'docId', expression: '= item.docId' }];
    step.multiInstance = { ...step.multiInstance, collection: 'items', element: 'item' };
  }, '<bpmn:multiInstanceLoopCharacteristics camunda:collection="items" camunda:elementVariable="item" />');
  contains(mi, `sourceExpression="\${(item != null && ${has('item', 'docId')} ? item.prop("docId").stringValue() : null)}"`);
  // a bare variable stays a `source` — the checks never go there
  contains(exported('Option[String]', '', (_spec, step) => { step.inputs = [{ name: 'docId', expression: '= docId' }]; }), '<camunda:in target="docId" source="docId" />');
  // Camunda 8 keeps FEEL — the target changes nothing
  contains(exported('Option[String]', '', spec => { spec.engine = 'c8'; }), 'source="=printContent.content.docId"');
});

test('export: a correct or hand-written row stays literally', () => {
  // already correct — the spacing shows it was not written anew
  const correct = `\${ ${PATH}.stringValue() }`;
  contains(exported('String', oldIn(correct)), correct);
  // a condition of its own is not the guard of the export
  const own = `\${(flag ? ${PATH} : null)}`;
  const xml = exported('Option[String]', oldIn(own), (_spec, step) => { step.inputs = [{ name: 'docId', expression: '= if flag then printContent.content.docId else null' }]; });
  assert.ok(!xml.includes(`${PATH}.stringValue()`), xml);
  // an own condition with the end stays, even where the export would guard
  const ownEnd = `\${(flag ? ${PATH}.stringValue() : null)}`;
  contains(exported('Option[String]', oldIn(ownEnd), (_spec, step) => { step.inputs = [{ name: 'docId', expression: '= if flag then printContent.content.docId else null' }]; }), ownEnd);
});

test('export: a service task — its input parameters take the type of the In', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="d" targetNamespace="x">
  <bpmn:process id="acme-demo-printV1" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="ArchiveTask" name="Archive" camunda:type="external" camunda:topic="acme-demo-archive">
      <bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="EndEvent"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="ArchiveTask"/>
    <bpmn:sequenceFlow id="f2" sourceRef="ArchiveTask" targetRef="EndEvent"/>
  </bpmn:process>
</bpmn:definitions>`;
  const model = archiveModel('Option[String]');
  (model.domainTypes![0] as { topicName?: string }).topicName = 'acme-demo-archive';
  const spec = importBpmn(xml, 'print').spec;
  allSteps(spec.steps).find(s => s.id === 'ArchiveTask')!.inputs = [{ name: 'docId', expression: '= printContent.content.docId' }];
  const out = writeBpmn(xml, spec, model).xml.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  contains(out, `<camunda:inputParameter name="docId">\${(${GUARD} ? ${PATH}.stringValue() : null)}</camunda:inputParameter>`);
});

test('export: a written row stays as it is in the next export', () => {
  for (const [docId, expr] of [['String', `\${${PATH}.stringValue()}`], ['Option[String]', `\${(${GUARD} ? ${PATH}.stringValue() : null)}`]]) {
    const again = exported(docId, oldIn(expr));
    contains(again, `sourceExpression="${expr}"`);
    // not checked twice
    assert.equal(again.split('.hasProp("docId")').length - 1, docId === 'String' ? 0 : 1, again);
  }
});
