// A turn of the agent on the studio (E28, step 5) - `POST /ai/<task>/turn` with the loop of orch-spec's
// core (the real bundle, `npm run core`), the Claude API a fake on a free port that answers one message
// after the other. The route without a port (app.request).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { configJson } from '../src/ai.ts';
import { studioApp } from '../src/app.ts';
import { configFromEnv, describeAi, type AiConfig } from '../src/config.ts';
import { memoryLog } from '../src/log.ts';
import { siteOf } from '../src/site.ts';
import { loadSkills, parseSkill, type Skill } from '../src/skills.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 };
const message = (content: unknown[], stop_reason: string) =>
  ({ id: 'msg', type: 'message', role: 'assistant', model: 'claude-skill', content, stop_reason, usage });
const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input });
const text = (t: string) => ({ type: 'text', text: t });
const answers = [
  message([toolUse('t1', 'read_page', {})], 'tool_use'),
  message([text('Ich füge das Feld ein.'), toolUse('t2', 'insert_block', { block: { type: 'fields', fields: [{ bind: 'contact.branch', label: 'Filiale' }] }, at: '1', place: 'inside' })], 'tool_use'),
  message([text('Das Feld «Filiale» ist im Abschnitt Kontakt.')], 'end_turn'),
];

/** A fake Claude API: the answers one after the other (by the answers in the request) - or `status` with an error; `wait` holds each. */
async function fakeApi(o: { status?: number; wait?: number } = {}) {
  const seen: { url: string; headers: Json; body: Json }[] = [];
  const closed: boolean[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Json;
      seen.push({ url: req.url ?? '', headers: req.headers, body });
      res.on('close', () => closed.push(!res.writableFinished));
      setTimeout(() => {
        if (res.destroyed) return;
        if (o.status) return res.writeHead(o.status, { 'content-type': 'application/json' }).end('{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}');
        const next = answers[(body.messages as Json[]).filter((m) => m.role === 'assistant').length];
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(next));
      }, o.wait ?? 0);
    });
  });
  await new Promise<void>((up) => server.listen(0, 'localhost', up));
  const port = (server.address() as AddressInfo).port;
  return { port, seen, closed, close: () => new Promise<void>((down) => { server.closeAllConnections(); server.close(() => down()); }) };
}

const config = (port: number): AiConfig => ({ apiKey: 'sk-ant-studio', model: 'claude-studio', baseUrl: `http://localhost:${port}`, agent: 'server' });
const skill: Skill = {
  task: 'uiCreator', provider: 'anthropic', name: 'uiCreator-test', version: 3, model: 'claude-skill', maxTokens: 8000, effort: 'medium',
  tools: ['read_page', 'insert_block', 'update_block', 'move_block', 'remove_block', 'update_page', 'check_page', 'report_open_point'],
  limits: { stepsPerTurn: 24, correctionsPerTurn: 2, usdPerTurn: 1 },
  instructions: 'Do as the skill says.',
};
const app = (ai: AiConfig | undefined, skills: Skill[] = [skill]) => {
  const log = memoryLog();
  return { log, app: studioApp({ site: siteOf([]), ai, skills, log }) };
};

const book = {
  path: 'shop/book', title: 'Termin buchen', access: 'public', state: { contact: {} },
  body: [
    { type: 'heading', text: 'Termin buchen' },
    { type: 'section', label: 'Kontakt', body: [{ type: 'fields', fields: [{ bind: 'contact.name', label: 'Name', required: true }] }] },
    { type: 'button', label: 'Buchen', actions: [] },
  ],
};
const targets = { services: [], processes: [], messages: [], userTasks: [] };
/** what orch-spec sends for a turn about the page «book» */
const turnBody = (over: Json = {}) => JSON.stringify({
  context: { targets, others: [{ slug: 'book', page: book }] },
  system: [{ type: 'text', text: 'the catalog', cache_control: { type: 'ephemeral' } }],
  history: [],
  prompt: 'Nimm ein Feld für die Filiale auf.',
  draft: { slug: 'book', base: book, page: book, openPoints: [] },
  ...over,
});
const turn = (body: string, task = 'uiCreator', signal?: AbortSignal) =>
  new Request(`http://studio/ai/${task}/turn`, { method: 'POST', body, headers: { 'content-type': 'application/json' }, ...(signal ? { signal } : {}) });
const linesOf = async (r: Response) => (await r.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Json);
const resultOf = (lines: Json[]) => lines.find((l) => l.kind === 'result')!.result as Json;

test('POST /ai/uiCreator/turn - the loop on the studio: the events as they come, the draft at the end; each request with the skill applied', async () => {
  const api = await fakeApi();
  try {
    const { app: a, log } = app(config(api.port));
    const r = await a.request(turn(turnBody()));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/x-ndjson');
    const lines = await linesOf(r);
    assert.deepEqual(lines.map((l) => l.kind), ['usage', 'tool', 'usage', 'text', 'tool', 'usage', 'text', 'result']);
    const result = resultOf(lines);
    assert.equal(result.stop, 'done');
    assert.equal(result.draft.page.body[1].body[1].fields[0].label, 'Filiale');
    assert.deepEqual(result.errors, []);
    assert.equal(result.usage.requests, 3);
    // the history as the loop in the browser has it: user, then assistant and the tool results
    assert.deepEqual(result.history.map((m: Json) => m.role), ['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
    // each request: the key of the studio, the skill first in the system, its model and settings, the tools of the task
    assert.equal(api.seen.length, 3);
    const first = api.seen[0];
    assert.equal(first.url, '/v1/messages?beta=true');
    assert.equal(first.headers['x-api-key'], 'sk-ant-studio');
    assert.deepEqual([first.body.model, first.body.max_tokens, first.body.output_config], ['claude-skill', 8000, { effort: 'medium' }]);
    assert.deepEqual(first.body.system.map((b: Json) => b.text), ['Do as the skill says.', 'the catalog']);
    assert.deepEqual(first.body.tools.map((t: Json) => t.name), skill.tools);
    assert.deepEqual(api.seen.map((s) => s.body.messages.length), [1, 3, 5]);
    // the log: one line per request and one for the turn - no content
    assert.equal(log.lines.length, 4);
    assert.match(log.lines[3], /POST \/ai\/uiCreator\/turn - uiCreator-test v3, claude-skill: done in \d+ ms, 3 requests, 0\.026 USD/);
    assert.ok(!log.lines.join('\n').includes('Filiale'));
  } finally {
    await api.close();
  }
});

test('the limits of the skill - steps and costs per turn', async () => {
  const api = await fakeApi();
  try {
    const steps = await app(config(api.port), [{ ...skill, limits: { stepsPerTurn: 1 } }]).app.request(turn(turnBody()));
    assert.deepEqual([resultOf(await linesOf(steps)).stop, api.seen.length], ['max_steps', 1]);
    // one request costs 0.0088 USD - the second is not sent
    const cost = await app(config(api.port), [{ ...skill, limits: { usdPerTurn: 0.008 } }]).app.request(turn(turnBody()));
    const result = resultOf(await linesOf(cost));
    assert.deepEqual([result.stop, result.usage.requests, api.seen.length], ['max_cost', 1, 2]);
  } finally {
    await api.close();
  }
});

test('an error of the Claude API - the result says stop «error» with its status and body, as orch-spec reads them', async () => {
  const api = await fakeApi({ status: 401 });
  try {
    const r = await app(config(api.port)).app.request(turn(turnBody()));
    const result = resultOf(await linesOf(r));
    assert.equal(result.stop, 'error');
    assert.deepEqual(result.error, { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } });
    // the draft and the history as they were, with the request
    assert.deepEqual(result.history, [{ role: 'user', content: 'Nimm ein Feld für die Filiale auf.' }]);
  } finally {
    await api.close();
  }
});

test('a tool of the task that is not in the skill - refused before a request, as for the loop in the browser', async () => {
  const api = await fakeApi();
  try {
    const r = await app(config(api.port), [{ ...skill, tools: ['read_page'] }]).app.request(turn(turnBody()));
    const result = resultOf(await linesOf(r));
    assert.equal(result.error.status, 400);
    assert.match(result.error.body.error.message, /are not in the skill uiCreator-test v3/);
    assert.equal(api.seen.length, 0);
  } finally {
    await api.close();
  }
});

test('refused before the turn - the AI off, no skill, a task without a turn, a body that does not fit; nothing sent', async () => {
  const api = await fakeApi();
  try {
    const off = await app(undefined).app.request(turn(turnBody()));
    assert.equal(off.status, 404);
    const noSkill = await app(config(api.port)).app.request(turn(turnBody(), 'processCreator'));
    assert.equal(noSkill.status, 403);
    const noTurn = await app(config(api.port), [{ ...skill, task: 'serviceCreator' }]).app.request(turn(turnBody(), 'serviceCreator'));
    assert.equal(noTurn.status, 400);
    assert.match(await noTurn.text(), /has no turn on the studio/);
    const noJson = await app(config(api.port)).app.request(turn('{'));
    assert.match(await noJson.text(), /the body is no JSON/);
    const noPrompt = await app(config(api.port)).app.request(turn(turnBody({ prompt: '' })));
    assert.deepEqual([noPrompt.status, (await noPrompt.json() as Json).error.message], [400, 'the prompt is no text']);
    assert.equal(api.seen.length, 0);
  } finally {
    await api.close();
  }
});

test('the browser goes away - the loop stops, its request to the API ends too, no warning', async () => {
  const api = await fakeApi({ wait: 2000 });
  try {
    const { app: a, log } = app(config(api.port));
    const gone = new AbortController();
    const r = await a.request(turn(turnBody(), 'uiCreator', gone.signal));
    setTimeout(() => gone.abort(), 100);
    await r.text().catch(() => undefined);
    // the turn ends as stopped - one line, no warning
    await new Promise((done) => setTimeout(done, 200));
    assert.deepEqual(log.lines.map((l) => l.replace(/ in \d+ ms/, '')), ['INFO POST /ai/uiCreator/turn - uiCreator-test v3, claude-skill: cancelled, 0 requests, 0.000 USD']);
    assert.deepEqual(api.closed, [true]);
  } finally {
    await api.close();
  }
});

test('where the loop runs - STUDIO_AI_AGENT: browser (default) or server, in GET /ai/config', () => {
  const key = { STUDIO_AI_ANTHROPIC_API_KEY: 'sk-ant-x' };
  assert.equal(configFromEnv(key).ai?.agent, undefined);
  assert.equal(configFromEnv({ ...key, STUDIO_AI_AGENT: 'browser' }).ai?.agent, undefined);
  const server = configFromEnv({ ...key, STUDIO_AI_AGENT: 'server' }).ai!;
  assert.equal(server.agent, 'server');
  assert.match(describeAi(server), /the agent in the server/);
  assert.throws(() => configFromEnv({ ...key, STUDIO_AI_AGENT: 'cloud' }), /STUDIO_AI_AGENT is «cloud» - only browser or server/);
  assert.equal(configJson(server, [skill]).agent, 'server');
  assert.equal(configJson({ ...server, agent: undefined }, [skill]).agent, undefined);
});

test('the limits of a skill - the studio\'s skills have them; a wrong one is named', () => {
  const skills = loadSkills('anthropic') as Skill[];
  for (const s of skills) assert.deepEqual(s.limits, { stepsPerTurn: 24, correctionsPerTurn: 2, usdPerTurn: 1, usdPerPersonDay: 20 });
  const of = (limits: string) => parseSkill('uiCreator', 'anthropic', `---\nname: x\ntools: []\nlimits:\n${limits}\n---\n\n## Instructions\n\nDo.\n`);
  assert.deepEqual((of('  usd_per_turn: 0.5') as Skill).limits, { usdPerTurn: 0.5 });
  assert.match(String(of('  steps_per_turn: "24"')), /«limits\.steps_per_turn» has the wrong type/);
  assert.match(String(of('  steps_per_turn: 0')), /must be more than 0/);
  assert.match(String(of('  corrections_per_turn: -1')), /must not be below 0/);
  assert.match(String(of('  usd_per_turn: free')), /«limits\.usd_per_turn» has the wrong type/);
  assert.match(String(parseSkill('uiCreator', 'anthropic', '---\nname: x\ntools: []\nlimits: 3\n---\n\n## Instructions\n\nDo.\n')), /«limits» is no object/);
  assert.equal((parseSkill('uiCreator', 'anthropic', '---\nname: x\ntools: []\n---\n\n## Instructions\n\nDo.\n') as Skill).limits, undefined);
});
