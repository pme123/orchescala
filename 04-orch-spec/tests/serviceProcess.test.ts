// A service orchestration as a process in service mode: created like a process, described like
// one (inputs and outputs per step), exported as a CustomTask and its CustomWorker.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { allSteps } from '../src/bpmn';
import { newCollection } from '../src/services/collection';
import { newOrchestration, servicesByTopic } from '../src/services/orchestration';
import { orchestrationFiles } from '../src/services/scalaOrchestration';
import {
  asOrchestration, fromOrchestration, isServiceProcess, newServiceProcess, serviceProcessTopic, withCollections, type ServiceProcess,
} from '../src/services/serviceProcess';
import type { CollectionService, ServiceCollectionSpec, ServiceOrchestrationSpec } from '../src/services/types';
import type { Step, TypeDef } from '../src/types';

(globalThis as unknown as { DOMParser: unknown }).DOMParser ??= DOMParser;

const t = (id: string, name: string, fields: Array<[string, string, boolean?]>, interactionId?: string): TypeDef =>
  ({ id, name, kind: 'case', ...(interactionId ? { interactionId } : {}), fields: fields.map(([n, type, optional]) => ({ id: `${id}-${n}`, name: n, type, ...(optional ? { optional: true } : {}) })) });
const svc = (id: string, name: string, method: 'GET' | 'PUT', extra: Partial<CollectionService> = {}): CollectionService =>
  ({ id, name, api: 'client', apiVersion: 1, status: 'implemented', method, path: '/clients/{clientKey}', params: [], inTypeId: `${id}-in`, outTypeId: `${id}-out`, ...extra });
const collection = (): ServiceCollectionSpec => ({
  ...newCollection({ title: 'Client', project: 'acme-crm', api: 'client', apiVersion: 1 }),
  types: [
    t('get-in', 'In', [['clientKey', 'Long']], 'get'), t('get-out', 'Out', [['name', 'String'], ['etag', 'String', true]], 'get'),
    t('put-in', 'In', [['clientKey', 'Long'], ['etag', 'String'], ['name', 'String']], 'put'), t('put-out', 'Out', [], 'put'),
  ],
  services: [svc('get', 'GetClient', 'GET'), svc('put', 'PutClient', 'PUT', { noOut: true })],
});

const bpmn = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="x">
  <bpmn:process id="acme-crm-clientV1-UpdateClient" isExecutable="false">
    <bpmn:startEvent id="Start" />
    ${body}
    <bpmn:endEvent id="End" />
  </bpmn:process>
</bpmn:definitions>`;
const flow = (id: string, from: string, to: string) => `<bpmn:sequenceFlow id="${id}" sourceRef="${from}" targetRef="${to}" />`;

/** GetClient, then PutClient with the etag GetClient returned */
function described(): ServiceProcess {
  const { spec } = newServiceProcess({ title: 'Kunde ändern', project: 'acme-crm', api: 'client', apiVersion: 1, name: 'UpdateClient' });
  const xml = bpmn(`<bpmn:serviceTask id="Get" name="Kunde lesen" /><bpmn:serviceTask id="Put" name="Kunde schreiben" />
    ${flow('f1', 'Start', 'Get')}${flow('f2', 'Get', 'Put')}${flow('f3', 'Put', 'End')}`);
  const fresh = fromOrchestration({ ...newOrchestration({ title: 'x', project: 'acme-crm', api: 'client', apiVersion: 1, name: 'UpdateClient' }), bpmn: xml }, new Map()).spec;
  const steps = fresh.steps.map((s): Step => s.id === 'Get'
    ? { ...s, topic: 'acme-crm-clientV1.GetClient', serviceId: 'acme-crm-clientV1.GetClient', outputs: [{ name: 'etag', expression: '= etag' }, { name: 'name', expression: '= name', disabled: true }] }
    : s.id === 'Put' ? { ...s, topic: 'acme-crm-clientV1.PutClient', serviceId: 'acme-crm-clientV1.PutClient', inputs: [{ name: 'name', expression: '= "Muster"' }] } : s);
  const types = spec.types!.map(x => (x.root ? { ...x, fields: [{ id: 'k', name: 'clientKey', type: 'Long' }] } : x.processOut ? { ...x, fields: [{ id: 'e', name: 'etag', type: 'String' }] } : x));
  return { ...spec, steps, types };
}

test('a new orchestration is a process in service mode: its id, its topic, In and Out as roles, FEEL', () => {
  const { spec, xml } = newServiceProcess({ title: 'Kunde ändern', project: 'acme-crm', api: 'client', apiVersion: 1, name: 'UpdateClient' });
  assert.ok(isServiceProcess(spec));
  assert.equal(spec.processId, 'acme-crm-clientV1-UpdateClient');
  assert.equal(spec.slug, 'acme-crm-clientv1-updateclient');
  assert.equal(serviceProcessTopic(spec), 'acme-crm-clientV1.UpdateClient');
  assert.equal(spec.engine, 'c8');
  assert.deepEqual(allSteps(spec.steps).map(s => s.status), ['draft', 'draft', 'draft']);
  assert.deepEqual(spec.types!.map(x => [x.name, !!x.root, !!x.processOut]), [['In', true, false], ['Out', false, true]]);
  assert.deepEqual(allSteps(spec.steps).map(s => s.kind), ['start', 'service', 'end']);
  assert.match(xml, /<bpmn:process id="acme-crm-clientV1-UpdateClient"/);
  assert.equal(isServiceProcess({ ...spec, service: undefined }), false);
});

test('the export reads the process: inputs per field of the In, the outputs as variables from the Out', () => {
  const o = asOrchestration(described());
  assert.deepEqual(o.tasks.Get.outputs, [{ name: 'etag', expression: '= etag' }]);
  const w = orchestrationFiles(o, [collection()])[1].content;
  // GetClient: the In from the variable of the same name, its etag kept as variable — not its name (disabled)
  assert.match(w, /getClient <- GetClientWorker\(\)\n\s+\.runWorkFromWorkerUnsafe\(\n\s+GetClient\.In\(\n\s+clientKey = in\.clientKey/);
  assert.match(w, /etag = getClient\.etag\n/);
  assert.doesNotMatch(w, /name = getClient\.name/);
  // PutClient: etag from the variable (optional → a step that fails), name from its input
  assert.match(w, /etag\d+ <- ZIO\.fromOption\(etag\)\.orElseFail\(CustomError\("PutClient: etag fehlt"\)\)/);
  assert.match(w, /name = "Muster"/);
  assert.match(w, /_ <- PutClientWorker\(\)/);
  // the Out from the variable of the same name — optional there, so a step that fails
  assert.match(w, /yield Out\(\n\s+etag = etag\d+\n\s+\)/);
  const task = orchestrationFiles(o, [collection()])[0].content;
  assert.match(task, /final val topicName = "acme-crm-clientV1\.UpdateClient"/);
  assert.match(task, /case class In\(/);
});

test('an orchestration of before becomes a process: a result read as `getClient.etag` becomes the variable etag', () => {
  const xml = bpmn(`<bpmn:serviceTask id="Get" name="Kunde lesen" /><bpmn:serviceTask id="Put" name="Kunde schreiben" /><bpmn:scriptTask id="Mark" name="Markieren" />
    ${flow('f1', 'Start', 'Get')}${flow('f2', 'Get', 'Mark')}${flow('f3', 'Mark', 'Put')}${flow('f4', 'Put', 'End')}`);
  const base = newOrchestration({ title: 'Kunde ändern', project: 'acme-crm', api: 'client', apiVersion: 1, name: 'UpdateClient' });
  const o: ServiceOrchestrationSpec = {
    ...base, bpmn: xml, description: 'Liest und schreibt',
    tasks: {
      Get: { service: 'acme-crm-clientV1.GetClient' },
      Mark: { assignments: [{ name: 'marker', expression: '= "updated"' }] },
      Put: { service: 'acme-crm-clientV1.PutClient', inputs: [{ name: 'etag', expression: '= getClient.etag' }] },
    },
    outMappings: [{ name: 'etag', expression: '= getClient.etag' }],
  };
  const { spec, xml: kept } = fromOrchestration(o, servicesByTopic([collection()]));
  assert.equal(kept, xml);
  assert.equal(spec.description, 'Liest und schreibt');
  const step = (id: string) => allSteps(spec.steps).find(s => s.id === id)!;
  assert.equal(step('Get').topic, 'acme-crm-clientV1.GetClient');
  assert.ok(allSteps(spec.steps).every(s => s.status === o.status));
  // the fields read are set, the others are there as disabled rows
  assert.deepEqual(step('Get').outputs, [
    { name: 'name', expression: '= name', fromService: true, disabled: true },
    { name: 'etag', expression: '= etag', fromService: true },
  ]);
  assert.deepEqual(step('Put').inputs, [{ name: 'etag', expression: '= etag' }]);
  assert.deepEqual(step('Mark').outputs, [{ name: 'marker', expression: '= "updated"' }]);
  assert.deepEqual(spec.service.outMappings, [{ name: 'etag', expression: '= etag' }]);
  // In and Out are the roles of the process now
  assert.ok(spec.types!.find(x => x.root && x.name === 'In' && !x.interactionId));
  assert.ok(spec.types!.find(x => x.processOut && x.name === 'Out' && !x.interactionId));
});

test('the collections are services of the catalog, with their In and Out as domain — local wins over the catalog', () => {
  const catalog = { version: 1, services: [{ id: 'acme-crm-clientV1.GetClient', name: 'Alt', topic: 'acme-crm-clientV1.GetClient', group: 'Acme CRM', kind: 'service' as const }] };
  const m = withCollections(catalog, [collection()])!;
  const get = m.services.filter(s => s.topic === 'acme-crm-clientV1.GetClient');
  assert.equal(get.length, 1);
  assert.equal(get[0].name, 'GetClient');
  assert.equal(get[0].group, 'Acme CRM');
  assert.ok(m.services.some(s => s.topic === 'acme-crm-clientV1.PutClient'));
  // In and Out as parameters: what a chosen service brings as rows (required from the In)
  assert.deepEqual(get[0].inputs, [{ name: 'clientKey', required: true }]);
  assert.deepEqual(get[0].outputs, [{ name: 'name' }, { name: 'etag' }]);
  assert.deepEqual(m.services.find(s => s.topic === 'acme-crm-clientV1.PutClient')?.outputs, []);
  const inType = m.domainTypes!.find(d => d.name === 'GetClient.In' && d.pkg === 'acme.crm.domain.client.v1');
  assert.deepEqual(inType?.fields?.map(f => [f.name, f.type]), [['clientKey', 'Long']]);
  assert.equal(withCollections(catalog, []), catalog);
});
