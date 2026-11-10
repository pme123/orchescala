// The tasks of the AI and their skills (E23). A task is offered only if the studio has a skill for it
// and its provider: `<skills>/<task>/<provider>/SKILL.md`. The skill holds the constraints, the steps
// and the instructions for the model - written to be reviewed by a bank.
//
// The studio applies what it can per request (see ai.ts): the instructions, the model, the settings of
// `request` and the tools. The limits per turn and per person come with the agent on the server.
//
// The studio brings its skills (skills/ next to src/); a company adds one - or replaces one - with the
// same path in its own folder (`STUDIO_SKILLS_DIR`), which comes first.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CORE_SCHEMA, load } from 'js-yaml';

/** The tasks orch-spec knows - each has its place in the UI. */
export const TASKS = [
  /** the pages of an app, in the page designer */
  'uiCreator',
  /** the processes, in the process view */
  'processCreator',
  /** a service orchestration - one worker that calls services, in the process view in service mode */
  'serviceOrchestrator',
  /** a service from an OpenAPI, in the catalog */
  'serviceRegistration',
  /** a new service collection */
  'serviceCreator',
] as const;
export type Task = (typeof TASKS)[number];

/** A skill as the studio applies it. */
export type Skill = {
  task: Task;
  provider: string;
  name: string;
  version: number;
  /** without one, the model of the studio (`STUDIO_AI_MODEL`) */
  model?: string;
  /** `request.max_tokens` - the most a request may ask for */
  maxTokens?: number;
  /** `request.thinking`, e.g. `adaptive` */
  thinking?: string;
  /** `request.effort`, e.g. `medium` */
  effort?: string;
  /** `request.fallbacks`, e.g. `default` - another Claude model answers if a safety filter declines */
  fallbacks?: string;
  /** the only tools a request may offer the model */
  tools: string[];
  /** the section `## Instructions` - the first part of the system of every request */
  instructions: string;
};

export const skillLabel = (s: Skill) => `${s.name} v${s.version}`;

/** The skills the studio brings. */
export const BUILT_IN_SKILLS = resolve(import.meta.dirname, '..', 'skills');

/** The values of `request.thinking` the studio can send as they are - `enabled` would need
  * budget_tokens, and the API refuses it per request. */
export const THINKING_TYPES = ['adaptive', 'disabled'];

export const skillPath = (task: Task, provider: string) => join(task, provider, 'SKILL.md');

/** The skills for `provider` - from the first folder that has one for the task - or what is wrong
  * with one of them (the start names it). */
export function loadSkills(provider: string, dirs: string[] = [BUILT_IN_SKILLS]): Skill[] | string {
  const found = TASKS.flatMap((task) => {
    const file = dirs.map((d) => join(d, skillPath(task, provider))).find((f) => existsSync(f));
    return file ? [{ task, file }] : [];
  });
  const parsed = found.map(({ task, file }) => {
    try {
      const skill = parseSkill(task, provider, readFileSync(file, 'utf8'));
      return typeof skill === 'string' ? `${file}: ${skill}` : skill;
    } catch (e) {
      return `${file} cannot be read: ${e instanceof Error ? e.message : String(e)}`;
    }
  });
  return parsed.find((p): p is string => typeof p === 'string') ?? (parsed as Skill[]);
}

type Fields = Record<string, unknown>;
const isFields = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A `SKILL.md`: the front matter (YAML between two lines `---`) and the section `## Instructions` -
  * or what is missing. A field that is there has its type: a wrong one is no silent default. */
export function parseSkill(task: Task, provider: string, text: string): Skill | string {
  const lines = text.split(/\r?\n/);
  const end = lines[0]?.trim() === '---' ? lines.findIndex((l, i) => i > 0 && l.trim() === '---') : -1;
  if (end <= 0) return 'no front matter between two lines ---';
  const head = (() => {
    try {
      return { value: load(lines.slice(1, end).join('\n'), { schema: CORE_SCHEMA }) };
    } catch (e) {
      return { error: `the front matter is no YAML: ${e instanceof Error ? e.message : String(e)}` };
    }
  })();
  if ('error' in head) return head.error as string;
  const c: Fields = isFields(head.value) ? head.value : {};
  const request = c.request ?? null;
  if (request !== null && !isFields(request)) return '«request» is no object';
  const r: Fields = isFields(request) ? request : {};

  const wrong = (field: string, v: unknown) => `«${field}» has the wrong type: ${JSON.stringify(v)}`;
  type Read<T> = { ok: T | undefined } | { error: string };
  const text_ = (fields: Fields, field: string, prefix = ''): Read<string> => {
    const v = fields[field];
    if (v === undefined || v === null) return { ok: undefined };
    return typeof v === 'string' ? { ok: v.trim() || undefined } : { error: wrong(prefix + field, v) };
  };
  // a whole number - not a text with one («"16000"»)
  const int = (fields: Fields, field: string, prefix = ''): Read<number> => {
    const v = fields[field];
    if (v === undefined || v === null) return { ok: undefined };
    return Number.isInteger(v) ? { ok: v as number } : { error: wrong(prefix + field, v) };
  };
  const value = <T,>(read: Read<T>) => ('ok' in read ? read.ok : undefined);
  const reads = {
    task: text_(c, 'task'), provider: text_(c, 'provider'), version: int(c, 'version'), model: text_(c, 'model'),
    maxTokens: int(r, 'max_tokens', 'request.'), thinking: text_(r, 'thinking', 'request.'),
    effort: text_(r, 'effort', 'request.'), fallbacks: text_(r, 'fallbacks', 'request.'),
  };

  if (typeof c.name !== 'string' || !c.name.trim()) return 'no name in the front matter';
  const firstError = Object.values(reads).find((x): x is { error: string } => 'error' in x);
  if (firstError) return firstError.error;
  const ofTask = value(reads.task);
  if (ofTask !== undefined && ofTask !== task) return `task «${ofTask}» is not the task of its path «${task}»`;
  const ofProvider = value(reads.provider);
  if (ofProvider !== undefined && ofProvider !== provider) return `provider «${ofProvider}» is not the provider of its path «${provider}»`;
  const maxTokens = value(reads.maxTokens);
  if (maxTokens !== undefined && maxTokens <= 0) return `«request.max_tokens» must be more than 0: ${maxTokens}`;
  const thinking = value(reads.thinking);
  if (thinking !== undefined && !THINKING_TYPES.includes(thinking)) return `«request.thinking» is «${thinking}» - only ${THINKING_TYPES.join(' or ')}`;
  if (!Array.isArray(c.tools) || !c.tools.every((t) => typeof t === 'string')) return 'no list of tools in the front matter';
  const instructions = instructionsOf(lines.slice(end + 1));
  if (!instructions) return 'no text in the section ## Instructions';

  const optional = <K extends string, V>(key: K, v: V | undefined) => (v === undefined ? {} : { [key]: v } as Record<K, V>);
  return {
    task, provider, name: c.name.trim(), version: value(reads.version) ?? 1,
    ...optional('model', value(reads.model)),
    ...optional('maxTokens', maxTokens),
    ...optional('thinking', thinking),
    ...optional('effort', value(reads.effort)),
    ...optional('fallbacks', value(reads.fallbacks)),
    tools: c.tools as string[],
    instructions,
  };
}

/** The text of `## Instructions` up to the next section - without HTML comments (notes for people).
  * A line `## …` in a code fence or in a comment belongs to the text; it does not end the section. */
function instructionsOf(body: string[]): string | undefined {
  const start = body.findIndex((l) => /^##\s+Instructions\s*$/.test(l.trim()));
  if (start < 0) return undefined;
  // the comments first - a line «## …» in one must not end the section
  const rest = body.slice(start + 1).join('\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const isFence = (l: string) => l.trim().startsWith('```') || l.trim().startsWith('~~~');
  // in a fence before each line?
  const inFence = rest.reduce<boolean[]>((open, l) => [...open, isFence(l) ? !open[open.length - 1] : open[open.length - 1]], [false]);
  const endAt = rest.findIndex((l, i) => !inFence[i] && l.startsWith('## '));
  const textOf = rest.slice(0, endAt < 0 ? rest.length : endAt).join('\n').trim();
  return textOf || undefined;
}
