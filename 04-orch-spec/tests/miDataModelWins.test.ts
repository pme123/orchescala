// The Out of an own worker is in the data model of the process AND in the
// catalog (Scala domain) - with a different element type. The data model wins:
// the collection has its type, the element its fields.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanScala } from '../src/domainScan';
import { checkFeel, collectionNode, processVariables, withMultiInstance } from '../src/feel';
import type { Model, ProcessSpec, Step } from '../src/types';

const PID = 'acme-printV1';
const source = `package acme.print.domain.print.v1

object PrintDocument extends CompanyBpmnServiceTaskDsl:
  val topicName = "acme-print-document"
  val descr: String = ""
  case class In(docId: String, clientKey: Long)
end PrintDocument

object CreatePrintDocuments extends CompanyBpmnCustomTaskDsl:
  val topicName = "${PID}.CreatePrintDocuments"
  val descr: String = ""
  case class Out(contentForPrinting: Seq[PrintDocument.In])
end CreatePrintDocuments

object Print extends CompanyBpmnProcessDsl:
  val processName = "${PID}"
  val descr: String = ""
  case class In(clientKey: Long)
end Print
`;
const model = { domainTypes: scanScala(source, 'Print.scala') } as unknown as Model;

const spec = (outputs: Step['outputs']): ProcessSpec => ({
  processId: PID, name: PID, engine: 'c8', project: 'acme-print',
  steps: [
    { id: 'CreatePrintDocumentsTask', name: 'Create Print Documents', kind: 'service', topic: `${PID}.CreatePrintDocuments`, ...(outputs ? { outputs } : {}) } as Step,
    { id: 'PrintTask', name: 'Print', kind: 'service', topic: 'acme-print-document', multiInstance: { collection: 'contentForPrinting', element: 'printContent' } } as Step,
  ],
  interactions: [{ id: 'ia', stepId: 'CreatePrintDocumentsTask', kind: 'customTask', name: 'CreatePrintDocuments', key: `${PID}.CreatePrintDocuments`, outTypeId: 't-out' }],
  types: [
    { id: 't-out', name: 'Out', kind: 'case', interactionId: 'ia', fields: [{ id: 'f1', name: 'contentForPrinting', type: 't-cfp', collection: true }] },
    { id: 't-cfp', name: 'ContentForPrinting', kind: 'case', fields: [{ id: 'f2', name: 'content', type: 't-c' }] },
    { id: 't-c', name: 'Content', kind: 'case', fields: [{ id: 'f3', name: 'docId', type: 'String' }] },
  ],
} as unknown as ProcessSpec);

for (const [label, outputs] of [['without output rows', undefined], ['with an output row', [{ name: 'contentForPrinting', expression: '= contentForPrinting' }]]] as const) {
  test(`data model before catalog for the Out of an own worker - ${label}`, () => {
    const s = spec(outputs as Step['outputs']);
    const vars = processVariables(s, model);
    const coll = collectionNode('contentForPrinting', vars);
    assert.equal(coll?.label, 'Seq[ContentForPrinting]', `${coll?.label} from ${coll?.source}`);
    const inside = withMultiInstance(vars, [s.steps[1].multiInstance!]);
    assert.deepEqual(checkFeel('= printContent.content.docId', inside, null).issues, []);
  });
}

// The InitIn still has the old type, the worker before the step writes the new one:
// at the step the latest writer counts - before the worker the InitIn.
test('latest writer before the step decides the type - not the InitIn', async () => {
  const { variablesByStep } = await import('../src/feel');
  const s0 = spec(undefined);
  const s: ProcessSpec = {
    ...s0,
    steps: [{ id: 'EarlyTask', name: 'Early', kind: 'service', topic: 'acme-print-document' } as Step, ...s0.steps],
    types: [
      ...(s0.types ?? []),
      { id: 't-init', name: 'InitIn', kind: 'case', initIn: true, fields: [{ id: 'f9', name: 'contentForPrinting', type: 't-old', collection: true }] },
      { id: 't-old', name: 'OldDoc', kind: 'case', fields: [{ id: 'f8', name: 'docId', type: 'String' }] },
    ],
  } as ProcessSpec;
  const at = variablesByStep(s, model);
  assert.equal(collectionNode('contentForPrinting', at.get('EarlyTask')!)?.label, 'Seq[OldDoc]');
  assert.equal(collectionNode('contentForPrinting', at.get('PrintTask')!)?.label, 'Seq[ContentForPrinting]');
  const inside = withMultiInstance(at.get('PrintTask')!, [s.steps[2].multiInstance!]);
  assert.deepEqual(checkFeel('= printContent.content.docId', inside, null).issues, []);
});
