// The AI of the studio (E23): the key is on the server, orch-spec runs its agent and sends each
// request of it through here - to the route of its task, where the studio applies the skill.
//
//   - `GET /ai/config` - `{"enabled": true, "provider": "anthropic", "model": …, "tasks": [...],
//     "skills": {"uiCreator": {"name", "version", "model"}}}` or `{"enabled": false}`; never the key.
//     orch-spec shows the AI of a task only if it is in `tasks` - the tasks with a skill (skills.ts).
//   - `POST /ai/<task>/v1/messages` - a request of the Messages API for the task, sent on with the key
//     (and workspace) of the studio. A task without a skill is refused (403). The skill decides: its
//     instructions come first in the system (orch-spec sends only the context - catalog, data model),
//     its model and `request` settings replace those of the browser, and a tool that is not in the
//     skill is refused (400). The answer - also an error of the API - goes back as it is, so the SDK in
//     the browser reads it as usual.
//
// Later: the agent on the server with the limits of the skill (steps, corrections, costs) and the AI
// per person. Without login for now (PoC, the studio listens on localhost) - whoever reaches the studio
// uses its key.
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Hono } from 'hono';
import { apiUrl, type AiConfig } from './config.ts';
import { skillLabel, type Skill } from './skills.ts';
import type { Log } from './log.ts';

/** The request of the browser holds the spec (pages, data model, catalog) and the chat - a few
  * 100 kB; 8 MB leaves room. */
export const MAX_BODY = 8 * 1024 * 1024;
/** The most a request may ask for - also if a skill allows more. */
export const MAX_TOKENS = 32000;
/** Requests to the API at the same time - more wait. */
export const MAX_PARALLEL = 8;
/** A request with thinking can take minutes; the SDK in the browser waits 10. */
export const TIMEOUT_MS = 10 * 60 * 1000;
export const ANTHROPIC_VERSION = '2023-06-01';
/** The beta of `fallbacks` - the studio sets it when the skill asks for fallbacks. */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
export const PROVIDER = 'anthropic';

/** The message orch-spec recognizes: the AI was switched off on the server meanwhile. */
export const OFF_MESSAGE = 'the AI of the studio is off (STUDIO_AI_ANTHROPIC_API_KEY)';
/** The message orch-spec recognizes: the task has no skill in the studio. */
export const NO_SKILL_MESSAGE = 'no skill in the studio for the task';

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The model of the skill - or of the studio, if the skill names none. */
export const modelOf = (ai: AiConfig, skill: Skill) => skill.model ?? ai.model;

/** What orch-spec may know: on or off, provider, model and the tasks with their skill - never the key. */
export function configJson(ai: AiConfig | undefined, skills: Skill[]): Json {
  if (!ai) return { enabled: false };
  return {
    enabled: true,
    provider: PROVIDER,
    model: ai.model,
    tasks: skills.map((s) => s.task),
    skills: Object.fromEntries(skills.map((s) => [s.task, { name: s.name, version: s.version, model: modelOf(ai, s) }])),
  };
}

/** The system of the browser as blocks - a text, a list of blocks or none. */
function systemOf(system: unknown): Json[] | string {
  if (system === undefined || system === null) return [];
  if (typeof system === 'string') return system.trim() ? [{ type: 'text', text: system }] : [];
  if (Array.isArray(system)) return system as Json[];
  return 'the system is neither a text nor a list of blocks';
}

/** The body for the API as the skill wants it: its instructions first in the system, its model and
  * settings, `max_tokens` at most what the skill (and MAX_TOKENS) allows - and only its tools. */
export function requestBody(bytes: Uint8Array, ai: AiConfig, skill: Skill): Json | string {
  const text = (() => { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return undefined; } })();
  if (text === undefined) return 'the body is no UTF-8';
  const json = (() => { try { return { value: JSON.parse(text) as unknown }; } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; } })();
  if ('error' in json) return `the body is no JSON: ${json.error}`;
  const obj = json.value;
  if (!isObject(obj)) return 'the body is no JSON object';
  // the answer goes back as one JSON - a stream would be buffered and sent as JSON, which the SDK cannot read
  if (obj.stream === true) return 'the studio does not stream (stream: true)';
  const system = systemOf(obj.system);
  if (typeof system === 'string') return system;
  // a list of tools or none - anything else would pass the check below unseen
  if (obj.tools !== undefined && obj.tools !== null && !Array.isArray(obj.tools)) return 'the tools are no list';
  const tools = Array.isArray(obj.tools) ? obj.tools : [];
  const names = tools.map((t) => (isObject(t) && typeof t.name === 'string' ? t.name : undefined));
  const foreign = names.filter((n) => n === undefined || !skill.tools.includes(n)).map((n) => n ?? '(without name)');
  if (foreign.length) return `the tools ${foreign.map((n) => `«${n}»`).join(', ')} are not in the skill ${skillLabel(skill)}`;

  if (obj.max_tokens !== undefined && obj.max_tokens !== null && !(Number.isInteger(obj.max_tokens) && (obj.max_tokens as number) > 0))
    return `max_tokens is no whole number above 0: ${JSON.stringify(obj.max_tokens)}`;
  const limit = Math.min(skill.maxTokens ?? MAX_TOKENS, MAX_TOKENS);
  const tokens = Number.isInteger(obj.max_tokens) ? Math.min(obj.max_tokens as number, limit) : limit;
  // no breakpoint of its own: the next block (the catalog) caches it along
  const first = { type: 'text', text: skill.instructions };
  // thinking, effort and fallbacks are the skill's - without them in the skill, the defaults of the API
  const { effort: _effort, ...output } = isObject(obj.output_config) ? obj.output_config : {};
  const outputConfig = skill.effort ? { ...output, effort: skill.effort } : output;
  const { thinking: _thinking, output_config: _output, fallbacks: _fallbacks, ...ofBrowser } = obj;
  return {
    ...ofBrowser,
    model: modelOf(ai, skill),
    max_tokens: tokens,
    system: [first, ...system],
    ...(skill.thinking ? { thinking: { type: skill.thinking } } : {}),
    ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
    ...(skill.fallbacks ? { fallbacks: skill.fallbacks } : {}),
  };
}

/** An error in the form of the Claude API - the SDK in the browser reads it like one of the API. */
export const apiError = (status: number, type: string, message: string) =>
  new Response(JSON.stringify({ type: 'error', error: { type, message } }), { status, headers: { 'content-type': 'application/json' } });

/** The tokens of an answer for the log - nothing if it has none (an error). */
function usageText(body: Buffer): string {
  try {
    const u = (JSON.parse(body.toString('utf8')) as Json).usage;
    if (!isObject(u)) return '';
    const n = (f: string) => (typeof u[f] === 'number' ? u[f] : 0);
    return `, tokens in ${n('input_tokens')} (cache read ${n('cache_read_input_tokens')}, written ${n('cache_creation_input_tokens')}), out ${n('output_tokens')}`;
  } catch {
    return '';
  }
}

/** At most `max` at the same time; the others wait in order. */
export function limiter(max: number) {
  const waiting: (() => void)[] = [];
  const running = new Set<symbol>();
  const next = () => {
    if (running.size < max) waiting.shift()?.();
  };
  return async <T,>(work: () => Promise<T>, signal: AbortSignal): Promise<T> => {
    const me = Symbol('request');
    await new Promise<void>((go, stop) => {
      const start = () => { signal.removeEventListener('abort', cancel); running.add(me); go(); };
      const cancel = () => { const i = waiting.indexOf(start); if (i >= 0) waiting.splice(i, 1); stop(signal.reason); };
      if (signal.aborted) return stop(signal.reason);
      signal.addEventListener('abort', cancel, { once: true });
      waiting.push(start);
      next();
    });
    try {
      return await work();
    } finally {
      running.delete(me);
      next();
    }
  };
}

type Answer = { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer };

/** POST to the Claude API with node:http(s) - no timeout of its own (fetch gives up after 5 minutes
  * without headers); `signal` ends it. */
function post(url: URL, headers: Record<string, string>, body: string, signal: AbortSignal): Promise<Answer> {
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((done, failed) => {
    const req = send(url, { method: 'POST', headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) }, signal }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done({ status: res.statusCode ?? 502, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', failed);
    });
    req.on('error', failed);
    req.end(body);
  });
}

/** The body of the request, at most `max` bytes - also a chunked one; undefined if it is larger. */
async function readBody(req: Request, max: number): Promise<Uint8Array | undefined> {
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  const read = async (size: number): Promise<number | undefined> => {
    const { done, value } = await reader.read();
    if (done) return size;
    if (size + value.length > max) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
    return read(size + value.length);
  };
  const size = await read(0);
  return size === undefined ? undefined : Buffer.concat(chunks, size);
}

/** `skills`: the skills of the tasks - none count if the AI is off. */
export function aiRoutes(app: Hono, ai: AiConfig | undefined, skills: Skill[], log: Log, timeoutMs = TIMEOUT_MS) {
  const active = ai ? skills : [];
  const config = JSON.stringify(configJson(ai, active));
  const limit = limiter(MAX_PARALLEL);
  const tooLarge = () => apiError(413, 'request_too_large', `the body is larger than ${MAX_BODY} bytes`);

  app.get('/ai/config', () => new Response(config, { headers: { 'content-type': 'application/json' } }));

  app.post('/ai/:task/v1/messages', async (c) => {
    const req = c.req.raw;
    const task = c.req.param('task');
    const skill = active.find((s) => s.task === task);
    if (!ai) return apiError(404, 'not_found_error', OFF_MESSAGE);
    if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return tooLarge();
    if (!skill) return apiError(403, 'permission_error', `${NO_SKILL_MESSAGE} «${task}»`);
    const bytes = await readBody(req, MAX_BODY).catch(() => null);
    if (bytes === null) return apiError(400, 'invalid_request_error', 'the body cannot be read');
    if (bytes === undefined) return tooLarge();
    const body = requestBody(bytes, ai, skill);
    if (typeof body === 'string') return apiError(400, 'invalid_request_error', body);
    const base = apiUrl(ai.baseUrl);
    if (typeof base === 'string') {
      log.warn(base);
      return apiError(502, 'api_error', base);
    }
    // `?beta=true` of the SDK
    const url = new URL(`${base.href}${new URL(req.url).search}`);
    // the betas of the browser and the one the skill needs
    const betas = [...new Set([
      ...(req.headers.get('anthropic-beta') ?? '').split(',').map((b) => b.trim()).filter(Boolean),
      ...(skill.fallbacks ? [FALLBACK_BETA] : []),
    ])];
    const headers: Record<string, string> = {
      'x-api-key': ai.apiKey,
      'anthropic-version': req.headers.get('anthropic-version') ?? ANTHROPIC_VERSION,
      'content-type': 'application/json',
      ...(betas.length ? { 'anthropic-beta': betas.join(',') } : {}),
      ...(ai.workspaceId ? { 'anthropic-workspace-id': ai.workspaceId } : {}),
    };
    const path = `POST /ai/${task}/v1/messages`;
    // the timeout covers the wait for a turn too, so a request behind slow ones does not wait without end
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([timeout, req.signal]);
    const start = Date.now();
    try {
      const answer = await limit(() => post(url, headers, JSON.stringify(body), signal), signal);
      // who asked comes with the login; no content - only skill, model, status, time and tokens
      log.info(`${path} - ${skillLabel(skill)}, ${modelOf(ai, skill)}: ${answer.status} in ${Date.now() - start} ms${usageText(answer.body)}`);
      const requestId = answer.headers['request-id'];
      return new Response(new Uint8Array(answer.body), {
        status: answer.status,
        headers: { 'content-type': 'application/json', ...(typeof requestId === 'string' ? { 'request-id': requestId } : {}) },
      });
    } catch (e) {
      // the browser went away: nobody waits for an answer - no 502, no warning
      if (req.signal.aborted) return new Response(null, { status: 499 });
      const [status, type, text] = timeout.aborted
        ? [504, 'timeout_error', `no answer of the Claude API within ${timeoutMs / 60000} minutes`]
        : [502, 'api_error', 'the Claude API cannot be reached from the studio'];
      log.warn(`${path} - ${text}: ${e instanceof Error ? e.message : String(e)}`);
      return apiError(status, type, text);
    }
  });
}
