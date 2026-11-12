// The AI of the studio - its settings, the skills and how a request of the loop becomes one as the skill
// wants it (skillRequest). The turn itself, with a fake Claude API: turn.test.ts.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MAX_TOKENS, configJson, limiter, skillRequest } from '../src/ai.ts';
import { studioApp } from '../src/app.ts';
import { configFromEnv, describeAi, DEFAULT_MODEL, type AiConfig } from '../src/config.ts';
import { memoryLog } from '../src/log.ts';
import { siteOf } from '../src/site.ts';
import { BUILT_IN_SKILLS, loadSkills, parseSkill, type Skill } from '../src/skills.ts';

const config = (port: number, apiKey = 'sk-ant-studio'): AiConfig =>
  ({ apiKey, workspaceId: 'wrkspc_1', model: 'claude-test', baseUrl: `http://localhost:${port}` });

/** A skill of the test - its settings differ from those the loop sends. */
const skill: Skill = {
  task: 'uiCreator', provider: 'anthropic', name: 'uiCreator-test', version: 2, model: 'claude-skill', maxTokens: 16000,
  thinking: 'adaptive', effort: 'medium', fallbacks: 'default', tools: ['read_page', 'check_page'], instructions: 'Do as the skill says.',
};

const app = (ai: AiConfig | undefined, skills: Skill[] = [skill]) => studioApp({ site: siteOf([]), ai, skills, log: memoryLog() });

/** What the loop sends: the context as system (no instructions), its tools, its settings. */
const body = JSON.stringify({
  model: 'claude-opus-5-5', max_tokens: 100000,
  system: [{ type: 'text', text: 'the catalog', cache_control: { type: 'ephemeral' } }],
  tools: [{ name: 'read_page', input_schema: { type: 'object' } }],
  output_config: { effort: 'high' },
  messages: [{ role: 'user', content: 'Hallo' }],
});

type Sent = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const bodyOf = (b: string, s = skill, ai = config(1)) => skillRequest(JSON.parse(b) as Record<string, unknown>, ai, s);
const sentOf = (b: string, s = skill, ai = config(1)) => bodyOf(b, s, ai) as Sent;

test('GET /ai/config - on with provider, model and the tasks with their skill, never the key; off without a key', async () => {
  const on = await (await app(config(1)).request('/ai/config')).text();
  const off = await (await app(undefined).request('/ai/config')).text();
  assert.equal(on, '{"enabled":true,"provider":"anthropic","model":"claude-test","tasks":["uiCreator"],"skills":{"uiCreator":{"name":"uiCreator-test","version":2,"model":"claude-skill"}}}');
  assert.ok(!on.includes('sk-ant'));
  assert.equal(off, '{"enabled":false}');
});

test('a tool that is not in the skill or has no name - refused with its name, the skill named', () => {
  const foreign = bodyOf(body.replace('"name":"read_page"', '"name":"remove_block"')) as string;
  assert.ok(foreign.includes('«remove_block»') && foreign.includes('uiCreator-test v2'));
  assert.match(bodyOf(body.replace('"name":"read_page",', '')) as string, /\(without name\)/);
});

test('the system of the loop - a text, none or something else', () => {
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

test('a skill without model and settings - the model of the studio, none of the loop\'s settings', () => {
  const { model: _m, thinking: _t, effort: _e, fallbacks: _f, ...bare } = skill;
  const loop = body.replace('"output_config":{"effort":"high"}',
    '"output_config":{"effort":"high","format":"x"},"thinking":{"type":"enabled","budget_tokens":9},"fallbacks":"default"');
  const sent = sentOf(loop, bare);
  const full = sentOf(loop);
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

test('tools that are no list, max_tokens not above 0 - refused, not forwarded unchecked', () => {
  assert.equal(bodyOf('{"tools":{"name":"remove_block"}}'), 'the tools are no list');
  assert.equal(bodyOf('{"tools":"remove_block"}'), 'the tools are no list');
  assert.equal(typeof bodyOf('{"tools":null}'), 'object');
  assert.match(bodyOf('{"max_tokens":0}') as string, /max_tokens is no whole number above 0: 0/);
  assert.match(bodyOf('{"max_tokens":-5}') as string, /above 0/);
  assert.match(bodyOf('{"max_tokens":"100"}') as string, /above 0/);
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
  // a base URL that is no http(s) URL ends the start
  assert.throws(() => configFromEnv({ STUDIO_AI_ANTHROPIC_API_KEY: 'sk-ant-x', STUDIO_AI_ANTHROPIC_URL: 'api.anthropic.com' }), /STUDIO_AI_ANTHROPIC_URL/);
});

test('the other settings from the environment - paths relative to the working directory, a wrong port named', () => {
  const work = mkdtempSync(join(tmpdir(), 'work-'));
  try {
    mkdirSync(join(work, 'docs', 'site'), { recursive: true });
    mkdirSync(join(work, 'skills'));
    const c = configFromEnv({ STUDIO_PORT: '9000', STUDIO_HOST: '0.0.0.0', STUDIO_SITE_DIR: 'docs/site', STUDIO_SKILLS_DIR: join(work, 'skills') }, work);
    assert.deepEqual([c.port, c.host, c.siteDir, c.skillsDir, c.specDir, c.ai], [9000, '0.0.0.0', join(work, 'docs', 'site'), join(work, 'skills'), undefined, undefined]);
    // a folder of the company that is not there ends the start - its reviewed skills are not replaced unseen
    for (const name of ['STUDIO_SITE_DIR', 'STUDIO_SPEC_DIR', 'STUDIO_OPS_DIR', 'STUDIO_SKILLS_DIR'])
      assert.throws(() => configFromEnv({ [name]: 'missing' }, work), new RegExp(`${name} is no folder: «${join(work, 'missing')}»`));
    writeFileSync(join(work, 'a-file'), '');
    assert.throws(() => configFromEnv({ STUDIO_SKILLS_DIR: 'a-file' }, work), /STUDIO_SKILLS_DIR is no folder/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
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
