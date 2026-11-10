// The AI mode (E19, E23): the studio is the switch. Its settings (STUDIO_AI_ANTHROPIC_API_KEY …) turn
// the AI on; orch-spec asks `GET /ai/config` once and learns only on/off, provider, model and the
// tasks with their skill - never the key. Each place shows its AI only if its task is among them (the
// page designer `uiCreator`, the process view `processCreator`, in service mode `serviceOrchestrator`). The requests of the agent go
// through the studio to the route of their task (`/ai/uiCreator`, see client.ts); there the skill
// adds its instructions and decides model and settings.
//
// Without a studio (a folder of the docs, GitHub Pages, the dev server without ORCH_SPEC_STUDIO) the
// request fails - then the AI is off and nothing of it is visible. orch-spec stays fully usable.
//
// Here what the config is and how it is read - no React, no browser (part of src/core); the hook
// that asks the studio once per page is in useAiConfig.ts.

/** The tasks orch-spec has a place for - the studio offers those it has a skill for. */
export const AI_TASKS = ['uiCreator', 'processCreator', 'serviceOrchestrator', 'serviceRegistration', 'serviceCreator'] as const;
export type AiTask = (typeof AI_TASKS)[number];

/** What the RE reads about a task. */
export const TASK_LABEL: Record<AiTask, string> = {
  uiCreator: 'Seiten (UI-Creator)',
  processCreator: 'Prozesse',
  serviceOrchestrator: 'Service-Orchestrierungen',
  serviceRegistration: 'Service registrieren',
  serviceCreator: 'Service erstellen',
};

/** The skill of a task in the studio - for the dialog. */
export type AiSkill = { name: string; version?: number; model?: string };

export type AiConfig = {
  enabled: boolean;
  /** only `anthropic` for now */
  provider?: string;
  /** the model the studio asks - for the costs and the hint in the dialog */
  model?: string;
  /** the tasks with a skill in the studio - only they show AI */
  tasks: AiTask[];
  /** the skill of each of these tasks */
  skills: Partial<Record<AiTask, AiSkill>>;
};

export const AI_OFF: AiConfig = { enabled: false, tasks: [], skills: {} };

/** On the origin of the page - the studio serves orch-spec and these paths. */
export const CONFIG_PATH = '/ai/config';
/** The base URL of the Messages API for the SDK - one per task; the studio applies its skill and
  * sends it on with its key. A task without a skill is refused (403). */
export const messagesBase = (task: AiTask) => `/ai/${task}`;

/** The answer of `GET /ai/config` - anything unexpected counts as off. */
export function parseConfig(json: unknown): AiConfig {
  if (!json || typeof json !== 'object') return AI_OFF;
  const o = json as Record<string, unknown>;
  if (o.enabled !== true) return AI_OFF;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const tasks = Array.isArray(o.tasks) ? AI_TASKS.filter((t) => (o.tasks as unknown[]).includes(t)) : [];
  const all = o.skills && typeof o.skills === 'object' ? (o.skills as Record<string, unknown>) : {};
  const skills = Object.fromEntries(tasks.flatMap((t) => {
    const s = all[t] && typeof all[t] === 'object' ? (all[t] as Record<string, unknown>) : {};
    const name = text(s.name);
    return name ? [[t, { name, version: typeof s.version === 'number' ? s.version : undefined, model: text(s.model) }]] : [];
  })) as Partial<Record<AiTask, AiSkill>>;
  return { enabled: true, provider: text(o.provider), model: text(o.model), tasks, skills };
}

/** Asks the studio - every failure (no studio, 404, no JSON) is «off». */
export async function loadConfig(fetchFn: typeof fetch = fetch): Promise<AiConfig> {
  try {
    const r = await fetchFn(CONFIG_PATH, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!r.ok) return AI_OFF;
    return parseConfig(await r.json());
  } catch {
    return AI_OFF;
  }
}

/** Is the AI on for `task` - on in the studio and a skill for the task? */
export const aiFor = (config: AiConfig, task: AiTask): boolean => config.enabled && config.tasks.includes(task);

/** Is there AI anywhere - the icon in the header. */
export const anyAi = (config: AiConfig): boolean => config.enabled && config.tasks.length > 0;
