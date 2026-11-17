// A timer and a loop in a service orchestration: the timer waits (ZIO.sleep, a test makes it zero),
// a jump back makes the steps from its target a method that calls itself once more.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newCollection } from '../src/services/collection';
import { newOrchestration } from '../src/services/orchestration';
import { orchestrationFiles } from '../src/services/scalaOrchestration';
import { serviceStepIssues } from '../src/services/serviceMode';
import type { CollectionService, ServiceCollectionSpec, ServiceOrchestrationSpec } from '../src/services/types';
import type { Step, TypeDef } from '../src/types';

const t = (id: string, name: string, fields: Array<[string, string, boolean?]>, interactionId?: string): TypeDef =>
  ({ id, name, kind: 'case', ...(interactionId ? { interactionId } : {}), fields: fields.map(([n, type, optional]) => ({ id: `${id}-${n}`, name: n, type, ...(optional ? { optional: true } : {}) })) });
const svc = (id: string, name: string): CollectionService =>
  ({ id, name, api: 'file', apiVersion: 1, status: 'implemented', method: 'GET', path: '/files/{fileId}', params: [], inTypeId: `${id}-in`, outTypeId: `${id}-out` });
const collection = (): ServiceCollectionSpec => ({
  ...newCollection({ title: 'File', project: 'acme-crm', api: 'file', apiVersion: 1 }),
  types: [t('check-in', 'In', [['fileId', 'String']], 'check'), t('check-out', 'Out', [['isDone', 'Boolean']], 'check')],
  services: [svc('check', 'CheckStatus')],
});
const step = (id: string, kind: Step['kind'], more: Partial<Step> = {}): Step => ({ id, kind, name: id, status: 'draft', ...more } as Step);

function polling(): ServiceOrchestrationSpec {
  const o = newOrchestration({ title: 'Warten', project: 'acme-crm', api: 'file', apiVersion: 1, name: 'WaitForFile' });
  o.types.find(x => x.id === o.inTypeId)!.fields = [{ id: 'f', name: 'fileId', type: 'String' }];
  const steps: Step[] = [
    step('Start', 'start'),
    step('Again', 'gateway', { gatewayType: 'exclusive', name: 'Ab hier' }),
    step('Check', 'service', { topic: 'acme-crm-fileV1.CheckStatus' }),
    step('Done', 'gateway', {
      gatewayType: 'exclusive', branches: [
        { id: 'no', label: 'no', condition: '= not(isDone)', steps: [
          step('Max', 'gateway', { gatewayType: 'exclusive', branches: [
            { id: 'max', label: 'yes', condition: '= loopCounter >= 10', steps: [step('Failed', 'end')] },
            { id: 'go', label: 'no', isDefault: true, steps: [
              step('Wait', 'event', { eventKind: 'timer', timer: { kind: 'duration', expression: '= timerWaitForStatus', default: 'PT1M' } }),
              step('Back', 'goto', { gotoId: 'Again', back: true }),
            ] },
          ] }),
        ] },
        { id: 'yes', label: 'yes', isDefault: true, steps: [step('End', 'end')] },
      ],
    }),
  ];
  return {
    ...o, steps, conditions: {}, outMappings: [],
    tasks: { Check: { service: 'acme-crm-fileV1.CheckStatus', inputs: [{ name: 'fileId', expression: '= fileId' }], outputs: [{ name: 'isDone', expression: '= isDone', fromService: true }, { name: 'checks', expression: '= if checks != null then checks + 1 else 1' }] } },
  } as ServiceOrchestrationSpec;
}

test('a timer and a loop back: allowed in an orchestration; a forward jump or a date timer is not', () => {
  assert.deepEqual(serviceStepIssues(step('Wait', 'event', { eventKind: 'timer', timer: { kind: 'duration', expression: 'PT1M' } })), []);
  assert.deepEqual(serviceStepIssues(step('Back', 'goto', { gotoId: 'X', back: true })), []);
  assert.equal(serviceStepIssues(step('On', 'goto', { gotoId: 'X' }))[0]?.level, 'error');
  assert.equal(serviceStepIssues(step('Date', 'event', { eventKind: 'timer', timer: { kind: 'date', expression: '2026-01-01' } }))[0]?.level, 'error');
});

test('the loop: the steps from its target a method that calls itself once more - after the timer, with what it carries', () => {
  const files = orchestrationFiles(polling(), [collection()], null);
  const w = files.find(f => f.path.endsWith('/WaitForFileWorker.scala'))!.content;
  // runWorkZIO starts the loop with round 1, nothing carried yet
  assert.match(w, /out <- abHier\(1, in, None\)/, w);
  assert.match(w, /private def abHier\(loopCounter: Int, in: In, checksBefore: Option\[[^\]]+\]\): RunWorkZIOOutput\[Out\] =/, w);
  // the service in the loop, then the decision: done - the Out; not done - max or wait and once more
  assert.match(w, /checkStatus <- runCheckStatus\(/, w);
  assert.match(w, /if loopCounter >= 10 then/, w);
  assert.match(w, /_ <- ZIO\.sleep\(timerWaitForStatus\)\n\s+out <- abHier\(loopCounter \+ 1, in, Some\(checks\)\)/, w);
  // the timer: a method with its default
  assert.match(w, /protected def timerWaitForStatus: zio\.Duration = zio\.Duration\.fromJava\(java\.time\.Duration\.parse\("PT1M"\)\)/, w);
  // the test does not wait
  const tst = files.find(f => f.path.endsWith('/WaitForFileWorkerTest.scala'))!.content;
  assert.match(tst, /override protected def timerWaitForStatus: zio\.Duration = zio\.Duration\.Zero/, tst);
});

test('a timer with a duration as text: waits it, no method', () => {
  const o = polling();
  const wait = (((o.steps![3].branches![0].steps[0].branches![1].steps[0]) as Step));
  wait.timer = { kind: 'duration', expression: 'PT30S' };
  const w = orchestrationFiles(o, [collection()], null).find(f => f.path.endsWith('/WaitForFileWorker.scala'))!.content;
  assert.match(w, /_ <- ZIO\.sleep\(zio\.Duration\.fromJava\(java\.time\.Duration\.parse\("PT30S"\)\)\)/, w);
  assert.doesNotMatch(w, /protected def timer/);
});
