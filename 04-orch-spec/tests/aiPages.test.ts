// The AI mode, stage A (pages) - without network: the tools on the draft, the conversation with a
// mocked Claude (send), the self-correction with the findings, the differences, the costs and the key as switch.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { runTurn, type AgentEvent, type AgentRequest, type Send } from '../src/ai/agent';
import { dataModelText, pageSystem } from '../src/ai/context';
import { addUsage, costUsd, NO_USAGE, usageLine, usageOf } from '../src/ai/cost';
import { changedKeys, pageDiff } from '../src/ai/diff';
import { aiEnabled, KEY_STORAGE, looksLikeKey, maskKey, readKey, writeKey, type KeyStore } from '../src/ai/key';
import { draftChanged, newErrors, outlineOf, pageToolKit, runPageTool, startDraft, type PageContext } from '../src/ai/pageTools';
import { targetsOf } from '../src/pages/designer/model';
import type { Page } from '../src/pages/runtime/spec';
import type { Model } from '../src/types';

const pkg = 'acme.shop.domain';
const model = {
  version: 1,
  services: [],
  domainTypes: [
    { id: `${pkg}.Branches.In`, name: 'Branches.In', pkg, kind: 'member', importPath: '', topicName: 'acme-shop-branches', dsl: 'CustomTask',
      fields: [{ name: 'region', type: 'Option[String]' }] },
    { id: `${pkg}.Branches.Out`, name: 'Branches.Out', pkg, kind: 'member', importPath: '', topicName: 'acme-shop-branches', dsl: 'CustomTask',
      fields: [{ name: 'branches', type: 'Seq[Branch]' }] },
    { id: `${pkg}.Branch`, name: 'Branch', pkg, kind: 'case', importPath: '', fields: [{ name: 'id', type: 'String' }, { name: 'name', type: 'String' }] },
  ],
} as unknown as Model;
const targets = targetsOf(model, []);

const book: Page = {
  path: 'shop/book',
  title: 'Termin buchen',
  access: 'public',
  state: { contact: {} },
  body: [
    { type: 'heading', text: 'Termin buchen' },
    { type: 'section', label: 'Kontakt', body: [
      { type: 'fields', fields: [{ bind: 'contact.name', label: 'Name', required: true }] },
    ] },
    { type: 'button', label: 'Buchen', actions: [] },
  ],
};
const confirm: Page = { path: 'shop/confirm', title: 'Bestätigt', access: 'public', body: [{ type: 'text', text: 'Danke' }] };
const ctx: PageContext = { targets, others: [{ slug: 'book', page: book }, { slug: 'confirm', page: confirm }] };

// ---------------------------------------------------------------- the key is the switch

const memoryStore = (): KeyStore & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
};

test('the key - stored in the browser only, empty deletes it, without key the AI is off', () => {
  const store = memoryStore();
  assert.equal(readKey(store), null);
  assert.equal(aiEnabled(readKey(store)), false);
  writeKey('  sk-ant-api03-abcdefghijklmnopqrstuvwxyz  ', store);
  assert.equal(store.map.get(KEY_STORAGE), 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'); // trimmed
  assert.equal(aiEnabled(readKey(store)), true);
  writeKey('', store); // delete = AI off at once
  assert.equal(store.map.has(KEY_STORAGE), false);
  assert.equal(aiEnabled(readKey(store)), false);
  // a blocked storage (private mode): no key, no AI - and no exception
  const blocked: KeyStore = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => {} };
  assert.equal(readKey(blocked), null);
  assert.doesNotThrow(() => writeKey('sk-ant-x', blocked));
  assert.equal(readKey(null), null);
});

test('the key - a hint for the format, masked when shown', () => {
  assert.equal(looksLikeKey('sk-ant-api03-abcdefghijklmnopqrstuvwxyz'), true);
  assert.equal(looksLikeKey('hello'), false);
  assert.equal(maskKey('sk-ant-api03-abcdefghijklmnopqrstuvwxyz'), 'sk-ant-…wxyz');
});

// ---------------------------------------------------------------- the tools on the draft

test('tools - insert a field block into the section, the outline and the findings come back', () => {
  const d = startDraft('book', book);
  const r = runPageTool('insert_block', { block: { type: 'fields', fields: [{ bind: 'contact.branch', label: 'Bevorzugte Filiale' }] }, at: '1', place: 'inside' }, d, ctx);
  assert.equal(r.isError, undefined);
  assert.match(r.content, /"key":"1.1"/);
  assert.match(r.content, /Bevorzugte Filiale/);
  assert.match(r.content, /Befunde:\nkeine/);
  assert.equal(r.draft.page.body[1].type === 'section' && r.draft.page.body[1].body.length, 2);
  assert.equal(draftChanged(r.draft), true);
  // the page itself is untouched - only the draft changed
  assert.equal(book.body[1].type === 'section' && book.body[1].body.length, 1);
  assert.equal(r.draft.base, book);
});

test('tools - update, move, remove and the page properties', () => {
  const d = startDraft('book', book);
  const updated = runPageTool('update_block', { key: '0', block: { type: 'heading', text: 'Beratung buchen' } }, d, ctx);
  assert.deepEqual(updated.draft.page.body[0], { type: 'heading', text: 'Beratung buchen' });
  const moved = runPageTool('move_block', { key: '2', to: '0', place: 'before' }, updated.draft, ctx);
  assert.equal(moved.draft.page.body[0].type, 'button');
  assert.match(moved.content, /"key":"0"/);
  const removed = runPageTool('remove_block', { key: '2' }, moved.draft, ctx);
  assert.deepEqual(removed.draft.page.body.map((b) => b.type), ['button', 'heading']);
  const props = runPageTool('update_page', { title: 'Beratung', access: { roles: ['advisor'] } }, removed.draft, ctx);
  assert.equal(props.draft.page.title, 'Beratung');
  assert.deepEqual(props.draft.page.access, { roles: ['advisor'] });
  assert.equal(props.draft.page.path, 'shop/book'); // what was not given stays
});

test('tools - what would break the renderer or does not exist changes nothing', () => {
  const d = startDraft('book', book);
  const unknownType = runPageTool('insert_block', { block: { type: 'carousel' } }, d, ctx);
  assert.equal(unknownType.isError, true);
  assert.match(unknownType.content, /unbekannter Baustein/);
  assert.equal(unknownType.draft, d);
  const noLabel = runPageTool('update_block', { key: '1.0', block: { type: 'fields', fields: [{ bind: 'x' }] } }, d, ctx);
  assert.equal(noLabel.isError, true);
  assert.equal(runPageTool('remove_block', { key: '7' }, d, ctx).isError, true);
  assert.equal(runPageTool('insert_block', { block: { type: 'text', text: 'x' }, at: '9' }, d, ctx).isError, true);
  assert.equal(runPageTool('move_block', { key: '1', to: '1.0', place: 'inside' }, d, ctx).isError, true); // into itself
  assert.equal(runPageTool('update_page', {}, d, ctx).isError, true);
  assert.equal(runPageTool('delete_folder', {}, d, ctx).isError, true); // only the tools of the spec
  assert.equal(runPageTool('read_page', { slug: 'nope' }, d, ctx).isError, true);
});

test('tools - read the draft and other pages (read only), check, report an open point', () => {
  const d = startDraft('book', book);
  const own = runPageTool('read_page', {}, d, ctx);
  assert.match(own.content, /"title":"Termin buchen"/);
  assert.match(own.content, /1\.0 \{"type":"fields"/); // the outline with keys
  const other = runPageTool('read_page', { slug: 'confirm' }, d, ctx);
  assert.match(other.content, /"title":"Bestätigt"/);
  assert.equal(other.draft, d);
  const point = runPageTool('report_open_point', { text: 'Service für Filialen fehlt' }, d, ctx);
  assert.deepEqual(point.draft.openPoints, ['Service für Filialen fehlt']);
  assert.equal(draftChanged(point.draft), false); // a point alone changes no page
  const withCall = runPageTool('update_block', { key: '2', block: { type: 'button', label: 'Buchen', actions: [{ do: 'call', service: 'acme-shop-missing' }] } }, d, ctx);
  const check = runPageTool('check_page', {}, withCall.draft, ctx);
  // the same findings as the designer: public page without «public», unknown service
  assert.match(check.content, /error \[2\]: Button «Buchen»: auf einer öffentlichen Seite/);
  assert.match(check.content, /warning \[2\]: .*kennt der Katalog nicht/);
});

test('newErrors - only the errors the draft brought, not those the page already had', () => {
  const broken: Page = { ...book, body: [...book.body, { type: 'button', label: 'Alt', actions: [{ do: 'start', process: 'p' }] }] };
  const d = startDraft('book', broken);
  assert.deepEqual(newErrors(d, ctx), []); // unchanged
  const touched = runPageTool('update_block', { key: '0', block: { type: 'heading', text: 'Neu' } }, d, ctx).draft;
  assert.deepEqual(newErrors(touched, ctx), []); // the old error is not Claude's
  const worse = runPageTool('update_block', { key: '2', block: { type: 'button', label: 'Buchen', actions: [{ do: 'call', service: 'acme-shop-branches' }] } }, touched, ctx).draft;
  assert.equal(newErrors(worse, ctx).length, 1);
});

test('outlineOf - one line per block with its key, sections without their content', () => {
  assert.equal(outlineOf(book).split('\n')[1], '1 {"type":"section","label":"Kontakt"}');
  assert.equal(outlineOf({ ...book, body: [] }), '(keine Bausteine)');
});

// ---------------------------------------------------------------- the conversation (Claude mocked)

const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 };
const message = (content: unknown[], stop_reason: string): BetaMessage =>
  ({ id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason, usage } as unknown as BetaMessage);
const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input });
const text = (t: string) => ({ type: 'text', text: t });

/** A Claude that answers with the given messages one after the other - and records the requests. */
const scripted = (answers: BetaMessage[]): { send: Send; requests: AgentRequest[] } => {
  const requests: AgentRequest[] = [];
  return {
    requests,
    send: async (r) => {
      requests.push(structuredClone(r));
      const next = answers[requests.length - 1];
      if (!next) throw new Error('no more answers');
      return next;
    },
  };
};

const system = pageSystem('type Page = …', targets, ctx.others, { title: 'Shop' });

test('runTurn - Claude reads, inserts, finishes: the draft changes, the history grows, usage adds up', async () => {
  const claude = scripted([
    message([toolUse('t1', 'read_page', {})], 'tool_use'),
    message([text('Ich füge das Feld ein.'), toolUse('t2', 'insert_block', { block: { type: 'fields', fields: [{ bind: 'contact.branch', label: 'Filiale' }] }, at: '1', place: 'inside' })], 'tool_use'),
    message([text('Das Feld «Filiale» ist im Abschnitt Kontakt.')], 'end_turn'),
  ]);
  const events: AgentEvent[] = [];
  const r = await runTurn({ send: claude.send, system, kit: pageToolKit(ctx), history: [], prompt: 'Nimm ein Feld für die Filiale auf.', draft: startDraft('book', book), onEvent: (e) => events.push(e) });
  assert.equal(r.stop, 'done');
  assert.equal(r.text, 'Ich füge das Feld ein.\n\nDas Feld «Filiale» ist im Abschnitt Kontakt.');
  assert.equal(r.draft.page.body[1].type === 'section' && r.draft.page.body[1].body[1].type, 'fields');
  assert.deepEqual(r.errors, []);
  // user, assistant(tool), user(result), assistant(tool), user(result), assistant(text)
  assert.deepEqual(r.history.map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
  // every request: the same system and tools (cache), only the messages grow
  assert.equal(claude.requests.length, 3);
  assert.deepEqual(claude.requests[2].system, system);
  assert.deepEqual(claude.requests.map((q) => q.messages.length), [1, 3, 5]);
  const result = (claude.requests[2].messages[4].content as { type: string; tool_use_id: string; is_error?: boolean }[])[0];
  assert.equal(result.tool_use_id, 't2');
  assert.equal(result.is_error, undefined);
  assert.deepEqual(r.usage, { input: 3000, output: 600, cacheRead: 12000, cacheWrite: 0, requests: 3 });
  assert.deepEqual(events.filter((e) => e.kind === 'tool').map((e) => e.kind === 'tool' && e.name), ['read_page', 'insert_block']);
});

test('runTurn - errors of the draft send Claude back to correct, at most MAX_CORRECTIONS times', async () => {
  // a call without «public» on a public page: an error of the designer
  const bad = { type: 'button', label: 'Buchen', actions: [{ do: 'call', service: 'acme-shop-branches', input: {} }] };
  const good = { ...bad, actions: [{ ...bad.actions[0], public: true }] };
  const claude = scripted([
    message([toolUse('t1', 'update_block', { key: '2', block: bad })], 'tool_use'),
    message([text('Fertig.')], 'end_turn'),
    message([toolUse('t2', 'update_block', { key: '2', block: good })], 'tool_use'),
    message([text('Korrigiert.')], 'end_turn'),
  ]);
  const events: AgentEvent[] = [];
  const r = await runTurn({ send: claude.send, system, kit: pageToolKit(ctx), history: [], prompt: 'Lade die Filialen beim Klick.', draft: startDraft('book', book), onEvent: (e) => events.push(e) });
  assert.equal(r.stop, 'done');
  assert.deepEqual(r.errors, []);
  const check = events.find((e) => e.kind === 'check');
  assert.ok(check && check.kind === 'check' && /öffentlichen Seite/.test(check.errors[0]));
  // the correction is a user message after Claude's «Fertig.» - the history is only appended
  assert.match(String(claude.requests[2].messages[4].content), /Die Prüfung des Entwurfs meldet noch Fehler/);

  // a Claude that does not correct: after MAX_CORRECTIONS the draft goes to the RE with its errors
  const stubborn = scripted([
    message([toolUse('t1', 'update_block', { key: '2', block: bad })], 'tool_use'),
    message([text('Fertig.')], 'end_turn'),
    message([text('Fertig.')], 'end_turn'),
    message([text('Fertig.')], 'end_turn'),
  ]);
  const r2 = await runTurn({ send: stubborn.send, system, kit: pageToolKit(ctx), history: [], prompt: 'x', draft: startDraft('book', book) });
  assert.equal(r2.stop, 'done');
  assert.equal(stubborn.requests.length, 4);
  assert.equal(r2.errors.length, 1);
});

test('runTurn - a follow-up builds on the history and the draft of the previous turn', async () => {
  const first = await runTurn({
    send: scripted([message([toolUse('t1', 'update_block', { key: '0', block: { type: 'heading', text: 'Beratung' } })], 'tool_use'), message([text('ok')], 'end_turn')]).send,
    system, kit: pageToolKit(ctx), history: [], prompt: 'Titel ändern', draft: startDraft('book', book),
  });
  const claude = scripted([message([text('Noch etwas?')], 'end_turn')]);
  const second = await runTurn({ send: claude.send, system, kit: pageToolKit(ctx), history: first.history, prompt: 'Danke', draft: first.draft });
  assert.equal(claude.requests[0].messages.length, first.history.length + 1);
  assert.deepEqual(claude.requests[0].messages.slice(0, first.history.length), first.history);
  assert.deepEqual(second.draft.page.body[0], { type: 'heading', text: 'Beratung' });
  assert.equal(second.draft.base, book);
});

test('runTurn - refusal, answer cut off, network error, cancel and the step limit end the turn', async () => {
  const kit = pageToolKit(ctx);
  const draft = startDraft('book', book);
  const refused = await runTurn({ send: scripted([message([], 'refusal')]).send, system, kit, history: [], prompt: 'x', draft });
  assert.equal(refused.stop, 'refusal');
  assert.deepEqual(refused.history.map((m) => m.role), ['user']); // no answer in the history

  // cut off in the middle of a tool call: the tool does not run, the call stays out of the history
  const cut = await runTurn({ send: scripted([message([toolUse('t1', 'remove_block', { key: '0' })], 'max_tokens')]).send, system, kit, history: [], prompt: 'x', draft });
  assert.equal(cut.stop, 'max_tokens');
  assert.equal(cut.draft, draft);
  assert.equal(cut.history.length, 1);

  const failing: Send = async () => { throw new Error('offline'); };
  const failed = await runTurn({ send: failing, system, kit, history: [], prompt: 'x', draft });
  assert.equal(failed.stop, 'error');
  assert.equal((failed.error as Error).message, 'offline');

  const abort = new AbortController();
  abort.abort();
  const cancelled = await runTurn({ send: failing, system, kit, history: [], prompt: 'x', draft, signal: abort.signal });
  assert.equal(cancelled.stop, 'cancelled');

  const looping: Send = async () => message([toolUse('t', 'check_page', {})], 'tool_use');
  const limited = await runTurn({ send: looping, system, kit, history: [], prompt: 'x', draft, maxSteps: 3 });
  assert.equal(limited.stop, 'max_steps');
  assert.equal(limited.usage.requests, 3);
});

// ---------------------------------------------------------------- what Claude knows, what it costs

test('the system - two cached blocks, the data model as text, deterministic', () => {
  assert.equal(system.length, 2);
  assert.ok(system.every((b) => b.cache_control?.type === 'ephemeral'));
  assert.match(system[0].text, /type Page = …/);
  assert.match(system[1].text, /acme-shop-branches \(Branches\)\n  In: \{region\?: String\}\n  Out: \{branches: \[Branch\{id: String, name: String\}\]\}/);
  assert.match(system[1].text, /- book – \/shop\/book – Termin buchen – public/);
  assert.deepEqual(pageSystem('type Page = …', targets, [...ctx.others].reverse(), { title: 'Shop' }), system); // same prefix, same cache
  assert.equal(dataModelText(targets), dataModelText(targetsOf(model, [])));
});

test('costs - Opus 5.5 prices, cache reads cheap, one line for the chat', () => {
  const u = addUsage(usageOf(usage), usageOf({ input_tokens: 500, output_tokens: 100, cache_read_input_tokens: null, cache_creation_input_tokens: 2000 }));
  assert.deepEqual(u, { input: 1500, output: 300, cacheRead: 4000, cacheWrite: 2000, requests: 2 });
  // 1500 × 4 + 300 × 20 + 4000 × 0.2 + 2000 × 5 = 6000 + 6000 + 800 + 10000 = 22800 per million
  assert.equal(costUsd(u).toFixed(4), '0.0228');
  assert.equal(usageLine(u), '2 Anfragen · 7.5k ein (4.0k aus dem Cache) · 300 aus · 0.02 USD');
  assert.equal(costUsd(NO_USAGE), 0);
});

// ---------------------------------------------------------------- the differences

test('pageDiff - new field, changed block, moved, removed, page properties', () => {
  const kit = (d: ReturnType<typeof startDraft>, name: string, input: unknown) => runPageTool(name, input, d, ctx).draft;
  const d0 = startDraft('book', book);
  const d1 = kit(d0, 'update_block', { key: '1.0', block: { type: 'fields', fields: [{ bind: 'contact.name', label: 'Name', required: true }, { bind: 'contact.branch', label: 'Filiale' }] } });
  const d2 = kit(d1, 'insert_block', { block: { type: 'text', text: 'Hinweis' }, at: '0' });
  const d3 = kit(d2, 'move_block', { key: '3', to: '0', place: 'before' });
  const d4 = kit(d3, 'update_page', { title: 'Beratung buchen' });
  const changes = pageDiff(book, d4.page);
  assert.deepEqual(changes.map((c) => [c.kind, c.key, c.label, c.detail]), [
    ['page', undefined, 'Titel', '«Termin buchen» → «Beratung buchen»'],
    ['moved', '0', 'Button «Buchen»', 'von 2'],
    ['added', '2', 'Text «Hinweis»', undefined],
    ['changed', '3.0', 'Eingabefelder', '«Filiale» neu'],
  ]);
  assert.deepEqual([...changedKeys(changes)], ['0', '2', '3.0']);
  const removed = pageDiff(book, kit(d0, 'remove_block', { key: '2' }).page);
  assert.deepEqual(removed.map((c) => [c.kind, c.key, c.label]), [['removed', '2', 'Button «Buchen»']]);
  assert.deepEqual(pageDiff(book, book), []);
});
