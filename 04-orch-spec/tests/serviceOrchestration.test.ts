// A service orchestration: a flow of service and script tasks becomes a CustomTask and a
// CustomWorker whose runWorkZIO calls the service workers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { newCollection } from '../src/services/collection';
import {
  flowIssues, flowOf, newOrchestration, orchestrationIssues, servicesByTopic, varsAt,
} from '../src/services/orchestration';
import { orchestrationFiles } from '../src/services/scalaOrchestration';
import type { CollectionService, ServiceCollectionSpec, ServiceOrchestrationSpec } from '../src/services/types';
import type { TypeDef } from '../src/types';

(globalThis as unknown as { DOMParser: unknown }).DOMParser ??= DOMParser;

// a collection with GetClient (clientKey → name, etag) and PutClient (clientKey, etag, name)
const t = (id: string, name: string, fields: Array<[string, string, boolean?]>, interactionId?: string): TypeDef =>
  ({ id, name, kind: 'case', ...(interactionId ? { interactionId } : {}), fields: fields.map(([n, type, optional]) => ({ id: `${id}-${n}`, name: n, type, ...(optional ? { optional: true } : {}) })) });
const svc = (id: string, name: string, method: 'GET' | 'PUT', extra: Partial<CollectionService> = {}): CollectionService =>
  ({ id, name, api: 'client', apiVersion: 1, status: 'implemented', method, path: '/clients/{clientKey}', params: [], inTypeId: `${id}-in`, outTypeId: `${id}-out`, ...extra });
const collection = (): ServiceCollectionSpec => ({
  ...newCollection({ title: 'Client', project: 'acme-crm', api: 'client', apiVersion: 1 }),
  types: [
    t('get-in', 'In', [['clientKey', 'Long']], 'get'), t('get-out', 'Out', [['name', 'String'], ['etag', 'String', true]], 'get'),
    t('put-in', 'In', [['clientKey', 'Long'], ['etag', 'String'], ['name', 'String']], 'put'), t('put-out', 'Out', [], 'put'),
    t('crm-in', 'In', [['clientKey', 'Long']], 'crm'), t('crm-out', 'Out', [['segment', 'Int']], 'crm'),
  ],
  services: [
    svc('get', 'GetClient', 'GET'),
    svc('put', 'PutClient', 'PUT', { noOut: true }),
    svc('crm', 'GetSegment', 'GET', { api: 'crm', apiVersion: 2 }),
  ],
});

const task = (id: string, name: string, kind = 'serviceTask') => `<bpmn:${kind} id="${id}" name="${name}" />`;
const flow = (id: string, from: string, to: string, cond?: string) =>
  `<bpmn:sequenceFlow id="${id}" sourceRef="${from}" targetRef="${to}"${cond ? ` name="${cond}"` : ''} />`;
const bpmn = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="x">
  <bpmn:process id="acme-crm-clientV1-UpdateClient" isExecutable="false">
    <bpmn:startEvent id="Start" />
    ${body}
    <bpmn:endEvent id="End" />
  </bpmn:process>
</bpmn:definitions>`;

/** GetClient, then — in parallel — the segment and a script, then PutClient only if the name changed */
const orchestration = (): ServiceOrchestrationSpec => {
  const o = newOrchestration({ title: 'Kunde ändern', project: 'acme-crm', api: 'client', apiVersion: 1, name: 'UpdateClient' });
  const inType = o.types.find(x => x.id === o.inTypeId)!;
  const outType = o.types.find(x => x.id === o.outTypeId)!;
  inType.fields = [{ id: 'f1', name: 'clientKey', type: 'Long' }, { id: 'f2', name: 'name', type: 'String' }];
  outType.fields = [{ id: 'f3', name: 'etag', type: 'String' }, { id: 'f4', name: 'segment', type: 'Int' }];
  return {
    ...o,
    bpmn: bpmn(`
      ${task('Get', 'Kunde lesen')}
      <bpmn:parallelGateway id="Fork" />
      ${task('Segment', 'Segment lesen')}
      ${task('Mark', 'Markieren', 'scriptTask')}
      <bpmn:parallelGateway id="Join" />
      <bpmn:exclusiveGateway id="Changed" name="geändert?" />
      ${task('Put', 'Kunde schreiben')}
      <bpmn:exclusiveGateway id="Merge" />
      ${flow('f1', 'Start', 'Get')}${flow('f2', 'Get', 'Fork')}
      ${flow('f3', 'Fork', 'Segment')}${flow('f4', 'Fork', 'Mark')}${flow('f5', 'Segment', 'Join')}${flow('f6', 'Mark', 'Join')}
      ${flow('f7', 'Join', 'Changed')}${flow('yes', 'Changed', 'Put', 'ja')}${flow('no', 'Changed', 'Merge', 'nein')}
      ${flow('f8', 'Put', 'Merge')}${flow('f9', 'Merge', 'End')}`),
    tasks: {
      Get: { service: 'acme-crm-clientV1.GetClient' },
      Segment: { service: 'acme-crm-crmV2.GetSegment', result: 'crm' },
      Mark: { assignments: [{ name: 'marker', expression: '= "updated"' }] },
      Put: { service: 'acme-crm-clientV1.PutClient', inputs: [{ name: 'etag', expression: '= getClient.etag' }] },
    },
    conditions: { yes: '= getClient.name != name' },
    outMappings: [{ name: 'etag', expression: '= getClient.etag' }, { name: 'segment', expression: '= crm.segment' }],
  };
};

test('the flow comes from the BPMN — only service and script tasks, parallel and exclusive gateways', () => {
  const o = orchestration();
  const steps = flowOf(o).steps;
  assert.deepEqual(flowIssues(steps), []);
  const withUser = { ...o, bpmn: o.bpmn.replace('<bpmn:serviceTask id="Segment"', '<bpmn:userTask id="Segment"').replace('name="Segment lesen" />', 'name="Segment lesen" />') };
  assert.match(flowIssues(flowOf(withUser).steps).map(i => i.text).join('\n'), /Segment lesen.*nur Service- und Script-Tasks/);
});

test('what is known before a step: the In, the results before it — optional after an exclusive branch', () => {
  const o = orchestration();
  const services = servicesByTopic([collection()]);
  const steps = flowOf(o).steps;
  assert.deepEqual(varsAt(o, steps, services, 'Get').map(v => v.name), ['clientKey', 'name']);
  assert.deepEqual(varsAt(o, steps, services, 'Put').map(v => v.name), ['clientKey', 'name', 'getClient', 'crm', 'marker']);
  // PutClient has no Out — nothing comes out of the exclusive gateway
  assert.deepEqual(varsAt(o, steps, services).map(v => `${v.name}${v.optional ? '?' : ''}`), ['clientKey', 'name', 'getClient', 'crm', 'marker']);
  assert.deepEqual(orchestrationIssues(o, services), []);
  const missing = { ...o, tasks: { ...o.tasks, Get: {} }, conditions: {} };
  // without any condition it is open which branch is the else — both are named
  assert.deepEqual(orchestrationIssues(missing, services), ['«Kunde lesen»: kein Service gewählt.', '«geändert?» → «ja»: keine Bedingung.', '«geändert?» → «nein»: keine Bedingung.']);
});

test('the CustomTask and the CustomWorker: one for in runWorkZIO', () => {
  const files = orchestrationFiles(orchestration(), [collection()]);
  assert.deepEqual(files.map(f => f.path), [
    '01-domain/src/main/scala/acme/crm/domain/client/v1/UpdateClient.scala',
    '03-worker/src/main/scala/acme/crm/worker/client/v1/UpdateClientWorker.scala',
  ]);
  const task = files[0].content;
  assert.match(task, /object UpdateClient\n {4}extends CompanyBpmnCustomTaskDsl:/);
  assert.match(task, /final val topicName = "acme-crm-clientV1\.UpdateClient"/);
  assert.match(task, /lazy val example =\n {4}customTask\(\n {6}in = In\.example,\n {6}out = Out\.example\n {4}\)/);
  const w = files[1].content;
  assert.match(w, /class UpdateClientWorker\n {4}extends CompanyCustomWorkerDsl\[In, Out\]:/);
  // a service of another API comes by import
  assert.match(w, /import acme\.crm\.domain\.crm\.v2\.GetSegment\nimport acme\.crm\.worker\.crm\.v2\.GetSegmentWorker/);
  assert.match(w, /getClient <- GetClientWorker\(\)\n\s+\.runWorkFromWorkerUnsafe\(\n\s+GetClient\.In\(\n\s+clientKey = in\.clientKey\n\s+\)\n\s+\)\n\s+\.mapError\(e => CustomError\(s"GetClient: \$\{e\.errorMsg\}"\)\)/);
  // parallel: forked and joined
  assert.match(w, /fiber\d+ <- \(\n\s+\(for \{[\s\S]*crm <- GetSegmentWorker\(\)[\s\S]*\} yield crm\)\n\s+\)\.fork/);
  assert.match(w, /crm <- fiber\d+\.join\n\s+marker <- fiber\d+\.join/);
  // exclusive: the condition, PutClient with the etag of GetClient (optional → a step that fails)
  assert.match(w, /_ <-\n\s+if getClient\.name != in\.name then\n\s+\(for \{/);
  assert.match(w, /etag\d+ <- ZIO\.fromOption\(getClient\.etag\)\.orElseFail\(CustomError\("PutClient: etag fehlt"\)\)/);
  // the branch without a condition is the else
  assert.match(w, /else\n\s+ZIO\.succeed\(\(\)\)/);
  assert.doesNotMatch(w, /Bedingung für «nein»/);
  assert.match(w, /yield Out\(\n\s+etag = etag\d+,\n\s+segment = crm\.segment\n\s+\)/);
});

test('conditions in FEEL become Scala — comparisons, null, and/or/not, Option as Option', async () => {
  const { feelCondition } = await import('../src/services/feelScala');
  const types: TypeDef[] = [
    { id: 'kind', name: 'Kind', kind: 'enum', values: [{ name: 'Private' }, { name: 'Company' }] },
    t('client', 'Client', [['name', 'String'], ['etag', 'String', true], ['segment', 'Int', true], ['kind', 'kind'], ['active', 'Boolean']]),
  ];
  const vars = new Map([['client', { scala: 'client', type: 'client' }], ['limit', { scala: 'in.limit', type: 'Int' }]]);
  const c = (e: string) => feelCondition(e, vars, types).scala;
  assert.equal(c('= client.active'), 'client.active');
  assert.equal(c('= client.name = "Muster"'), 'client.name == "Muster"');
  assert.equal(c('= client.etag != null'), 'client.etag.isDefined');
  assert.equal(c('= client.etag = null'), 'client.etag.isEmpty');
  assert.equal(c('= client.segment = 3'), 'client.segment.contains(3)');
  assert.equal(c('= client.segment > limit'), 'client.segment.exists(_ > in.limit)');
  assert.equal(c('= client.kind = "Company"'), 'client.kind == Kind.Company');
  assert.equal(c('= client.active and not(client.etag = null)'), 'client.active && !(client.etag.isEmpty)');
  assert.equal(c('= (client.segment = 1 or client.segment = 2) and client.active'), '(client.segment.contains(1) || client.segment.contains(2)) && client.active');
  assert.match(c('= count(client) > 1'), /^\?\?\? \/\* TODO Bedingung: count\(client\) > 1 \*\//);
});

test('an Out with cases (ADT): one step that takes the first case whose condition holds - what a case needs fails only there', () => {
  const o = orchestration();
  const out = o.types.find(x => x.id === o.outTypeId)!;
  out.kind = 'enum';
  out.fields = [{ id: 'f4', name: 'segment', type: 'Int' }];
  out.values = [{ name: 'Changed', fields: [{ id: 'f3', name: 'etag', type: 'String' }] }, { name: 'Unchanged' }];
  const w = orchestrationFiles({
    ...o,
    outMappings: [],
    outCases: [
      { name: 'Changed', condition: '= getClient.name != name', mappings: [{ name: 'etag', expression: '= getClient.etag' }, { name: 'segment', expression: '= crm.segment' }] },
      { name: 'Unchanged', mappings: [{ name: 'segment', expression: '= crm.segment' }] },
    ],
  }, [collection()])[1].content;
  assert.match(w, /out(\d+) <- \(\n\s+if getClient\.name != in\.name then\n\s+\(for \{\n\s+etag\d+ <- ZIO\.fromOption\(getClient\.etag\)\.orElseFail\(CustomError\("UpdateClient: etag fehlt"\)\)\n\s+\} yield Out\.Changed\(\n\s+segment = crm\.segment,\n\s+etag = etag\d+\n\s+\)\)\n\s+else\n\s+ZIO\.succeed\(Out\.Unchanged\(\n\s+segment = crm\.segment\n\s+\)\)\n\s+\)/, w);
  assert.match(w, /yield out\d+\n/, w);
});
