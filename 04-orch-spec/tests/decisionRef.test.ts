// A DMN decision in the package of the process whose decisionRef does not start
// with the process ID (`valiant-bpmn-map-actions` in `valiant-bpmn-sendProcessEvent`):
// it still belongs to the process — the sync matches it to the step.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { allSteps, importBpmn } from '../src/bpmn';
import { scanScala } from '../src/domainScan';
import { collectFindings } from '../src/findings';
import { enrichSpec } from '../src/projectImport';
import { foreignOrigin } from '../src/interactions';
import type { Step } from '../src/types';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;

const PID = 'acme-demo-sendEvent';
const PKG = 'acme.demo.domain.sendEvent.v1';
const DECISION = 'acme-demo-map-actions';

const bpmn = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="d" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="${PID}" name="${PID}" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:businessRuleTask id="GetActionTask" name="get action" camunda:decisionRef="${DECISION}" camunda:resultVariable="action" camunda:mapDecisionResult="singleResult">
      <bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing>
    </bpmn:businessRuleTask>
    <bpmn:endEvent id="EndEvent"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="GetActionTask"/>
    <bpmn:sequenceFlow id="f2" sourceRef="GetActionTask" targetRef="EndEvent"/>
  </bpmn:process>
</bpmn:definitions>`;

const processSource = `package ${PKG}

object SendEvent extends CompanyBpmnProcessDsl:
  val processName = "${PID}"
  val descr: String = ""

  case class In(subStatusKey: String)
  object In:
    lazy val example = In("x")
  end In

  lazy val example = process(In.example, NoOutput())
end SendEvent
`;

const decisionSource = (decisionId: string) => `package ${PKG}

object MapActionsDmn extends CompanyBpmnDecisionDsl:
  val decisionId = "${decisionId}"
  val descr: String = "Gets the actions for a subStatusKey."

  case class In(subStatusKey: String)
  object In:
    lazy val example = In("x")
  end In

  case class Out(subStatusId: String)
  object Out:
    lazy val example = Out("y")
  end Out

  lazy val example = singleResult(In.example, Out.example)
end MapActionsDmn
`;

const enriched = (decisionId = DECISION) => {
  const domain = [...scanScala(processSource, 'SendEvent.scala'), ...scanScala(decisionSource(decisionId), 'MapActionsDmn.scala')];
  return enrichSpec({ ...importBpmn(bpmn, 'send-event').spec, project: 'acme-demo' }, domain, null)!;
};

test('a decision of the own package is matched although its decisionRef lacks the process id', () => {
  const r = enriched();
  assert.deepEqual(r.matched, ['MapActionsDmn']);
  assert.deepEqual(r.unmatched, []);
  const ia = (r.spec.interactions ?? []).find(i => i.stepId === 'GetActionTask');
  assert.equal(ia?.kind, 'decision');
  assert.equal(ia?.key, DECISION);
  assert.ok(ia?.inTypeId && ia.outTypeId);
});

test('a matched decision without process id is no foreign service', () => {
  const s = enriched().spec;
  const found = [...collectFindings(s, { services: [{ id: 'other', name: 'other' }] } as never, allSteps(s.steps)).values()]
    .flatMap(f => [...f.errors, ...f.warnings]);
  assert.deepEqual(found.filter(m => m.includes('nicht im Katalog')), []);
});

test('a rule step with another decisionRef stays unmatched', () => {
  const r = enriched('acme-demo-other');
  assert.deepEqual(r.matched, []);
  assert.deepEqual(r.unmatched, ['MapActionsDmn']);
});

test('a foreign decision shows where it comes from - domain object, package and project', () => {
  const domain = scanScala(decisionSource('acme-demo-subStatus-all'), 'MapActionsDmn.scala')
    .map(t => ({ ...t, pkg: 'acme.demo.domain.subStatusAll.v1' }));
  const step = { id: 'S', name: 'all', kind: 'rule', topic: 'acme-demo-subStatus-all' } as Step;
  assert.deepEqual(foreignOrigin(step, { domainTypes: domain } as never),
    { object: 'MapActionsDmn', pkg: 'acme.demo.domain.subStatusAll.v1', project: 'acme-demo' });
  assert.equal(foreignOrigin({ ...step, topic: 'acme-demo-unknown' }, { domainTypes: domain } as never), null);
});
