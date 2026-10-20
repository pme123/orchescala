// Der Timer eines Ereignisses: welche Variable er liest — sie ist eine Konstante im InConfig.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { allSteps, importBpmn, mergeSpec, syncTimers } from '../src/bpmn';
import { writeBpmn } from '../src/bpmnWrite';
import { collectFindings } from '../src/findings';
import { loopSettings } from '../src/interactions';
import { renderInConfig } from '../src/scala';
import type { ProcessSpec, Step } from '../src/types';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;
(globalThis as unknown as { XMLSerializer: unknown }).XMLSerializer = class { serializeToString(n: Node) { return String(n); } };

const c7 = (duration: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="d" targetNamespace="x">
  <bpmn:process id="acme-demo-escalateV1" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="ApproveTask" name="Approve"><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:userTask>
    <bpmn:boundaryEvent id="InformBoundary" name="inform" cancelActivity="false" attachedToRef="ApproveTask">
      <bpmn:timerEventDefinition id="t1"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">\${timerEscalationInform}</bpmn:timeDuration></bpmn:timerEventDefinition>
    </bpmn:boundaryEvent>
    <bpmn:intermediateCatchEvent id="Wait7DaysEvent" name="Wait 7 days"><bpmn:incoming>f2</bpmn:incoming><bpmn:outgoing>f3</bpmn:outgoing>
      <bpmn:timerEventDefinition id="t2"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">${duration}</bpmn:timeDuration></bpmn:timerEventDefinition>
    </bpmn:intermediateCatchEvent>
    <bpmn:endEvent id="EndEvent" name="done"><bpmn:incoming>f3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="ApproveTask"/>
    <bpmn:sequenceFlow id="f2" sourceRef="ApproveTask" targetRef="Wait7DaysEvent"/>
    <bpmn:sequenceFlow id="f3" sourceRef="Wait7DaysEvent" targetRef="EndEvent"/>
  </bpmn:process>
</bpmn:definitions>`;

const imported = (xml: string) => importBpmn(xml, 'escalate').spec;
const wait = (s: ProcessSpec): Step => allSteps(s.steps).find(x => x.id === 'Wait7DaysEvent')!;
const messages = (s: ProcessSpec) => [...collectFindings(s, null, allSteps(s.steps)).values()].flatMap(f => [...f.errors, ...f.warnings]);

test('import: the timer of an event and of a boundary event - as FEEL', () => {
  const s = imported(c7('${timerEscalationCancel}'));
  assert.deepEqual(wait(s).timer, { kind: 'duration', expression: '= timerEscalationCancel' });
  const approve = allSteps(s.steps).find(x => x.id === 'ApproveTask')!;
  assert.deepEqual(approve.errors?.find(e => e.code === 'inform')?.timer, { kind: 'duration', expression: '= timerEscalationInform' });
});

test('InConfig: each timer variable is a constant - with the default of the step', () => {
  const s = imported(c7('${timerEscalationCancel}'));
  wait(s).timer = { ...wait(s).timer!, default: 'P7D' };
  assert.deepEqual(loopSettings(s).map(l => [l.name, l.kind, l.default ?? '']).sort(),
    [['timerEscalationCancel', 'timer', 'P7D'], ['timerEscalationInform', 'timer', '']]);
  const out = renderInConfig(s, new Set());
  assert.match(out, /timerEscalationCancel: Iso8601Duration = "P7D"/);
  assert.match(out, /timerEscalationInform: Iso8601Duration = "PT1M"/);
});

test('findings: a fixed value and a variable without default are warned', () => {
  assert.ok(messages(imported(c7('P7D'))).some(m => m.startsWith('Fester Timer «P7D»')), messages(imported(c7('P7D'))).join(' / '));
  const s = imported(c7('${timerEscalationCancel}'));
  assert.ok(messages(s).some(m => m.includes('«timerEscalationCancel» ohne Vorgabe')));
  wait(s).timer = { ...wait(s).timer!, default: 'P7D' };
  assert.ok(!messages(s).some(m => m.includes('timerEscalationCancel')), messages(s).join(' / '));
});

test('export: a changed timer is written per engine - unchanged stays as it is', () => {
  const xml = c7('P7D');
  const s = imported(xml);
  wait(s).timer = { kind: 'duration', expression: '= timerWait' };
  assert.match(writeBpmn(xml, s).xml, /<bpmn:timeDuration xsi:type="bpmn:tFormalExpression">\$\{timerWait\}<\/bpmn:timeDuration>/);
  const c8 = writeBpmn(xml, { ...s, engine: 'c8' }).xml;
  assert.match(c8, /<bpmn:timeDuration xsi:type="bpmn:tFormalExpression">=timerWait<\/bpmn:timeDuration>/);
  const unchanged = writeBpmn(c7('${timerEscalationCancel}'), imported(c7('${timerEscalationCancel}'))).xml;
  assert.match(unchanged, /\$\{timerEscalationCancel\}/);
});

test('merge keeps the default; an older spec without timers gets them on open', () => {
  const xml = c7('${timerEscalationCancel}');
  const prev = imported(xml);
  wait(prev).timer = { ...wait(prev).timer!, default: 'P7D' };
  assert.equal(wait(mergeSpec(imported(xml), prev).spec).timer?.default, 'P7D');
  const old = imported(xml);
  delete wait(old).timer;
  const healed = syncTimers(old, imported(xml));
  assert.equal(wait(healed!).timer?.expression, '= timerEscalationCancel');
  assert.equal(syncTimers(imported(xml), imported(xml)), null);
});

const c8 = (duration: string) => c7(duration)
  .replace('xmlns:camunda="http://camunda.org/schema/1.0/bpmn"', 'xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:modeler="http://camunda.org/schema/modeler/1.0" modeler:executionPlatform="Camunda Cloud"')
  .replace('${timerEscalationInform}', '=timerEscalationInform');

test('import from Camunda 8: =timerX is the same variable', () => {
  const s = imported(c8('=timerEscalationCancel'));
  assert.deepEqual(wait(s).timer, { kind: 'duration', expression: '= timerEscalationCancel' });
  // unverändert bleibt das Diagramm, wie es ist
  assert.match(writeBpmn(c8('=timerEscalationCancel'), { ...s, engine: 'c8' }).xml, />=timerEscalationCancel</);
});

test('a timer without value is an error - and the export says it keeps the old one', () => {
  const xml = c7('${timerEscalationCancel}');
  const s = imported(xml);
  wait(s).timer = { kind: 'duration', expression: '' };
  assert.ok(messages(s).some(m => m.startsWith('Timer ohne Wert')), messages(s).join(' / '));
  assert.ok(writeBpmn(xml, s).issues.some(i => i.where === 'Timer' && i.text.startsWith('ohne Wert')));
});

test('a date or cycle timer is a String in the InConfig', () => {
  const s = imported(c7('${timerEscalationCancel}'));
  wait(s).timer = { kind: 'date', expression: '= timerEscalationCancel', default: '2026-12-31T08:00:00Z' };
  assert.match(renderInConfig(s, new Set()), /timerEscalationCancel: String = "2026-12-31T08:00:00Z"/);
});

test('merge: another variable does not take over the default of the former one', () => {
  const prev = imported(c7('${timerEscalationCancel}'));
  wait(prev).timer = { ...wait(prev).timer!, default: 'P7D' };
  const renamed = mergeSpec(imported(c7('${timerOther}')), prev, imported(c7('${timerEscalationCancel}'))).spec;
  assert.equal(wait(renamed).timer?.expression, '= timerOther');
  assert.equal(wait(renamed).timer?.default, undefined);
});

test('open: a boundary timer is filled in too', () => {
  const xml = c7('${timerEscalationCancel}');
  const old = imported(xml);
  const approve = (s: ProcessSpec) => allSteps(s.steps).find(x => x.id === 'ApproveTask')!;
  for (const e of approve(old).errors ?? []) delete e.timer;
  const healed = syncTimers(old, imported(xml))!;
  assert.equal(approve(healed).errors?.find(e => e.code === 'inform')?.timer?.expression, '= timerEscalationInform');
});

test('the default must be ISO 8601 - otherwise the timer fails at runtime', () => {
  const s = imported(c7('${timerEscalationCancel}'));
  const warns = (d: string, kind: 'duration' | 'date' | 'cycle' = 'duration') => {
    wait(s).timer = { kind, expression: '= timerEscalationCancel', default: d };
    return messages(s).filter(m => m.includes('nach ISO 8601'));
  };
  assert.deepEqual(warns('P7D'), []);
  assert.equal(warns('PT7D').length, 1, 'days stand before the T');
  assert.deepEqual(warns('PT1.5S'), []);
  assert.equal(warns('7 days').length, 1);
  assert.equal(warns('P').length, 1);
  assert.deepEqual(warns('2026-12-31T08:00:00Z', 'date'), []);
  assert.equal(warns('31.12.2026', 'date').length, 1);
  assert.deepEqual(warns('R3/PT1H', 'cycle'), []);
  assert.equal(warns('PT1H', 'cycle').length, 1);
});

test('sync of an older spec without timer: the diagram brings it (keepSpecOwned)', () => {
  const xml = c7('${timerEscalationCancel}');
  const old = imported(xml);
  delete wait(old).timer;
  const merged = mergeSpec(imported(xml), old, imported(xml)).spec;
  assert.equal(wait(merged).timer?.expression, '= timerEscalationCancel');
});
