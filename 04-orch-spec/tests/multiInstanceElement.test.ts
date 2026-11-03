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
