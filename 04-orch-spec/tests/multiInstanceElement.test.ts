// The element of a multi-instance has the element type of its collection: a
// worker returns `contentForPrinting: Seq[PrintContent]`, the step runs per
// `printContent` - then `printContent.content.docId` is a known path, and a
// list of plain values gives the element their type.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanScala } from '../src/domainScan';
import { checkFeel, elementNode, processVariables, withMultiInstance } from '../src/feel';
import type { Model, ProcessSpec, Step } from '../src/types';

const source = `package acme.print.domain.print.v1

object GetPrintContent extends CompanyBpmnServiceTaskDsl:
  val topicName = "acme-print-get"
  val descr: String = ""
  case class In(clientKey: Long)
  case class Content(docId: String, pages: Int)
  case class PrintContent(content: Content, copies: Int)
  case class Out(contentForPrinting: Seq[PrintContent], labels: Seq[String])
end GetPrintContent
`;
const model = { domainTypes: scanScala(source, 'GetPrintContent.scala') } as unknown as Model;
const get: Step = {
  id: 'GetTask', name: 'Get Print Content', kind: 'service', topic: 'acme-print-get',
  outputs: [{ name: 'contentForPrinting', expression: '= contentForPrinting' }, { name: 'labels', expression: '= labels' }],
} as Step;
const print = (collection: string, element: string): Step =>
  ({ id: 'PrintTask', name: 'Print', kind: 'service', topic: 'acme-print-do', multiInstance: { collection, element } } as Step);
const spec = (s: Step): ProcessSpec => ({ processId: 'acme-printV1', name: 'acme-printV1', engine: 'c8', steps: [get, s] } as unknown as ProcessSpec);

test('the element of a list of objects has their fields - also nested ones', () => {
  const s = print('contentForPrinting', 'printContent');
  const vars = processVariables(spec(s), model);
  const elem = elementNode('printContent', 'contentForPrinting', vars);
  assert.equal(elem.label, 'PrintContent');
  assert.deepEqual(elem.children?.map(c => c.name), ['content', 'copies']);
  const inside = withMultiInstance(vars, [s.multiInstance!]);
  assert.deepEqual(checkFeel('= printContent.content.docId', inside, null).issues, []);
  assert.ok(checkFeel('= printContent.docId', inside, null).issues.some(i => i.text.includes('printContent.docId')));
});

test('a list of plain values: the element has their type', () => {
  const vars = processVariables(spec(print('labels', 'label')), model);
  const elem = elementNode('label', 'labels', vars);
  assert.equal(elem.type, 'string');
  assert.equal(elem.label, 'String');
});

test('an unknown collection leaves the element open', () => {
  const vars = processVariables(spec(print('nothing', 'x')), model);
  assert.equal(elementNode('x', 'nothing', vars).type, 'any');
});

// The worker's Out described in the data model of the process (own classes) - and a
// variable of the same name as the element from elsewhere: inside the multi-instance
// the element wins, its type is that of the collection.
const ownSpec = (extra: Partial<ProcessSpec> = {}): ProcessSpec => ({
  processId: 'acme-printV1', name: 'acme-printV1', engine: 'c8',
  steps: [
    { id: 'GetTask', name: 'Get Print Content', kind: 'service', topic: 'acme-printV1-get' } as Step,
    print('contentForPrinting', 'printContent'),
  ],
  interactions: [{ id: 'ia', stepId: 'GetTask', kind: 'customTask', name: 'GetPrintContent', key: 'acme-printV1-get', outTypeId: 't-out' }],
  types: [
    { id: 't-out', name: 'Out', kind: 'case', interactionId: 'ia', fields: [{ id: 'f1', name: 'contentForPrinting', type: 't-pc', collection: true }] },
    { id: 't-pc', name: 'PrintContent', kind: 'case', fields: [{ id: 'f2', name: 'content', type: 't-c' }] },
    { id: 't-c', name: 'Content', kind: 'case', fields: [{ id: 'f3', name: 'docId', type: 'String' }, { id: 'f4', name: 'tags', type: 'String', collection: true }] },
  ],
  ...extra,
} as unknown as ProcessSpec);

test('data model: the element of the Out list of an own worker has the fields of its class', () => {
  const s = ownSpec();
  const vars = processVariables(s, null);
  const inside = withMultiInstance(vars, [s.steps[1].multiInstance!]);
  assert.equal(inside.find(v => v.name === 'printContent')?.label, 'PrintContent');
  assert.deepEqual(checkFeel('= printContent.content.docId', inside, null).issues, []);
});

test('a variable of the same name from elsewhere does not hide the element inside the multi-instance', () => {
  // e.g. still a process variable from an older state, with another structure
  const s = ownSpec({ variables: [{ name: 'printContent', type: 'Content' }] } as Partial<ProcessSpec>);
  const vars = processVariables(s, null);
  assert.ok(vars.some(v => v.name === 'printContent' && v.source === 'Variable'));
  const inside = withMultiInstance(vars, [s.steps[1].multiInstance!]);
  assert.equal(inside.filter(v => v.name === 'printContent').length, 1);
  assert.deepEqual(checkFeel('= printContent.content.docId', inside, null).issues, []);
});

test('nested: the collection of an inner multi-instance reads the element of the outer one', () => {
  const s = ownSpec();
  const vars = processVariables(s, null);
  const inside = withMultiInstance(vars, [s.steps[1].multiInstance!, { collection: 'printContent.content.tags', element: 'tag' }]);
  assert.equal(inside.find(v => v.name === 'tag')?.type, 'string');
});
