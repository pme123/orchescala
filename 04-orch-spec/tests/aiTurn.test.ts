// The turn on the studio (E28, step 5) - without network: the request as orch-spec sends it, the tools
// of the task, the same draft as the loop on its own (runTurn), the limits of the skill, and the client in
// orch-spec that reads the lines of the answer.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { DOMParser } from 'linkedom';
import {
  allSteps, importBpmn, installNodeDom, outcomeOf, pageSystem, pageToolKit, parseTurnLine, processToolKit, runTurn,
  serverTurn, startDraft, startProcessDraft, targetsOf, turnError, turnKit, turnPath, turnRequest,
  type AgentEvent, type Model, type Page, type PageDraft, type ProcessDraft, type ProcessSpec, type Send, type TurnLine,
} from '../src/core';
import { errorText, turnOnStudio } from '../src/ai/client';

installNodeDom(DOMParser);

const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 };
const message = (content: unknown[], stop_reason: string): BetaMessage =>
  ({ id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason, usage } as unknown as BetaMessage);
const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input });
const text = (t: string) => ({ type: 'text', text: t });
/** Claude answers by the number of its answers so far - the same on every run */
const scripted = (answers: BetaMessage[]): Send => async (r) => {
  const next = answers[r.messages.filter((m) => m.role === 'assistant').length];
  if (!next) throw new Error('no more answers');
  return next;
};
/** what crosses the wire - JSON, nothing else */
const wire = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
/** a new block gets a random id (withIds) - on the studio as in runTurn, so two runs differ only there */
const sameIds = (v: unknown) => JSON.parse(JSON.stringify(v).replace(/\bb-[0-9a-f]{10}\b/g, 'b-new')) as unknown;

const book: Page = {
  path: 'shop/book', title: 'Termin buchen', access: 'public', state: { contact: {} },
  body: [
    { type: 'heading', text: 'Termin buchen' },
    { type: 'section', label: 'Kontakt', body: [{ type: 'fields', fields: [{ bind: 'contact.name', label: 'Name', required: true }] }] },
    { type: 'button', label: 'Buchen', actions: [] },
  ],
};
const targets = targetsOf({ version: 1, services: [], domainTypes: [] } as unknown as Model, []);
const others = [{ slug: 'book', page: book }];
const system = pageSystem('type Page = …', targets, others, { title: 'Shop' });
const pageAnswers = [
  message([toolUse('t1', 'read_page', {})], 'tool_use'),
  message([text('Ich füge das Feld ein.'), toolUse('t2', 'insert_block', { block: { type: 'fields', fields: [{ bind: 'contact.branch', label: 'Filiale' }] }, at: '1', place: 'inside' })], 'tool_use'),
  message([text('Das Feld «Filiale» ist im Abschnitt Kontakt.')], 'end_turn'),
];

test('the same request gives the same draft - on the studio as with the loop on its own, also after the wire', async () => {
  const prompt = 'Nimm ein Feld für die Filiale auf.';
  const draft = startDraft('book', book);
  const here = await runTurn({ send: scripted(pageAnswers), system, kit: pageToolKit({ targets, others }), history: [], prompt, draft });
  const body = wire({ context: { targets, others }, system, history: [], prompt, draft });
  const req = turnRequest('uiCreator', body);
  assert.ok(typeof req !== 'string', String(req));
  const events: AgentEvent[] = [];
  const there = wire(outcomeOf(await serverTurn(req, { send: scripted(pageAnswers), onEvent: (e) => events.push(e) })));
  assert.equal(there.stop, 'done');
  assert.deepEqual(sameIds(there.draft), sameIds(here.draft));
  assert.deepEqual(sameIds(there.history), sameIds(here.history));
  assert.deepEqual([there.text, there.errors, there.usage], [here.text, here.errors, here.usage]);
  assert.deepEqual(events.map((e) => e.kind), ['usage', 'tool', 'usage', 'text', 'tool', 'usage', 'text']);
});

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="d" targetNamespace="x">
  <bpmn:process id="acme-crm-changeAddressV1" name="Adresse ändern" isExecutable="true">
    <bpmn:startEvent id="StartProcessStartEvent" name="Adresse erfasst"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="CheckAddressTask" name="Adresse prüfen"><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:userTask>
    <bpmn:endEvent id="ChangedEndEvent" name="geändert"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartProcessStartEvent" targetRef="CheckAddressTask" />
    <bpmn:sequenceFlow id="f2" sourceRef="CheckAddressTask" targetRef="ChangedEndEvent" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="dia"><bpmndi:BPMNPlane id="plane" bpmnElement="acme-crm-changeAddressV1">
    <bpmndi:BPMNShape id="s0" bpmnElement="StartProcessStartEvent"><dc:Bounds x="100" y="100" width="36" height="36" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="s1" bpmnElement="CheckAddressTask"><dc:Bounds x="190" y="78" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="s2" bpmnElement="ChangedEndEvent"><dc:Bounds x="350" y="100" width="36" height="36" /></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge id="e1" bpmnElement="f1"><di:waypoint x="136" y="118" /><di:waypoint x="190" y="118" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="e2" bpmnElement="f2"><di:waypoint x="290" y="118" /><di:waypoint x="350" y="118" /></bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;
const process = (): ProcessSpec => ({ ...importBpmn(xml, 'test.bpmn').spec, slug: 'acme-crm-changeaddressv1', title: 'Adresse ändern', engine: 'c7' });
const addUserStep = [
  message([toolUse('t1', 'add_step', { after: 'CheckAddressTask', kind: 'user', name: 'Adresse freigeben' })], 'tool_use'),
  message([text('Eingefügt.')], 'end_turn'),
];

test('a process: the same draft on the studio - diagram and spec; an orchestration gets the tools of one, whatever the browser says', async () => {
  const model = { version: 1, services: [], domainTypes: [] } as unknown as Model;
  const draft = startProcessDraft(process(), xml);
  const here = await runTurn({ send: scripted(addUserStep), system: [], kit: processToolKit({ model }), history: [], prompt: 'Freigabe danach.', draft });
  const body = (task: string) => turnRequest(task, wire({ context: { model, serviceMode: false, services: [] }, system: [], history: [], prompt: 'Freigabe danach.', draft }));
  const there = await serverTurn(body('processCreator') as Exclude<ReturnType<typeof turnRequest>, string>, { send: scripted(addUserStep) });
  const d = there.draft as ProcessDraft;
  assert.equal(d.xml, here.draft.xml);
  assert.ok(allSteps(d.spec.steps).some((s) => s.name === 'Adresse freigeben'));
  // in an orchestration only service steps - the context cannot switch that off
  const orch = await serverTurn(body('serviceOrchestrator') as Exclude<ReturnType<typeof turnRequest>, string>, { send: scripted(addUserStep) });
  assert.equal((orch.draft as ProcessDraft).xml, xml);
});

test('the limits of the skill: steps, corrections, costs - checked before each request, like the steps', async () => {
  const req = turnRequest('uiCreator', wire({ context: { targets, others }, system, history: [], prompt: 'x', draft: startDraft('book', book) }));
  assert.ok(typeof req !== 'string');
  const steps = await serverTurn(req, { send: scripted(pageAnswers), limits: { maxSteps: 1 } });
  assert.deepEqual([steps.stop, steps.usage.requests], ['max_steps', 1]);
  // one request costs 0.0088 USD (1000 in, 200 out, 4000 from the cache) - the second is not sent
  const cost = await serverTurn(req, { send: scripted(pageAnswers), limits: { maxUsd: 0.008 } });
  assert.deepEqual([cost.stop, cost.usage.requests], ['max_cost', 1]);
  // the history ends with the results of the tools - the next request of the RE goes after them
  assert.equal(cost.history[cost.history.length - 1].role, 'user');
  const enough = await serverTurn(req, { send: scripted(pageAnswers), limits: { maxUsd: 1 } });
  assert.equal(enough.stop, 'done');
});

test('what the studio refuses before the turn - a task without a turn, a context or a body that does not fit', () => {
  const ok = { context: { targets, others }, system: [], history: [], prompt: 'x', draft: {} };
  assert.match(String(turnKit('serviceCreator', {})), /has no turn/);
  assert.match(String(turnRequest('uiCreator', null)), /no JSON object/);
  assert.match(String(turnRequest('uiCreator', { ...ok, context: { targets } })), /needs targets and others/);
  assert.match(String(turnRequest('processCreator', { ...ok, context: { model: 'x' } })), /model of the context/);
  assert.match(String(turnRequest('uiCreator', { ...ok, prompt: ' ' })), /prompt is no text/);
  assert.match(String(turnRequest('uiCreator', { ...ok, draft: [] })), /draft is no object/);
  assert.match(String(turnRequest('uiCreator', { ...ok, history: {} })), /history is no list/);
  assert.equal(turnPath('uiCreator'), '/ai/uiCreator/turn');
});

test('an error of the API travels as status and body; a defect as 500', async () => {
  const req = turnRequest('uiCreator', wire({ context: { targets, others }, system, history: [], prompt: 'x', draft: startDraft('book', book) }));
  assert.ok(typeof req !== 'string');
  const failing: Send = async () => { throw { status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } } }; };
  const r = outcomeOf(await serverTurn(req, { send: failing }));
  assert.deepEqual([r.stop, r.error?.status], ['error', 429]);
  assert.deepEqual(turnError(new Error('boom')), { status: 500, body: { type: 'error', error: { type: 'api_error', message: 'boom' } } });
  assert.equal(parseTurnLine('{"kind":"later"}'), undefined);
  assert.equal(parseTurnLine('no json'), undefined);
});

// ---------------------------------------------------------------- the client in orch-spec

/** a studio that answers `lines` in pieces of 7 bytes - lines cut in the middle */
const studio = (lines: TurnLine[] | string, status = 200, seen: { url?: string; body?: unknown } = {}): typeof fetch =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.url = String(input);
    seen.body = JSON.parse(String(init?.body));
    if (typeof lines === 'string') return new Response(lines, { status, headers: { 'content-type': 'application/json' } });
    const all = new TextEncoder().encode(lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const stream = new ReadableStream<Uint8Array>({
      start(c) { for (let i = 0; i < all.length; i += 7) c.enqueue(all.slice(i, i + 7)); c.close(); },
    });
    return new Response(stream, { status, headers: { 'content-type': 'application/x-ndjson' } });
  }) as typeof fetch;

const input = (draft: PageDraft, events: AgentEvent[] = [], signal?: AbortSignal) =>
  ({ system, kit: pageToolKit({ targets, others }), history: [], prompt: 'Filiale', draft, onEvent: (e: AgentEvent) => events.push(e), signal });

test('turnOnStudio - the events as they come, the result as the loop on its own would have it', async () => {
  const draft = startDraft('book', book);
  const result = outcomeOf(await runTurn({ send: scripted(pageAnswers), ...input(draft) }));
  const events: AgentEvent[] = [];
  const seen: { url?: string; body?: unknown } = {};
  const lines: TurnLine[] = [{ kind: 'text', text: 'Ich füge das Feld ein.' }, { kind: 'tool', name: 'insert_block', summary: 'eingefügt', isError: false }, { kind: 'result', result }];
  const r = await turnOnStudio('uiCreator', { targets, others }, input(draft, events), studio(lines, 200, seen));
  assert.equal(seen.url, '/ai/uiCreator/turn');
  assert.deepEqual(Object.keys(seen.body as object), ['context', 'system', 'history', 'prompt', 'draft']);
  assert.deepEqual(events.map((e) => e.kind), ['text', 'tool']);
  assert.equal(r.stop, 'done');
  assert.deepEqual(r.draft, wire(result.draft));
});

test('turnOnStudio - an error of the studio or the API reads as before; a lost answer or a stop changes nothing', async () => {
  const draft = startDraft('book', book);
  const refused = await turnOnStudio('uiCreator', { targets, others }, input(draft), studio('{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}', 401));
  assert.equal(refused.stop, 'error');
  assert.ok(refused.error instanceof Anthropic.AuthenticationError);
  assert.match(errorText(refused.error), /API-Key des Studios/);
  assert.deepEqual([refused.draft, refused.history], [draft, [{ role: 'user', content: 'Filiale' }]]);
  // the error of a request inside the turn - in its result
  const inTurn = await turnOnStudio('uiCreator', { targets, others }, input(draft),
    studio([{ kind: 'result', result: { history: [], draft, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0, fallbacks: [] }, stop: 'error', text: '', errors: [], error: { status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'slow' } } } } }]));
  assert.ok(inTurn.error instanceof Anthropic.RateLimitError);
  // the stream ends without a result - the costs reported so far stay
  const spent = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, requests: 1, fallbacks: [] };
  const lost = await turnOnStudio('uiCreator', { targets, others }, input(draft), studio([{ kind: 'usage', usage: spent }]));
  assert.deepEqual([lost.stop, lost.usage, lost.draft], ['error', spent, draft]);
  assert.match(errorText(lost.error), /Keine Verbindung zum Studio/);
  // no studio at all
  const none = await turnOnStudio('uiCreator', { targets, others }, input(draft), (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch);
  assert.match(errorText(none.error), /Keine Verbindung zum Studio/);
  // the RE stops it
  const stop = new AbortController();
  stop.abort();
  const cancelled = await turnOnStudio('uiCreator', { targets, others }, input(draft, [], stop.signal), (async () => { throw new DOMException('aborted', 'AbortError'); }) as typeof fetch);
  assert.deepEqual([cancelled.stop, cancelled.draft], ['cancelled', draft]);
});

