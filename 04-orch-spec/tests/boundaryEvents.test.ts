// Signal and message on the edge (boundary event): not an error — name and correlation on the step.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { allSteps, importBpmn, isEventBoundary, mergeSpec, syncBoundaryEvents } from '../src/bpmn';
import { writeBpmn } from '../src/bpmnWrite';
import { collectFindings } from '../src/findings';
import { correlationKeysOf } from '../src/messageCall';
import type { ErrorHandling, ProcessSpec, Step } from '../src/types';
import { installXmlNamespaces } from './xmlNamespaces';

const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser ??= DOMParser;
g.XMLSerializer ??= class { serializeToString(doc: { toString(): string }) { return doc.toString(); } };
installXmlNamespaces();

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:modeler="http://camunda.org/schema/modeler/1.0" modeler:executionPlatform="Camunda Cloud" id="d" targetNamespace="x">
  <bpmn:process id="acme-demo-escalationV1" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="WaitTask" name="Wait"><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:userTask>
    <bpmn:boundaryEvent id="StopEvent" name="stop escalation" attachedToRef="WaitTask"><bpmn:outgoing>f3</bpmn:outgoing>
      <bpmn:signalEventDefinition id="sd" signalRef="Sig"/>
    </bpmn:boundaryEvent>
    <bpmn:boundaryEvent id="ResetEvent" name="reset" cancelActivity="false" attachedToRef="WaitTask"><bpmn:outgoing>f4</bpmn:outgoing>
      <bpmn:messageEventDefinition id="md" messageRef="Msg"/>
    </bpmn:boundaryEvent>
    <bpmn:endEvent id="EndEvent"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
    <bpmn:endEvent id="StoppedEvent" name="stopped"><bpmn:incoming>f3</bpmn:incoming></bpmn:endEvent>
    <bpmn:endEvent id="ResetDoneEvent" name="reset done"><bpmn:incoming>f4</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="WaitTask"/>
    <bpmn:sequenceFlow id="f2" sourceRef="WaitTask" targetRef="EndEvent"/>
    <bpmn:sequenceFlow id="f3" sourceRef="StopEvent" targetRef="StoppedEvent"/>
    <bpmn:sequenceFlow id="f4" sourceRef="ResetEvent" targetRef="ResetDoneEvent"/>
  </bpmn:process>
  <bpmn:signal id="Sig" name="=&#34;acme-stop-&#34; + mainProcessInstanceId" />
  <bpmn:message id="Msg" name="acme-reset"><bpmn:extensionElements><zeebe:subscription correlationKey="=businessKey" /></bpmn:extensionElements></bpmn:message>
</bpmn:definitions>`;

const spec = () => importBpmn(xml, 'escalation').spec;
const wait = (s: ProcessSpec): Step => allSteps(s.steps).find(x => x.id === 'WaitTask')!;
const entry = (s: ProcessSpec, id: string): ErrorHandling => wait(s).errors!.find(e => e.boundaryId === id)!;
const edited = (s: ProcessSpec, id: string, patch: Partial<ErrorHandling>): ProcessSpec => ({
  ...s, steps: s.steps.map(x => (x.id === 'WaitTask' ? { ...x, errors: x.errors!.map(e => (e.boundaryId === id ? { ...e, ...patch } : e)) } : x)),
});

test('import: signal and message at the border are events - with their name, the message with its key', () => {
  const s = spec();
  const stop = entry(s, 'StopEvent');
  assert.ok(isEventBoundary(stop));
  assert.equal(stop.eventKind, 'signal');
  assert.equal(stop.messageName, '="acme-stop-" + mainProcessInstanceId');
  const reset = entry(s, 'ResetEvent');
  assert.equal(reset.eventKind, 'message');
  assert.equal(reset.correlationKey, '=businessKey');
  assert.equal(reset.interrupting, false);
});

test('findings: no «handled error» checks for them - only the correlation of the message', () => {
  const f = collectFindings(spec(), null, allSteps(spec().steps)).get('WaitTask');
  const all = [...(f?.errors ?? []), ...(f?.warnings ?? [])];
  assert.ok(!all.some(t => t.includes('Behandelter Fehler')));
});

test('export: the name of the signal and the key of the message go into the diagram', () => {
  let s = edited(spec(), 'StopEvent', { messageName: '="acme-halt-" + mainProcessInstanceId' });
  s = edited(s, 'ResetEvent', { correlationKey: '=processInstanceId' });
  const back = importBpmn(writeBpmn(xml, s).xml, 'escalation').spec;
  assert.equal(entry(back, 'StopEvent').messageName, '="acme-halt-" + mainProcessInstanceId');
  assert.equal(entry(back, 'ResetEvent').correlationKey, '=processInstanceId');
});

test('merge: an edit in the app stays while the diagram has not changed it', () => {
  const base = spec();
  const mine = edited(spec(), 'StopEvent', { messageName: 'acme-halt' });
  assert.equal(entry(mergeSpec(spec(), mine, base).spec, 'StopEvent').messageName, 'acme-halt');
});

test('load: an older spec - the events as errors - gets kind and name from the diagram', () => {
  const fresh = spec();
  const old = { ...fresh, steps: fresh.steps.map(x => (x.id === 'WaitTask'
    ? { ...x, errors: x.errors!.map(({ code, interrupting, boundary, steps }) => ({ code, interrupting, boundary, steps })) } : x)) };
  const synced = syncBoundaryEvents(old, fresh)!;
  assert.equal(wait(synced).errors!.filter(isEventBoundary).length, 2);
  assert.equal(syncBoundaryEvents(fresh, fresh), null);
});

test('C7 -> C8: the chosen key of a message at the border goes with its boundary event', () => {
  assert.deepEqual(correlationKeysOf(edited(spec(), 'ResetEvent', { correlationKey: '=processInstanceId' })), { ResetEvent: '=processInstanceId' });
});
