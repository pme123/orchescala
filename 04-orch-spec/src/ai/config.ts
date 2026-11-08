// The AI mode (E19, E23): the studio is the switch. Its settings (STUDIO_AI_ANTHROPIC_API_KEY …) turn
// the AI on; orch-spec asks `GET /ai/config` once and learns only on/off, provider, model and the
// tasks with a skill - never the key. Each place shows its AI only if its task is among them (the
// page designer `uiCreator`, the process view `processCreator`). The requests of the agent go
// through the studio (`/ai/anthropic`, see client.ts), with their task in a header.
//
// Without a studio (a folder of the docs, GitHub Pages, the dev server without ORCH_SPEC_STUDIO) the
// request fails - then the AI is off and nothing of it is visible. orch-spec stays fully usable.
import { useSyncExternalStore } from 'react';

/** The tasks orch-spec has a place for - the studio offers those it has a skill for. */
export const AI_TASKS = ['uiCreator', 'processCreator', 'serviceRegistration', 'serviceCreator'] as const;
export type AiTask = (typeof AI_TASKS)[number];

/** What the RE reads about a task. */
export const TASK_LABEL: Record<AiTask, string> = {
  uiCreator: 'Seiten (UI-Creator)',
  processCreator: 'Prozesse',
  serviceRegistration: 'Service registrieren',
  serviceCreator: 'Service erstellen',
};

export type AiConfig = {
  enabled: boolean;
  /** only `anthropic` for now */
  provider?: string;
  /** the model the studio asks - for the costs and the hint in the dialog */
  model?: string;
  /** the tasks with a skill in the studio - only they show AI */
  tasks: AiTask[];
};

export const AI_OFF: AiConfig = { enabled: false, tasks: [] };

/** The header with the task of a request - the studio refuses a task without a skill. */
export const TASK_HEADER = 'x-orch-task';

/** On the origin of the page - the studio serves orch-spec and these paths. */
export const CONFIG_PATH = '/ai/config';
/** The base URL of the Messages API for the SDK - the studio sends it on with its key. */
export const MESSAGES_BASE = '/ai/anthropic';

/** The answer of `GET /ai/config` - anything unexpected counts as off. */
export function parseConfig(json: unknown): AiConfig {
  if (!json || typeof json !== 'object') return AI_OFF;
  const o = json as Record<string, unknown>;
  if (o.enabled !== true) return AI_OFF;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const tasks = Array.isArray(o.tasks) ? AI_TASKS.filter((t) => (o.tasks as unknown[]).includes(t)) : [];
  return { enabled: true, provider: text(o.provider), model: text(o.model), tasks };
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

// ---- once per page: every component that shows something of AI asks the same answer

let current: AiConfig = AI_OFF;
let started = false;
const listeners = new Set<() => void>();

function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  forgetBrowserKey();
  void loadConfig().then((c) => {
    current = c;
    listeners.forEach((l) => l());
  });
}

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  start();
  return () => { listeners.delete(onChange); };
};

/** The AI of the studio - off until it answered, and when there is none. */
export function useAiConfig(): AiConfig {
  return useSyncExternalStore(subscribe, () => current, () => AI_OFF);
}

/** Is the AI on for `task` - on in the studio and a skill for the task? */
export const aiFor = (config: AiConfig, task: AiTask): boolean => config.enabled && config.tasks.includes(task);

/** The switch of one place: the AI of its task. */
export const useAiFor = (task: AiTask): boolean => aiFor(useAiConfig(), task);

/** Is there AI anywhere - the icon in the header. */
export const anyAi = (config: AiConfig): boolean => config.enabled && config.tasks.length > 0;

/** Until E23 the key was stored in the browser - it is removed, so it does not stay there unused. */
export const OLD_BROWSER_KEYS = ['orch-spec.anthropicKey', 'orch-spec.anthropicWorkspace'];

export function forgetBrowserKey(store: Pick<Storage, 'removeItem'> | null = browserStore()): void {
  try { OLD_BROWSER_KEYS.forEach((k) => store?.removeItem(k)); } catch { /* blocked storage */ }
}

function browserStore(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
