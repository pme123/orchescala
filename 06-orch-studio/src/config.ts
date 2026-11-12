// The settings of a company's studio - all from the environment. The company configures the image
// (E28), it does not build one: its documentation, the folders of orch-spec and orch-ops, its skills
// and the key of the AI. A wrong setting ends the start with one line that names it.
import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

/** The AI of the studio (E23) - the key stays on the server. orch-spec only learns that the AI is on
  * and which model answers (`GET /ai/config`); its agent runs on the studio (see ai.ts). */
export type AiConfig = {
  /** the key of the Claude API - the company's, not a person's */
  apiKey: string;
  /** only for a key that is not scoped to a workspace - the API then wants it */
  workspaceId?: string;
  /** the model of a skill that names none - whatever orch-spec sends */
  model: string;
  /** the Claude API - another one for a gateway of the company (or a test) */
  baseUrl: string;
};

export type StudioConfig = {
  port: number;
  /** the address it listens on - `localhost` while there is no login (PoC); `0.0.0.0` in a container */
  host: string;
  /** orch-doc, orch-spec and orch-ops as Orchescala builds them (04-orch-doc/bundle/orch-doc-site) */
  appsDir: string;
  /** the company's documentation (e.g. `00-docs/site` after prepareDocs) - none: the apps without it */
  siteDir?: string;
  /** the company folders of orch-spec and orch-ops - shown on their start screen */
  specDir?: string;
  opsDir?: string;
  /** the skills of the company - one there wins over the studio's with the same path */
  skillsDir?: string;
  /** the AI - none: off, orch-spec shows nothing of AI */
  ai?: AiConfig;
};

/** Next to the gateways of the demo (8889) and the preview (8890); the stack studio/ maps it to 8881. */
export const DEFAULT_PORT = 8880;
export const DEFAULT_MODEL = 'claude-opus-5-5';
export const ANTHROPIC_URL = 'https://api.anthropic.com';
/** In the image: the apps next to the studio (see Dockerfile). */
export const DEFAULT_APPS_DIR = resolve(import.meta.dirname, '..', 'apps');

type Env = Record<string, string | undefined>;

/** The base URL of the Claude API as `new URL` reads it - or why it is none. */
export function apiUrl(baseUrl: string): URL | string {
  try {
    const url = new URL(`${baseUrl}/v1/messages`);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname ? url : `STUDIO_AI_ANTHROPIC_URL is no http(s) URL: «${baseUrl}»`;
  } catch {
    return `STUDIO_AI_ANTHROPIC_URL is no http(s) URL: «${baseUrl}»`;
  }
}

/** The AI from the environment - none without `STUDIO_AI_ANTHROPIC_API_KEY`: then it is off.
  *   - `STUDIO_AI_ANTHROPIC_API_KEY` the key (the switch)
  *   - `STUDIO_AI_ANTHROPIC_WORKSPACE_ID` only if the API asks for it
  *   - `STUDIO_AI_MODEL` default DEFAULT_MODEL
  *   - `STUDIO_AI_ANTHROPIC_URL` default ANTHROPIC_URL - one that is no http(s) URL ends the start */
export function aiFromEnv(env: Env): AiConfig | undefined {
  const get = (name: string) => env[name]?.trim() || undefined;
  const apiKey = get('STUDIO_AI_ANTHROPIC_API_KEY');
  if (!apiKey) return undefined;
  const baseUrl = get('STUDIO_AI_ANTHROPIC_URL')?.replace(/\/+$/, '') ?? ANTHROPIC_URL;
  const url = apiUrl(baseUrl);
  if (typeof url === 'string') throw new Error(url);
  const workspaceId = get('STUDIO_AI_ANTHROPIC_WORKSPACE_ID');
  return { apiKey, ...(workspaceId ? { workspaceId } : {}), model: get('STUDIO_AI_MODEL') ?? DEFAULT_MODEL, baseUrl };
}

/** The settings from the environment: `STUDIO_PORT`, `STUDIO_HOST`, `STUDIO_APPS_DIR`, `STUDIO_SITE_DIR`,
  * `STUDIO_SPEC_DIR`, `STUDIO_OPS_DIR`, `STUDIO_SKILLS_DIR` (paths absolute or relative to `cwd`; a folder
  * of the company that is set must exist) and the AI (`STUDIO_AI_*`, see aiFromEnv). */
export function configFromEnv(env: Env = process.env, cwd = process.cwd()): StudioConfig {
  const get = (name: string) => env[name]?.trim() || undefined;
  const path = (name: string) => {
    const p = get(name);
    return p === undefined ? undefined : isAbsolute(p) ? p : resolve(cwd, p);
  };
  const portText = get('STUDIO_PORT');
  const port = portText === undefined ? DEFAULT_PORT : Number(portText);
  if (!Number.isInteger(port) || port <= 0 || port >= 65536) throw new Error(`STUDIO_PORT is no port: «${portText}»`);
  // a folder of the company that is set must be there - a typo would drop its documentation or replace
  // its reviewed skills by the studio's without a word
  const optional = (key: keyof StudioConfig, name: string) => {
    const p = path(name);
    if (p === undefined) return {};
    const isDir = (() => { try { return statSync(p).isDirectory(); } catch { return false; } })();
    if (!isDir) throw new Error(`${name} is no folder: «${p}»`);
    return { [key]: p };
  };
  const ai = aiFromEnv(env);
  return {
    port,
    host: get('STUDIO_HOST') ?? 'localhost',
    appsDir: path('STUDIO_APPS_DIR') ?? DEFAULT_APPS_DIR,
    ...optional('siteDir', 'STUDIO_SITE_DIR'),
    ...optional('specDir', 'STUDIO_SPEC_DIR'),
    ...optional('opsDir', 'STUDIO_OPS_DIR'),
    ...optional('skillsDir', 'STUDIO_SKILLS_DIR'),
    ...(ai ? { ai } : {}),
  };
}

/** The AI for the log - never the key. */
export const describeAi = (ai: AiConfig) =>
  `anthropic, ${ai.model}${ai.workspaceId ? `, workspace ${ai.workspaceId}` : ''}, ${ai.baseUrl}`;
