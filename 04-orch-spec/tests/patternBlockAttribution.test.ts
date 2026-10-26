// A pattern with a shared block is recognised by its path on the element (timer → link) - with
// free parameters (timer variable, link name) that fits every timer → link. The block behind the
// link must fit too: what its tasks call. Otherwise «Benutzer per Mail informieren» took the path
// and block of «Prozess-Event (Benutzeraufgabe)» as soon as that one did not match itself
// (e.g. after converting to Camunda 7, without its task listeners).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { detectPatterns } from '../src/patterns';
import type { PatternDef } from '../src/types';

const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser ??= DOMParser;
g.XMLSerializer ??= class { serializeToString(doc: { toString(): string }) { return doc.toString(); } };

const NS = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" '
  + 'xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" '
  + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:camunda="http://camunda.org/schema/1.0/bpmn"';

/** user task with timer → link, and the block behind the link: catch → `task` → end */
const withBlock = (timer: string, link: string, task: string, id = 'Diagram') => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} id="${id}" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="acme-demo" isExecutable="true">
    <bpmn:userTask id="PatternTarget" name="Aufgabe" />
    <bpmn:boundaryEvent id="Timer" cancelActivity="false" attachedToRef="PatternTarget">
      <bpmn:timerEventDefinition id="TimerDef"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">${timer}</bpmn:timeDuration></bpmn:timerEventDefinition>
      <bpmn:outgoing>TimerFlow</bpmn:outgoing>
    </bpmn:boundaryEvent>
    <bpmn:intermediateThrowEvent id="Throw" name="${link}">
      <bpmn:linkEventDefinition id="ThrowDef" name="${link}" />
      <bpmn:incoming>TimerFlow</bpmn:incoming>
    </bpmn:intermediateThrowEvent>
    <bpmn:intermediateCatchEvent id="Catch" name="${link}">
      <bpmn:linkEventDefinition id="CatchDef" name="${link}" />
      <bpmn:outgoing>CatchFlow</bpmn:outgoing>
    </bpmn:intermediateCatchEvent>
    ${task}
    <bpmn:endEvent id="End"><bpmn:incoming>WorkFlow</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="TimerFlow" sourceRef="Timer" targetRef="Throw" />
    <bpmn:sequenceFlow id="CatchFlow" sourceRef="Catch" targetRef="Work" />
    <bpmn:sequenceFlow id="WorkFlow" sourceRef="Work" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

const mailTask = '<bpmn:serviceTask id="Work" name="inform" camunda:type="external" camunda:topic="valiant-graviton-workV1.PostSendEmail">'
  + '<bpmn:extensionElements><camunda:inputOutput><camunda:inputParameter name="emailTemplate">{{emailTemplate}}</camunda:inputParameter></camunda:inputOutput></bpmn:extensionElements>'
  + '<bpmn:incoming>CatchFlow</bpmn:incoming><bpmn:outgoing>WorkFlow</bpmn:outgoing></bpmn:serviceTask>';
const callTask = (called: string) => `<bpmn:callActivity id="Work" name="Send Process Event" calledElement="${called}">`
  + '<bpmn:incoming>CatchFlow</bpmn:incoming><bpmn:outgoing>WorkFlow</bpmn:outgoing></bpmn:callActivity>';

// «Benutzer per Mail informieren»: timer and link are free parameters, the block calls the mail service
const inform = { id: 'inform-user', name: 'Benutzer per Mail informieren', appliesTo: ['userTask'],
  bpmn: { c7: withBlock('${{{informTimer}}}', '{{informLink}}', mailTask, 'PatternDefinitions').replace('id="acme-demo"', 'id="PatternProcess"').replace('name="Aufgabe"', 'name="Element mit dem Pattern"') } } as unknown as PatternDef;

const ids = (xml: string) => {
  const d = detectPatterns(xml, [inform], 'c7');
  return { hits: d.hits.map(h => `${h.patternId}@${h.targetId}`), owned: [...d.owned].filter(([, p]) => p === 'inform-user').map(([id]) => id).sort() };
};

test('the mail pattern is recognised where its block sends the mail', () => {
  const r = ids(withBlock('${timerInformKube}', 'acme-informKube', mailTask.replace('{{emailTemplate}}', 'mailtemplate-activity')));
  assert.deepEqual(r.hits, ['inform-user@PatternTarget']);
  assert.deepEqual(r.owned, ['Catch', 'CatchFlow', 'End', 'Throw', 'Timer', 'TimerFlow', 'Work', 'WorkFlow']);
});

test('a timer → link whose block calls something else is not the mail pattern', () => {
  const r = ids(withBlock('${timerSendProcessEvent}', 'send-process-event', callTask('valiant-bpmn-sendProcessEvent')));
  assert.deepEqual(r, { hits: [], owned: [] });
});

test('the same kind of task calling something else does not fit either', () => {
  const other = mailTask.replace('valiant-graviton-workV1.PostSendEmail', 'acme-other-topic');
  assert.deepEqual(ids(withBlock('${timerX}', 'x-link', other)), { hits: [], owned: [] });
});

test('without the block in the diagram the path alone still counts - as before', () => {
  const xml = withBlock('${timerInformKube}', 'acme-informKube', mailTask)
    .replace(/<bpmn:intermediateCatchEvent[\s\S]*?<\/bpmn:intermediateCatchEvent>/, '')
    .replace(/<bpmn:serviceTask[\s\S]*?<\/bpmn:serviceTask>/, '')
    .replace(/<bpmn:endEvent[\s\S]*?<\/bpmn:endEvent>/, '')
    .replace(/<bpmn:sequenceFlow id="(CatchFlow|WorkFlow)"[^>]*\/>/g, '');
  assert.deepEqual(ids(xml).hits, ['inform-user@PatternTarget']);
});

test('the block may differ in its mappings - one field more or less', () => {
  const fewer = mailTask.replace(/<bpmn:extensionElements>[\s\S]*?<\/bpmn:extensionElements>/, '');
  assert.deepEqual(ids(withBlock('${timerInformKube}', 'acme-informKube', fewer)).hits, ['inform-user@PatternTarget']);
});
