// A script task's implementation is not in the diagram: a change of the diagram keeps it - the
// FEEL, its result, the mapping drawn.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { allSteps, importBpmn, mergeSpec } from '../src/bpmn';
import { variableOverview } from '../src/feel';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;

const bpmn = (name: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="x">
  <bpmn:process id="acme-crm-clientV1-UpdateClient" isExecutable="false">
    <bpmn:startEvent id="Start" /><bpmn:scriptTask id="MapTask" name="${name}" /><bpmn:endEvent id="End" />
    <bpmn:sequenceFlow id="f1" sourceRef="Start" targetRef="MapTask" /><bpmn:sequenceFlow id="f2" sourceRef="MapTask" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

test('a change of the diagram keeps the script, its result and the mapping', () => {
  const prev = importBpmn(bpmn('Map Client'), 'p').spec;
  const impl = {
    script: '= context merge([existingClient, {name: client.name}])', resultVariable: 'newClient', resultType: 'client',
    fieldMapping: { in: [{ id: 'i', name: 'client', type: 'client' }], out: [{ id: 'o', name: 'newClient', type: 'client' }], fields: [{ field: 'newClient.name', from: ['client.name'] }] },
  };
  Object.assign(allSteps(prev.steps).find(s => s.id === 'MapTask')!, impl);
  const merged = mergeSpec(importBpmn(bpmn('Map the client'), 'p').spec, prev, importBpmn(bpmn('Map Client'), 'p').spec).spec;
  const t = allSteps(merged.steps).find(s => s.id === 'MapTask')!;
  assert.equal(t.name, 'Map the client');
  assert.deepEqual({ script: t.script, resultVariable: t.resultVariable, resultType: t.resultType, fieldMapping: t.fieldMapping }, impl);
});

test('a mapping stored without an In or Out: the overview of the variables still works', () => {
  const spec = importBpmn(bpmn('Map Client'), 'p').spec;
  Object.assign(allSteps(spec.steps).find(s => s.id === 'MapTask')!, { fieldMapping: { fields: [{ field: 'name', from: ['client.name'] }] } });
  assert.doesNotThrow(() => variableOverview(spec, null));
});
