// The AI of the studio - the cases of AiRoutesSpec (Scala) before the studio became TypeScript (E28,
// step 3). The routes without a port (app.request), the Claude API a fake on a free port.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FALLBACK_BETA, MAX_BODY, MAX_TOKENS, NO_SKILL_MESSAGE, OFF_MESSAGE, configJson, limiter, requestBody } from '../src/ai.ts';
import { studioApp } from '../src/app.ts';
import { configFromEnv, describeAi, DEFAULT_MODEL, type AiConfig } from '../src/config.ts';
import { memoryLog } from '../src/log.ts';
import { siteOf } from '../src/site.ts';
import { BUILT_IN_SKILLS, loadSkills, parseSkill, type Skill } from '../src/skills.ts';

/** What the fake Claude API saw of a request. */
type Seen = { headers: IncomingHttpHeaders; url: string; body: string };

const answer = '{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"text","text":"Hallo"}],"usage":{"input_tokens":12,"output_tokens":3}}';

/** A fake Claude API on a free port: answers `answer` - or 401 for the key «bad»; `wait` holds the answer. */
async function fakeApi(wait = 0) {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      seen.push({ headers: req.headers, url: req.url ?? '', body: Buffer.concat(chunks).toString('utf8') });
      setTimeout(() => {
        if (req.headers['x-api-key'] === 'bad') {
          res.writeHead(401, { 'content-type': 'application/json' }).end('{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}');
        } else res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_1' }).end(answer);
      }, wait);
    });
  });
  await new Promise<void>((up) => server.listen(0, 'localhost', up));
  const port = (server.address() as AddressInfo).port;
  return { port, seen, close: () => new Promise<void>((down) => { server.closeAllConnections(); server.close(() => down()); }) };
}

const config = (port: number, apiKey = 'sk-ant-studio'): AiConfig =>
  ({ apiKey, workspaceId: 'wrkspc_1', model: 'claude-test', baseUrl: `http://localhost:${port}` });

/** A skill of the test - its settings differ from those the browser sends. */
const skill: Skill = {
  task: 'uiCreator', provider: 'anthropic', name: 'uiCreator-test', version: 2, model: 'claude-skill', maxTokens: 16000,
  thinking: 'adaptive', effort: 'medium', fallbacks: 'default', tools: ['read_page', 'check_page'], instructions: 'Do as the skill says.',
};

const app = (ai: AiConfig | undefined, skills: Skill[] = [skill], aiTimeoutMs?: number) => {
  const log = memoryLog();
  return { log, app: studioApp({ site: siteOf([]), ai, skills, log, ...(aiTimeoutMs ? { aiTimeoutMs } : {}) }) };
};

/** A request as the SDK in the browser sends it - with a key of its own that must not count. */
const fromBrowser = (body: string, task = 'uiCreator', headers: Record<string, string> = {
  'x-api-key': 'from-the-browser', 'anthropic-version': '2023-06-01', 'anthropic-beta': `${FALLBACK_BETA}, other-beta`,
}) => new Request(`http://studio/ai/${task}/v1/messages?beta=true`, { method: 'POST', body, headers });

/** What orch-spec sends: the context as system (no instructions), its tools, its settings. */
const body = JSON.stringify({
  model: 'claude-opus-5-5', max_tokens: 100000,
  system: [{ type: 'text', text: 'the catalog', cache_control: { type: 'ephemeral' } }],
  tools: [{ name: 'read_page', input_schema: { type: 'object' } }],
  output_config: { effort: 'high' },
  messages: [{ role: 'user', content: 'Hallo' }],
});

type Sent = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const bodyOf = (b: string, s = skill, ai = config(1)) => requestBody(new TextEncoder().encode(b), ai, s);
const sentOf = (b: string, s = skill, ai = config(1)) => bodyOf(b, s, ai) as Sent;

test('GET /ai/config - on with provider, model and the tasks with their skill, never the key; off without a key', async () => {
  const on = await (await app(config(1)).app.request('/ai/config')).text();
  const off = await (await app(undefined).app.request('/ai/config')).text();
  assert.equal(on, '{"enabled":true,"provider":"anthropic","model":"claude-test","tasks":["uiCreator"],"skills":{"uiCreator":{"name":"uiCreator-test","version":2,"model":"claude-skill"}}}');
  assert.ok(!on.includes('sk-ant'));
  assert.equal(off, '{"enabled":false}');
});

test('POST /ai/uiCreator/v1/messages - the key and workspace of the studio, the skill applied; the answer as it is', async () => {
  const api = await fakeApi();
  try {
    const { app: a, log } = app(config(api.port));
    const r = await a.request(fromBrowser(body));
    assert.equal(r.status, 200);
    assert.equal(await r.text(), answer);
    assert.equal(r.headers.get('request-id'), 'req_1');
    const got = api.seen[0];
    assert.equal(got.headers['x-api-key'], 'sk-ant-studio');
    assert.equal(got.headers['anthropic-workspace-id'], 'wrkspc_1');
    assert.equal(got.headers['anthropic-beta'], `${FALLBACK_BETA},other-beta`);
    assert.equal(got.headers['anthropic-version'], '2023-06-01');
    assert.equal(got.url, '/v1/messages?beta=true');
    const sent = JSON.parse(got.body) as Sent;
    // the skill: model, settings, its instructions first - the context of the browser after them
    assert.equal(sent.model, 'claude-skill');
    assert.equal(sent.max_tokens, 16000);
    assert.equal(sent.thinking.type, 'adaptive');
    assert.equal(sent.output_config.effort, 'medium');
    assert.equal(sent.fallbacks, 'default');
    assert.equal(sent.system[0].text, 'Do as the skill says.');
    assert.equal(sent.system[0].cache_control, undefined);
    assert.equal(sent.system[1].text, 'the catalog');
    assert.ok(sent.system[1].cache_control);
    assert.ok(Array.isArray(sent.messages));
    // the log: skill, model, status and tokens - no content, no key
    assert.match(log.lines[0], /^INFO POST \/ai\/uiCreator\/v1\/messages - uiCreator-test v2, claude-skill: 200 in \d+ ms, tokens in 12 \(cache read 0, written 0\), out 3$/);
    assert.ok(!log.lines.join('\n').includes('sk-ant') && !log.lines.join('\n').includes('Hallo'));
  } finally {
    await api.close();
  }
});

test('the fallback beta is set for a skill with fallbacks - also if the browser sends none', async () => {
  const api = await fakeApi();
  try {
    await app(config(api.port)).app.request(fromBrowser(body, 'uiCreator', {}));
    assert.equal(api.seen[0].headers['anthropic-beta'], FALLBACK_BETA);
    assert.equal(api.seen[0].headers['anthropic-version'], '2023-06-01');
  } finally {
    await api.close();
  }
});

test('an error of the Claude API goes back as it is - the SDK in the browser reads it', async () => {
  const api = await fakeApi();
  try {
    const r = await app(config(api.port, 'bad')).app.request(fromBrowser(body));
    assert.equal(r.status, 401);
    assert.match(await r.text(), /authentication_error/);
  } finally {
    await api.close();
  }
});

test('the AI off - 404 with the message orch-spec recognizes, nothing sent', async () => {
  const r = await app(undefined).app.request(fromBrowser(body));
  const b = await r.text();
  assert.equal(r.status, 404);
  assert.ok(b.includes(OFF_MESSAGE) && b.includes('not_found_error'));
});

test('no JSON, no object, too large - 400 / 413 in the form of the API, nothing sent', async () => {
  const api = await fakeApi();
  try {
    const { app: a } = app(config(api.port));
    const noJson = await a.request(fromBrowser('{'));
    const noObj = await a.request(fromBrowser('[1]'));
    const big = await a.request(fromBrowser(' '.repeat(MAX_BODY + 1)));
    // without a length: read up to the limit, not further
    const chunked = await a.request(new Request('http://studio/ai/uiCreator/v1/messages', {
      method: 'POST', duplex: 'half', body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(MAX_BODY)); c.enqueue(new Uint8Array(1)); c.close(); } }),
    } as RequestInit));
    assert.equal(noJson.status, 400);
    assert.match(await noJson.text(), /invalid_request_error/);
    assert.equal(noObj.status, 400);
    assert.equal(big.status, 413);
    assert.equal(chunked.status, 413);
    assert.equal(api.seen.length, 0);
  } finally {
    await api.close();
  }
});

test('a tool that is not in the skill or has no name - 400 that names it, nothing sent', async () => {
  const api = await fakeApi();
  try {
    const { app: a } = app(config(api.port));
    const r = await a.request(fromBrowser(body.replace('"name":"read_page"', '"name":"remove_block"')));
    const b = await r.text();
    const n = await a.request(fromBrowser(body.replace('"name":"read_page",', '')));
    assert.equal(r.status, 400);
    assert.ok(b.includes('«remove_block»') && b.includes('uiCreator-test v2'));
    assert.equal(n.status, 400);
    assert.match(await n.text(), /\(without name\)/);
    assert.equal(api.seen.length, 0);
  } finally {
    await api.close();
  }
});

test('a task without a skill, an unknown one, the old route - 403, nothing sent', async () => {
  const api = await fakeApi();
  try {
    const { app: a } = app(config(api.port));
    const process = await a.request(fromBrowser(body, 'processCreator'));
    const unknown = await a.request(fromBrowser(body, 'whatever'));
    const old = await a.request(fromBrowser(body, 'anthropic'));
    const pb = await process.text();
    assert.equal(process.status, 403);
    assert.ok(pb.includes(NO_SKILL_MESSAGE) && pb.includes('processCreator'));
    assert.equal(unknown.status, 403);
    assert.equal(old.status, 403);
    assert.equal(api.seen.length, 0);
  } finally {
    await api.close();
  }
});

test('the system of the browser - a text, none or something else', () => {
  const texts = (b: string) => (sentOf(b).system as { text: string }[]).map((s) => s.text);
  assert.deepEqual(texts('{"system":"the context"}'), ['Do as the skill says.', 'the context']);
  assert.deepEqual(texts('{}'), ['Do as the skill says.']);
  assert.equal(typeof bodyOf('{"system":5}'), 'string');
});

test('max_tokens: at most what the skill allows - and never more than the cap of the studio', () => {
  const { maxTokens: _m, ...noMax } = skill;
  assert.equal(sentOf('{"max_tokens":8000}').max_tokens, 8000);
  assert.equal(sentOf('{}').max_tokens, 16000);
  assert.equal(sentOf('{}', noMax).max_tokens, MAX_TOKENS);
  assert.equal(sentOf('{"max_tokens":50000}', { ...skill, maxTokens: 50000 }).max_tokens, MAX_TOKENS);
});

test('a skill without model and settings - the model of the studio, none of the browser\'s settings', () => {
  const { model: _m, thinking: _t, effort: _e, fallbacks: _f, ...bare } = skill;
  const browser = body.replace('"output_config":{"effort":"high"}',
    '"output_config":{"effort":"high","format":"x"},"thinking":{"type":"enabled","budget_tokens":9},"fallbacks":"default"');
  const sent = sentOf(browser, bare);
  const full = sentOf(browser);
  assert.equal(sent.model, 'claude-test');
  assert.equal(sent.output_config.effort, undefined);
  assert.equal(sent.output_config.format, 'x'); // not a setting of the skill
  assert.equal(sent.thinking, undefined);
  assert.equal(sent.fallbacks, undefined);
  // with the settings in the skill: the skill's, the rest of output_config kept
  assert.deepEqual(full.thinking, { type: 'adaptive' });
  assert.equal(full.output_config.effort, 'medium');
  assert.equal(full.output_config.format, 'x');
  assert.equal((configJson(config(1), [bare]).skills as Sent).uiCreator.model, 'claude-test');
});

test('the skills the studio brings - pages, processes and orchestrations with anthropic, instructions without comments', () => {
  const loaded = loadSkills('anthropic');
  assert.ok(Array.isArray(loaded), String(loaded));
  const skills = loaded as Skill[];
  const of = (t: string) => skills.find((s) => s.task === t);
  const processTools = ['read_process', 'add_step', 'add_decision', 'add_error_path', 'remove_step', 'rename_step', 'update_step', 'add_type',
    'update_type', 'remove_type', 'check_process', 'report_open_point'];
  assert.deepEqual(skills.map((s) => s.task), ['uiCreator', 'processCreator', 'serviceOrchestrator']);
  // the same settings, the tools of the process view - each with its own instructions
  for (const t of ['processCreator', 'serviceOrchestrator']) {
    const s = of(t)!;
    assert.equal(s.name, `${t}-anthropic`);
    assert.deepEqual(s.tools, processTools);
    assert.equal(s.maxTokens, 16000);
    assert.equal(s.thinking, 'adaptive');
    assert.ok(s.instructions.endsWith('No JSON, no XML in the answer.'));
    assert.ok(!s.instructions.includes('<!--'));
  }
  assert.ok(of('processCreator')!.instructions.includes('specify a process of an app'));
  assert.ok(of('serviceOrchestrator')!.instructions.includes('one worker that calls services in one go'));
  assert.deepEqual(loadSkills('bedrock-eu'), []);
  const ui = of('uiCreator')!;
  assert.equal(ui.name, 'uiCreator-anthropic');
  assert.equal(ui.model, 'claude-opus-5-5');
  assert.equal(ui.maxTokens, 16000);
  assert.equal(ui.effort, 'medium');
  assert.deepEqual(ui.tools, ['read_page', 'insert_block', 'update_block', 'move_block', 'remove_block', 'update_page', 'check_page', 'report_open_point']);
  assert.ok(ui.instructions.startsWith('You help a requirements engineer'));
  assert.ok(ui.instructions.endsWith('No JSON in the answer.'));
  assert.ok(!ui.instructions.includes('<!--'));
});

test('a SKILL.md that is not complete - the reason, so the start can name it', () => {
  const ok = '---\nname: x\ntools: [a]\n---\n\n## Instructions\n\nDo it.\n';
  const parsed = (t: string) => parseSkill('uiCreator', 'anthropic', t);
  const error = (t: string, part: string) => {
    const p = parsed(t);
    assert.equal(typeof p, 'string', `expected an error for ${JSON.stringify(t)}`);
    assert.ok((p as string).includes(part), `«${p}» should name ${part}`);
  };
  assert.equal((parsed(ok) as Skill).instructions, 'Do it.');
  assert.equal((parsed(ok) as Skill).version, 1);
  error('# no front matter', 'front matter');
  error(ok.replace('name: x\n', ''), 'no name');
  error(ok.replace('tools: [a]\n', ''), 'tools');
  error(ok.replace('name: x', 'name: x\ntask: processCreator'), 'processCreator');
  error(ok.replace('Do it.', '<!-- only a note -->'), 'Instructions');
  error(ok.replace('tools: [a]', 'tools: [a\n'), 'YAML');
  // a field with the wrong type is no silent default
  error(ok.replace('name: x', 'name: x\nrequest:\n  max_tokens: "16000"'), '«request.max_tokens»');
  error(ok.replace('name: x', 'name: x\nrequest:\n  max_tokens: 0'), 'more than 0');
  error(ok.replace('name: x', 'name: x\nversion: "2"'), '«version»');
  error(ok.replace('name: x', 'name: x\ntask: 5'), '«task»');
  error(ok.replace('name: x', 'name: x\nrequest:\n  thinking: 1'), '«request.thinking»');
  error(ok.replace('name: x', 'name: x\nrequest: 5'), '«request»');
  error(ok.replace('name: x', 'name: x\nrequest:\n  thinking: enabled'), 'only adaptive or disabled');
  const s = parsed(ok.replace('name: x', 'name: x\nrequest:\n  max_tokens: 8000\n  effort: low')) as Skill;
  assert.deepEqual([s.maxTokens, s.effort], [8000, 'low']);
});

test('a line «## …» in a code fence or a comment belongs to the instructions; the next section outside ends them', () => {
  const text = '---\nname: x\ntools: [a]\n---\n\n## Instructions\n\nBefore.\n```md\n## Heading of an example\n```\n'
    + '<!-- a note\n## not a section\n-->\nAfter.\n\n## Notes\n\nNot for the model.\n';
  assert.equal((parseSkill('uiCreator', 'anthropic', text) as Skill).instructions, 'Before.\n```md\n## Heading of an example\n```\n\nAfter.');
});

test('tools that are no list, max_tokens not above 0 - 400, not forwarded unchecked', () => {
  assert.equal(bodyOf('{"tools":{"name":"remove_block"}}'), 'the tools are no list');
  assert.equal(bodyOf('{"tools":"remove_block"}'), 'the tools are no list');
  assert.equal(typeof bodyOf('{"tools":null}'), 'object');
  assert.match(bodyOf('{"max_tokens":0}') as string, /max_tokens is no whole number above 0: 0/);
  assert.match(bodyOf('{"max_tokens":-5}') as string, /above 0/);
  assert.match(bodyOf('{"max_tokens":"100"}') as string, /above 0/);
});

test('stream: true - 400, the studio answers with one JSON', () => {
  assert.match(bodyOf(body.replace('"max_tokens":100000,', '"max_tokens":100000,"stream":true,')) as string, /does not stream/);
  assert.equal(typeof bodyOf(body.replace('"max_tokens":100000,', '"stream":false,"max_tokens":100000,')), 'object');
});

test('a body that is no UTF-8 - 400 that says so', () => {
  assert.equal(requestBody(new Uint8Array([0x7b, 0xff, 0x7d]), config(1), skill), 'the body is no UTF-8');
});

test('a base URL that is no http(s) URL: the start names it; set in code: 502, no defect', async () => {
  assert.throws(() => configFromEnv({ STUDIO_AI_ANTHROPIC_API_KEY: 'sk-ant-x', STUDIO_AI_ANTHROPIC_URL: 'api.anthropic.com' }), /STUDIO_AI_ANTHROPIC_URL/);
  const r = await app({ ...config(1), baseUrl: 'no url' }).app.request(fromBrowser(body));
  assert.equal(r.status, 502);
  assert.match(await r.text(), /STUDIO_AI_ANTHROPIC_URL/);
});

test('the Claude API not reachable - 502 in the form of the API', async () => {
  const api = await fakeApi();
  await api.close();
  const { app: a, log } = app(config(api.port));
  const r = await a.request(fromBrowser(body));
  assert.equal(r.status, 502);
  assert.match(await r.text(), /api_error/);
  assert.match(log.lines[0], /^WARN POST \/ai\/uiCreator\/v1\/messages - the Claude API cannot be reached/);
});

test('no answer within the timeout - 504 in the form of the API', async () => {
  const api = await fakeApi(2000);
  try {
    const r = await app(config(api.port), [skill], 100).app.request(fromBrowser(body));
    assert.equal(r.status, 504);
    assert.match(await r.text(), /timeout_error/);
  } finally {
    await api.close();
  }
});

test('the browser goes away - the request to the API ends too, no warning', async () => {
  const api = await fakeApi(2000);
  try {
    const { app: a, log } = app(config(api.port));
    const gone = new AbortController();
    const req = new Request(fromBrowser(body), { signal: gone.signal });
    const pending = a.request(req);
    setTimeout(() => gone.abort(), 100);
    const r = await pending;
    assert.equal(r.status, 499);
    assert.deepEqual(log.lines, []);
  } finally {
    await api.close();
  }
});

test('the settings from the environment - off without a key, the key never in what is logged', () => {
  const env = { STUDIO_AI_ANTHROPIC_API_KEY: ' sk-ant-secret ', STUDIO_AI_ANTHROPIC_WORKSPACE_ID: 'wrkspc_9', STUDIO_AI_ANTHROPIC_URL: 'http://gateway:8080/' };
  const ai = configFromEnv(env).ai!;
  assert.equal(configFromEnv({ STUDIO_AI_ANTHROPIC_API_KEY: '  ' }).ai, undefined);
  assert.equal(ai.apiKey, 'sk-ant-secret');
  assert.equal(ai.workspaceId, 'wrkspc_9');
  assert.equal(ai.model, DEFAULT_MODEL);
  assert.equal(ai.baseUrl, 'http://gateway:8080');
  assert.ok(!describeAi(ai).includes('secret'));
});

test('the other settings from the environment - paths relative to the working directory, a wrong port named', () => {
  const c = configFromEnv({ STUDIO_PORT: '9000', STUDIO_HOST: '0.0.0.0', STUDIO_SITE_DIR: 'docs/site', STUDIO_SKILLS_DIR: '/company/skills' }, '/work');
  assert.deepEqual([c.port, c.host, c.siteDir, c.skillsDir, c.specDir, c.ai], [9000, '0.0.0.0', '/work/docs/site', '/company/skills', undefined, undefined]);
  assert.equal(configFromEnv({}, '/work').port, 8880);
  assert.throws(() => configFromEnv({ STUDIO_PORT: 'x' }), /STUDIO_PORT is no port: «x»/);
  assert.throws(() => configFromEnv({ STUDIO_PORT: '70000' }), /STUDIO_PORT/);
});

test('a skill of the company replaces the studio\'s with the same path; its errors name the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skills-'));
  try {
    mkdirSync(join(dir, 'uiCreator', 'anthropic'), { recursive: true });
    writeFileSync(join(dir, 'uiCreator', 'anthropic', 'SKILL.md'), '---\nname: uiCreator-bank\nversion: 7\ntools: [read_page]\n---\n\n## Instructions\n\nThe bank says.\n');
    const skills = loadSkills('anthropic', [dir, BUILT_IN_SKILLS]) as Skill[];
    assert.deepEqual(skills.map((s) => `${s.task} ${s.name} v${s.version}`), [
      'uiCreator uiCreator-bank v7', 'processCreator processCreator-anthropic v2', 'serviceOrchestrator serviceOrchestrator-anthropic v2',
    ]);
    writeFileSync(join(dir, 'uiCreator', 'anthropic', 'SKILL.md'), '---\ntools: [read_page]\n---\n');
    assert.match(String(loadSkills('anthropic', [dir, BUILT_IN_SKILLS])), /uiCreator\/anthropic\/SKILL\.md: no name/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('at most MAX_PARALLEL requests at the same time - the others wait their turn', async () => {
  const run = limiter(2);
  const open: number[] = [];
  const most = { value: 0 };
  const work = (n: number) => run(async () => {
    open.push(n);
    most.value = Math.max(most.value, open.length);
    await new Promise((r) => setTimeout(r, 20));
    open.splice(open.indexOf(n), 1);
    return n;
  }, new AbortController().signal);
  assert.deepEqual(await Promise.all([1, 2, 3, 4, 5].map(work)), [1, 2, 3, 4, 5]);
  assert.equal(most.value, 2);
  // one that gives up while it waits leaves the queue
  const gone = new AbortController();
  const slow = run(() => new Promise((r) => setTimeout(r, 50)), new AbortController().signal);
  const slow2 = run(() => new Promise((r) => setTimeout(r, 50)), new AbortController().signal);
  const waiting = run(async () => 'ran', gone.signal);
  gone.abort();
  await assert.rejects(waiting);
  await Promise.all([slow, slow2]);
});
