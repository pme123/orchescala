// Der Timer eines Ereignisses: welche Variable er liest — sie ist eine Konstante im InConfig.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { allSteps, importBpmn, mergeSpec, syncTimers } from '../src/bpmn';
import { writeBpmn } from '../src/bpmnWrite';
import { collectFindings } from '../src/findings';
import { loopSettings } from '../src/interactions';
import { renderInConfig } from '../src/scala';
import type { ErrorHandling, ProcessSpec, Step } from '../src/types';

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

// ── Timer an Boundary-Events ────────────────────────────────────────────────
const approve = (s: ProcessSpec): Step => allSteps(s.steps).find(x => x.id === 'ApproveTask')!;
const inform = (s: ProcessSpec) => approve(s).errors!.find(e => e.code === 'inform')!;
const withInform = (xml: string, expr: string) => xml.replace('${timerEscalationInform}', expr);

test('boundary: the import keeps the id of the boundary event', () => {
  assert.equal(inform(imported(c7('P7D'))).boundaryId, 'InformBoundary');
});

test('boundary merge: the default stays for the same variable - not for another one', () => {
  const xml = c7('P7D');
  const prev = imported(xml);
  inform(prev).timer = { ...inform(prev).timer!, default: 'P3D' };
  assert.equal(inform(mergeSpec(imported(xml), prev).spec).timer?.default, 'P3D');
  assert.equal(inform(mergeSpec(imported(xml), prev, imported(xml)).spec).timer?.default, 'P3D');
  const renamed = mergeSpec(imported(withInform(xml, '${timerOther}')), prev, imported(xml)).spec;
  assert.deepEqual(inform(renamed).timer, { kind: 'duration', expression: '= timerOther' });
  // eine andere Art (Zeitpunkt statt Dauer) hat ihre eigene Vorgabe
  const date = mergeSpec(imported(xml.replace(/timeDuration xsi:type="bpmn:tFormalExpression">\$\{timerEscalationInform\}<\/bpmn:timeDuration/,
    'timeDate xsi:type="bpmn:tFormalExpression">${timerEscalationInform}</bpmn:timeDate')), prev, imported(xml)).spec;
  assert.equal(inform(date).timer?.kind, 'date');
  assert.equal(inform(date).timer?.default, undefined);
});

test('boundary merge: an edit in the spec stays while the diagram has not changed the timer', () => {
  const xml = c7('P7D');
  const prev = imported(xml);
  inform(prev).timer = { kind: 'duration', expression: '= timerInformLater', default: 'P2D' };
  assert.deepEqual(inform(mergeSpec(imported(xml), prev, imported(xml)).spec).timer, inform(prev).timer);
  // hat das Diagramm ihn geändert, gilt das Diagramm
  const changed = mergeSpec(imported(withInform(xml, '${timerOther}')), prev, imported(xml)).spec;
  assert.equal(inform(changed).timer?.expression, '= timerOther');
});

test('boundary open: a spec with the timer but without the boundary id gets the id', () => {
  const xml = c7('P7D');
  const old = imported(xml);
  inform(old).timer = { ...inform(old).timer!, default: 'P3D' };
  delete inform(old).boundaryId;
  const healed = syncTimers(old, imported(xml))!;
  assert.equal(inform(healed).boundaryId, 'InformBoundary');
  assert.equal(inform(healed).timer?.default, 'P3D');
});

test('boundary export: a changed timer is written per engine - unchanged and fixed text stay as they are', () => {
  const xml = c7('P7D');
  const s = imported(xml);
  inform(s).timer = { kind: 'duration', expression: '= timerInformLater', default: 'P2D' };
  const out = writeBpmn(xml, s).xml;
  assert.match(out, /<bpmn:timeDuration xsi:type="bpmn:tFormalExpression">\$\{timerInformLater\}<\/bpmn:timeDuration>/);
  // der Timer des Ereignisses bleibt dabei unberührt
  assert.match(out, />P7D<\/bpmn:timeDuration>/);
  assert.match(writeBpmn(xml, { ...s, engine: 'c8' }).xml, /<bpmn:timeDuration xsi:type="bpmn:tFormalExpression">=timerInformLater<\/bpmn:timeDuration>/);
  // ein fester Wert bleibt Text, eine andere Art ein anderes Element
  inform(s).timer = { kind: 'cycle', expression: 'R3/PT1H' };
  assert.match(writeBpmn(xml, s).xml, /<bpmn:timeCycle xsi:type="bpmn:tFormalExpression">R3\/PT1H<\/bpmn:timeCycle>\s*<\/bpmn:timerEventDefinition>\s*<\/bpmn:boundaryEvent>/);
  assert.match(writeBpmn(xml, { ...s, engine: 'c8' }).xml, />R3\/PT1H<\/bpmn:timeCycle>/);
  // unverändert bleibt das Diagramm, wie es ist — auch in der Schreibweise von Camunda 8
  assert.match(writeBpmn(xml, imported(xml)).xml, />\$\{timerEscalationInform\}</);
  assert.match(writeBpmn(c8('P7D'), { ...imported(c8('P7D')), engine: 'c8' }).xml, />=timerEscalationInform</);
});

test('boundary export: without the boundary id the element is found by its name; without value it says so', () => {
  const xml = c7('P7D');
  const s = imported(xml);
  inform(s).timer = { kind: 'duration', expression: '= timerInformLater' };
  delete inform(s).boundaryId;
  assert.match(writeBpmn(xml, s).xml, /\$\{timerInformLater\}/);
  inform(s).timer = { kind: 'duration', expression: '' };
  const r = writeBpmn(xml, s);
  assert.ok(r.issues.some(i => i.where === 'Timer «inform»' && i.text.startsWith('ohne Wert')), JSON.stringify(r.issues));
  assert.match(r.xml, /\$\{timerEscalationInform\}/);
});

test('boundary findings: no value is an error; a fixed value, a missing and an invalid default are warnings', () => {
  const s = imported(c7('${timerEscalationCancel}'));
  wait(s).timer = { ...wait(s).timer!, default: 'P7D' };
  const at = (t: NonNullable<ErrorHandling['timer']>) => {
    inform(s).timer = t;
    const f = collectFindings(s, null, allSteps(s.steps)).get('ApproveTask');
    return { errors: f?.errors ?? [], warnings: (f?.warnings ?? []).filter(w => w.startsWith('Boundary «inform»: ')) };
  };
  assert.ok(at({ kind: 'duration', expression: '' }).errors.includes('Boundary «inform»: Timer ohne Wert — eine Variable aus dem InConfig setzen, z. B. = timerWait.'));
  assert.ok(at({ kind: 'duration', expression: 'P2D' }).warnings[0]?.startsWith('Boundary «inform»: Fester Timer «P2D»'));
  assert.ok(at({ kind: 'duration', expression: '= timerEscalationInform' }).warnings[0]?.includes('«timerEscalationInform» ohne Vorgabe'));
  assert.ok(at({ kind: 'duration', expression: '= timerEscalationInform', default: 'PT2D' }).warnings[0]?.includes('nach ISO 8601'));
  assert.deepEqual(at({ kind: 'duration', expression: '= timerEscalationInform', default: 'P2D' }), { errors: [], warnings: [] });
});

test('boundary export: a boundary id that does not fit is reported - no fallback to another boundary by name', () => {
  const xml = c7('P7D');
  const s = imported(xml);
  inform(s).timer = { kind: 'duration', expression: '= timerInformLater' };
  inform(s).boundaryId = 'Wait7DaysEvent';
  const r = writeBpmn(xml, s);
  assert.doesNotMatch(r.xml, /timerInformLater/);
  assert.ok(r.issues.some(i => i.where === 'Timer «inform»' && i.text.includes('hängt nicht (mehr) an diesem Schritt')), JSON.stringify(r.issues));
});
