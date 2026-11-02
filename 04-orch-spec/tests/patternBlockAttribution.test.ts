// A pattern with a shared block is recognised by its path on the element (timer → link) - with
// free parameters (timer variable, link name) that fits every timer → link. The block behind the
// link must fit too: what its tasks call. Otherwise «Benutzer per Mail informieren» took the path
// and block of «Prozess-Event (Benutzeraufgabe)» as soon as that one did not match itself
// (e.g. after converting to Camunda 7, without its task listeners).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { detectPatterns } from '../src/patterns';
import type { EngineId, PatternDef } from '../src/types';

const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser ??= DOMParser;
g.XMLSerializer ??= class { serializeToString(doc: { toString(): string }) { return doc.toString(); } };

const NS = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
  + 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"';
const doc = (body: string, id = 'acme-demo') => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} id="Defs" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="${id}" isExecutable="true">
${body}
  </bpmn:process>
</bpmn:definitions>`;

// ── building blocks ──────────────────────────────────────────────────────────
const userTask = (id: string, ext = '') => `<bpmn:userTask id="${id}" name="${id}">${ext ? `<bpmn:extensionElements>${ext}</bpmn:extensionElements>` : ''}</bpmn:userTask>`;
/** timer on `task` → link throw */
const timerPath = (id: string, task: string, timer: string, link: string) => `
<bpmn:boundaryEvent id="${id}" cancelActivity="false" attachedToRef="${task}">
  <bpmn:timerEventDefinition id="${id}Def"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">${timer}</bpmn:timeDuration></bpmn:timerEventDefinition>
</bpmn:boundaryEvent>
<bpmn:intermediateThrowEvent id="${id}Throw" name="${link}"><bpmn:linkEventDefinition id="${id}ThrowDef" name="${link}" /></bpmn:intermediateThrowEvent>
<bpmn:sequenceFlow id="${id}Flow" sourceRef="${id}" targetRef="${id}Throw" />`;
/** link catch → `work` (a task with id `${prefix}Work`) → end */
const linkBlock = (prefix: string, link: string, work: string) => `
<bpmn:intermediateCatchEvent id="${prefix}Catch" name="${link}"><bpmn:linkEventDefinition id="${prefix}CatchDef" name="${link}" /></bpmn:intermediateCatchEvent>
${work}
<bpmn:endEvent id="${prefix}End" />
<bpmn:sequenceFlow id="${prefix}CatchFlow" sourceRef="${prefix}Catch" targetRef="${prefix}Work" />
<bpmn:sequenceFlow id="${prefix}WorkFlow" sourceRef="${prefix}Work" targetRef="${prefix}End" />`;

const mailC7 = (prefix: string, topic = 'acme-graviton-workV1.PostSendEmail', ext = '') =>
  `<bpmn:serviceTask id="${prefix}Work" camunda:type="external" camunda:topic="${topic}">${ext}</bpmn:serviceTask>`;
const mailC8 = (prefix: string, type = 'acme-graviton-workV1.PostSendEmail') =>
  `<bpmn:serviceTask id="${prefix}Work" zeebe:modelerTemplate="acme-graviton-workV1.PostSendEmail"><bpmn:extensionElements><zeebe:taskDefinition type="${type}" /></bpmn:extensionElements></bpmn:serviceTask>`;
const callC7 = (prefix: string, called = 'acme-bpmn-sendProcessEvent') => `<bpmn:callActivity id="${prefix}Work" calledElement="${called}" />`;
const listenerUt = '<camunda:taskListener event="create"><camunda:script scriptFormat="groovy" resource="acme-bpmn:scripts/sendProcessEvent/taskListener.groovy" /></camunda:taskListener>';

/** a pattern on a user task: its path and its block, as the admin stores it */
const onTask = (id: string, engine: EngineId, anchorExt: string, timer: string, link: string, work: (p: string) => string): PatternDef => ({
  id, name: id, appliesTo: ['userTask'],
  bpmn: { [engine]: doc(userTask('PatternTarget', anchorExt) + timerPath('T', 'PatternTarget', timer, link) + linkBlock('B', link, work('B')), 'PatternProcess') },
}) as unknown as PatternDef;

const inform = onTask('inform-user', 'c7', '', '${{{informTimer}}}', '{{informLink}}', p => mailC7(p));
const informC8 = onTask('inform-user', 'c8', '', '={{informTimer}}', '{{informLink}}-{{targetId}}', p => mailC8(p));
const processEvent = onTask('send-process-event-ut', 'c7', listenerUt, '${timerSendProcessEvent}', 'send-process-event', p => callC7(p));

const detect = (xml: string, defs: PatternDef[], engine: EngineId = 'c7') => {
  const d = detectPatterns(xml, defs, engine);
  const owned = (id: string) => [...d.owned].filter(([, p]) => p === id).map(([e]) => e).sort();
  return { hits: d.hits.map(h => `${h.patternId}@${h.targetId}`).sort(), owned };
};

// ── the mail pattern alone ───────────────────────────────────────────────────
test('the mail pattern is recognised where its block sends the mail', () => {
  const r = detect(doc(userTask('Task') + timerPath('Inform', 'Task', '${timerInformKube}', 'acme-informKube') + linkBlock('Mail', 'acme-informKube', mailC7('Mail'))), [inform]);
  assert.deepEqual(r.hits, ['inform-user@Task']);
  assert.deepEqual(r.owned('inform-user'), ['Inform', 'InformFlow', 'InformThrow', 'MailCatch', 'MailCatchFlow', 'MailEnd', 'MailWork', 'MailWorkFlow']);
});

test('a timer → link whose block calls something else is not the mail pattern', () => {
  const r = detect(doc(userTask('Task') + timerPath('Send', 'Task', '${timerSendProcessEvent}', 'send-process-event') + linkBlock('Spe', 'send-process-event', callC7('Spe'))), [inform]);
  assert.deepEqual(r.hits, []);
  assert.deepEqual(r.owned('inform-user'), []);
});

test('the same kind of task calling something else does not fit either', () => {
  const r = detect(doc(userTask('Task') + timerPath('X', 'Task', '${timerX}', 'x-link') + linkBlock('X', 'x-link', mailC7('X', 'acme-other-topic'))), [inform]);
  assert.deepEqual(r.hits, []);
});

test('without the block in the diagram the path alone still counts - as before', () => {
  const r = detect(doc(userTask('Task') + timerPath('Inform', 'Task', '${timerInformKube}', 'acme-informKube')), [inform]);
  assert.deepEqual(r.hits, ['inform-user@Task']);
});

test('the block may differ in its mappings - one field more or less', () => {
  const more = '<bpmn:extensionElements><camunda:inputOutput><camunda:inputParameter name="emailSubject">Hallo</camunda:inputParameter></camunda:inputOutput></bpmn:extensionElements>';
  const r = detect(doc(userTask('Task') + timerPath('Inform', 'Task', '${timerInformKube}', 'acme-informKube') + linkBlock('Mail', 'acme-informKube', mailC7('Mail', undefined, more))), [inform]);
  assert.deepEqual(r.hits, ['inform-user@Task']);
});

// ── next to the process event: the reported case ─────────────────────────────
const bothPaths = (ext: string) => doc(userTask('Task', ext)
  + timerPath('Send', 'Task', '${timerSendProcessEvent}', 'send-process-event') + linkBlock('Spe', 'send-process-event', callC7('Spe'))
  + timerPath('Inform', 'Task', '${timerInformKube}', 'acme-informKube') + linkBlock('Mail', 'acme-informKube', mailC7('Mail')));

test('next to the process event each pattern keeps its own path and block', () => {
  const r = detect(bothPaths(listenerUt), [processEvent, inform]);
  assert.deepEqual(r.hits, ['inform-user@Task', 'send-process-event-ut@Task']);
  assert.deepEqual(r.owned('send-process-event-ut'), ['Send', 'SendFlow', 'SendThrow', 'SpeCatch', 'SpeCatchFlow', 'SpeEnd', 'SpeWork', 'SpeWorkFlow']);
  assert.deepEqual(r.owned('inform-user'), ['Inform', 'InformFlow', 'InformThrow', 'MailCatch', 'MailCatchFlow', 'MailEnd', 'MailWork', 'MailWorkFlow']);
});

test('without its task listener (converted to Camunda 7) the process event is not recognised - and not taken for a mail', () => {
  const r = detect(bothPaths(''), [processEvent, inform]);
  assert.deepEqual(r.hits, ['inform-user@Task']);
  // the mail keeps only its own path; the process event's path stays unassigned
  assert.deepEqual(r.owned('inform-user'), ['Inform', 'InformFlow', 'InformThrow', 'MailCatch', 'MailCatchFlow', 'MailEnd', 'MailWork', 'MailWorkFlow']);
});

test('after a rejected path the next path on the same element is still tried', () => {
  // the process event's path comes first in the diagram - the mail pattern skips it and finds its own
  const r = detect(bothPaths(''), [inform]);
  assert.deepEqual(r.hits, ['inform-user@Task']);
  assert.ok(!r.owned('inform-user').includes('Send'));
});

// ── binding, tasks without calls, Camunda 8, event subprocess ────────────────
test('a placeholder in path and block must have the same value', () => {
  const p = onTask('same-name', 'c7', '', '${{{svc}}}', '{{svc}}-link', x => mailC7(x, '{{svc}}'));
  const same = detect(doc(userTask('Task') + timerPath('A', 'Task', '${acme}', 'acme-link') + linkBlock('A', 'acme-link', mailC7('A', 'acme'))), [p]);
  assert.deepEqual(same.hits, ['same-name@Task']);
  const other = detect(doc(userTask('Task') + timerPath('A', 'Task', '${acme}', 'acme-link') + linkBlock('A', 'acme-link', mailC7('A', 'other'))), [p]);
  assert.deepEqual(other.hits, []);
});

test('a task of the pattern that calls nothing fits every task of its kind - nothing to tell them apart', () => {
  const p = onTask('bare', 'c7', '', '${timerBare}', 'bare-link', x => `<bpmn:serviceTask id="${x}Work" />`);
  const r = detect(doc(userTask('Task') + timerPath('A', 'Task', '${timerBare}', 'bare-link') + linkBlock('A', 'bare-link', mailC7('A', 'anything'))), [p]);
  assert.deepEqual(r.hits, ['bare@Task']);
  // but not a task of another kind
  const call = detect(doc(userTask('Task') + timerPath('A', 'Task', '${timerBare}', 'bare-link') + linkBlock('A', 'bare-link', callC7('A'))), [p]);
  assert.deepEqual(call.hits, []);
});

test('Camunda 8: the job type of the block decides', () => {
  const c8Task = userTask('Task', '<zeebe:userTask />');
  const mail = detect(doc(c8Task + timerPath('I', 'Task', '=timerInformKube', 'acme-informKube-Task') + linkBlock('M', 'acme-informKube-Task', mailC8('M'))), [informC8], 'c8');
  assert.deepEqual(mail.hits, ['inform-user@Task']);
  const other = detect(doc(c8Task + timerPath('I', 'Task', '=timerInformKube', 'acme-informKube-Task') + linkBlock('M', 'acme-informKube-Task', mailC8('M', 'acme-other-type'))), [informC8], 'c8');
  assert.deepEqual(other.hits, []);
});

test('the calls are compared engine-neutrally - a topic matches the same job type', () => {
  // a Camunda 8 pattern on a block that only names its topic the Camunda 7 way
  const c8Task = userTask('Task', '<zeebe:userTask />');
  const mixed = `<bpmn:serviceTask id="MWork" zeebe:modelerTemplate="acme-graviton-workV1.PostSendEmail" camunda:topic="acme-graviton-workV1.PostSendEmail" />`;
  const r = detect(doc(c8Task + timerPath('I', 'Task', '=timerInformKube', 'acme-informKube-Task') + linkBlock('M', 'acme-informKube-Task', mixed)), [informC8], 'c8');
  assert.deepEqual(r.hits, ['inform-user@Task']);
});

test('an event subprocess block is defined by its start - its content may differ', () => {
  const esp = (inner: string) => `<bpmn:subProcess id="Esp" triggeredByEvent="true">
    <bpmn:startEvent id="EspStart" isInterrupting="false"><bpmn:messageEventDefinition id="EspStartDef" messageRef="Msg" /></bpmn:startEvent>
    ${inner}
  </bpmn:subProcess>`;
  const withMsg = (x: string) => x.replace('</bpmn:definitions>', '<bpmn:message id="Msg" name="acme-start" />\n</bpmn:definitions>');
  const p = { id: 'unique', name: 'unique', appliesTo: ['process'],
    bpmn: { c7: withMsg(doc(esp('<bpmn:endEvent id="EspEnd" /><bpmn:sequenceFlow id="EspFlow" sourceRef="EspStart" targetRef="EspEnd" />'), 'PatternProcess')) } } as unknown as PatternDef;
  const other = '<bpmn:serviceTask id="EspWork" camunda:topic="acme-anything" /><bpmn:endEvent id="EspEnd" />'
    + '<bpmn:sequenceFlow id="EspFlow1" sourceRef="EspStart" targetRef="EspWork" /><bpmn:sequenceFlow id="EspFlow2" sourceRef="EspWork" targetRef="EspEnd" />';
  const r = detect(withMsg(doc(esp(other))), [p]);
  assert.deepEqual(r.hits, ['unique@null']);
});

test('a placeholder first bound in the block must keep its value in the next task', () => {
  // catch → service task with topic {{svc}} → call activity of process {{svc}} → end
  const twoTasks = (prefix: string, link: string, topic: string, called: string) => `
<bpmn:intermediateCatchEvent id="${prefix}Catch"><bpmn:linkEventDefinition id="${prefix}CatchDef" name="${link}" /></bpmn:intermediateCatchEvent>
<bpmn:serviceTask id="${prefix}Svc" camunda:type="external" camunda:topic="${topic}" />
<bpmn:callActivity id="${prefix}Call" calledElement="${called}" />
<bpmn:endEvent id="${prefix}End" />
<bpmn:sequenceFlow id="${prefix}F1" sourceRef="${prefix}Catch" targetRef="${prefix}Svc" />
<bpmn:sequenceFlow id="${prefix}F2" sourceRef="${prefix}Svc" targetRef="${prefix}Call" />
<bpmn:sequenceFlow id="${prefix}F3" sourceRef="${prefix}Call" targetRef="${prefix}End" />`;
  const p = { id: 'two', name: 'two', appliesTo: ['userTask'],
    bpmn: { c7: doc(userTask('PatternTarget') + timerPath('T', 'PatternTarget', '${timerTwo}', 'two-link') + twoTasks('B', 'two-link', '{{svc}}', '{{svc}}'), 'PatternProcess') } } as unknown as PatternDef;
  const path = userTask('Task') + timerPath('A', 'Task', '${timerTwo}', 'two-link');
  assert.deepEqual(detect(doc(path + twoTasks('A', 'two-link', 'acme', 'acme')), [p]).hits, ['two@Task']);
  assert.deepEqual(detect(doc(path + twoTasks('A', 'two-link', 'acme', 'other')), [p]).hits, []);
});

test('two tasks of the same kind: a first choice that binds wrongly is undone', () => {
  // the pattern: service task {{a}}, then service task "acme-fixed" with template {{a}};
  // the diagram lists the tasks the other way round - the first pick for {{a}} must be revised
  const block = (prefix: string, link: string, t1: string, t2: string) => `
<bpmn:intermediateCatchEvent id="${prefix}Catch"><bpmn:linkEventDefinition id="${prefix}CatchDef" name="${link}" /></bpmn:intermediateCatchEvent>
${t1}${t2}
<bpmn:endEvent id="${prefix}End" />
<bpmn:sequenceFlow id="${prefix}F1" sourceRef="${prefix}Catch" targetRef="${prefix}S1" />
<bpmn:sequenceFlow id="${prefix}F2" sourceRef="${prefix}S1" targetRef="${prefix}S2" />
<bpmn:sequenceFlow id="${prefix}F3" sourceRef="${prefix}S2" targetRef="${prefix}End" />`;
  const svc = (id: string, topic: string, template?: string) => `<bpmn:serviceTask id="${id}" camunda:topic="${topic}"${template ? ` camunda:modelerTemplate="${template}"` : ''} />`;
  const p = { id: 'pair', name: 'pair', appliesTo: ['userTask'],
    bpmn: { c7: doc(userTask('PatternTarget') + timerPath('T', 'PatternTarget', '${timerPair}', 'pair-link')
      + block('B', 'pair-link', svc('BS1', '{{a}}'), svc('BS2', 'acme-fixed', '{{a}}')), 'PatternProcess') } } as unknown as PatternDef;
  // diagram: first the fixed one (template acme-x), then acme-x - a greedy pick binds a = acme-fixed
  const xml = doc(userTask('Task') + timerPath('A', 'Task', '${timerPair}', 'pair-link')
    + block('A', 'pair-link', svc('AS1', 'acme-fixed', 'acme-x'), svc('AS2', 'acme-x')));
  assert.deepEqual(detect(xml, [p]).hits, ['pair@Task']);
});
