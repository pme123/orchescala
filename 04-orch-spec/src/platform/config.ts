// The runs of the studio (E25): «Auf Testumgebung» and «Übergeben». The studio offers them for the
// projects it is configured with - `GET /platform/config`:
//   {"enabled": true, "projects": [{"name": "democompany-customer", "testUrl": "…", "handOver": true}]}
// Without a studio, with runs off, or for a folder of another project orch-spec shows nothing of
// them - like the AI (ai/config.ts). The status of a run is the studio's `status.json`.

export type PlatformProject = {
  name: string;
  /** the app on the test environment */
  testUrl?: string;
  /** the studio can open the pull request */
  handOver: boolean;
};
export type PlatformConfig = { enabled: boolean; projects: PlatformProject[] };
export const PLATFORM_OFF: PlatformConfig = { enabled: false, projects: [] };

/** On the origin of the page - the studio serves orch-spec and these paths. */
export const PLATFORM_CONFIG_PATH = '/platform/config';
export const platformPath = (project: string, what: 'status' | 'preview' | 'test' | 'continue' | 'cancel' | 'hand-over') =>
  `/platform/${encodeURIComponent(project)}/${what}`;

export type StepState = 'pending' | 'running' | 'ok' | 'failed';
export type RunStep = { name: string; state: StepState; durationMs?: number; expectedMs?: number };
export type Counts = { passed: number; failed: number };
export type PullRequest = { url: string; number: number; merged: boolean };

/** A run as the studio reports it. */
export type RunStatus = {
  runId: string;
  kind: 'test';
  project: string;
  /** `waiting`: a step failed - the run goes on after the fix; `error`: cancelled */
  state: 'running' | 'waiting' | 'ok' | 'error';
  startedBy: string;
  step: { index: number; of: number; name: string; since: string } | null;
  steps: RunStep[];
  work: string;
  workBranch: string;
  version: string | null;
  testUrl: string | null;
  pullRequest: PullRequest | null;
  tests: Counts | null;
  simulations: Counts | null;
  merge: Record<string, number> | null;
  waitingFor: 'developer' | 'ai' | null;
  error: { step: string; message: string; log: string; conflicts: string[] } | null;
};

/** The open work of a project: its branch and the rounds that were ok. */
export type Work = { work: string; branch: string; rounds: { runId: string; version: string | null }[]; pullRequest: PullRequest | null };
export type ProjectStatus = { status: RunStatus | null; work: Work | null };
export const NO_STATUS: ProjectStatus = { status: null, work: null };

/** A file of the spec as it goes to the studio and comes back. */
export type SpecFile = { path: string; text?: string; base64?: string };
/** What the studio answers before a run: the plan of the merge and the spec on the branch. */
export type Preview = {
  previewId: string;
  /** the open work - null: the run is the first of a new one and names it */
  work: string | null;
  plan: { summary: Record<string, number>; conflicts: string[]; files: { path: string; action: string }[] } | null;
  before: SpecFile[];
};

/** A run that holds its project: the spec is locked, no second run. */
export const runOpen = (s: RunStatus | null | undefined): boolean => !!s && (s.state === 'running' || s.state === 'waiting');

/** The answer of `GET /platform/config` - anything unexpected counts as off. */
export function parsePlatformConfig(json: unknown): PlatformConfig {
  if (!json || typeof json !== 'object') return PLATFORM_OFF;
  const o = json as Record<string, unknown>;
  if (o.enabled !== true || !Array.isArray(o.projects)) return PLATFORM_OFF;
  const projects = (o.projects as unknown[]).flatMap((p): PlatformProject[] => {
    if (!p || typeof p !== 'object') return [];
    const { name, testUrl, handOver } = p as Record<string, unknown>;
    return typeof name === 'string' && name.trim()
      ? [{ name: name.trim(), ...(typeof testUrl === 'string' && testUrl.trim() ? { testUrl: testUrl.trim() } : {}), handOver: handOver === true }]
      : [];
  });
  return { enabled: true, projects };
}

/** Asks the studio - every failure (no studio, 404, no JSON) is «off». */
export async function loadPlatformConfig(fetchFn: typeof fetch = fetch): Promise<PlatformConfig> {
  try {
    const r = await fetchFn(PLATFORM_CONFIG_PATH, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    return r.ok ? parsePlatformConfig(await r.json()) : PLATFORM_OFF;
  } catch {
    return PLATFORM_OFF;
  }
}

/** The project of the open folder the studio has runs for: the first of the studio's that a process,
  * page or service of the folder names. None: no buttons. */
export const projectOf = (config: PlatformConfig, named: (string | undefined)[]): PlatformProject | undefined =>
  config.enabled ? config.projects.find(p => named.includes(p.name)) : undefined;

/** A call of the studio: its answer, or the text it refuses with (`{"error": …}`). */
export async function callPlatform<T>(path: string, body?: unknown, fetchFn: typeof fetch = fetch): Promise<{ ok: T } | { error: string }> {
  try {
    const r = await fetchFn(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      cache: 'no-store',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await r.json().catch(() => undefined)) as unknown;
    if (r.ok && json && typeof json === 'object') return { ok: json as T };
    const error = json && typeof json === 'object' ? (json as { error?: unknown }).error : undefined;
    return { error: typeof error === 'string' && error ? error : `Das Studio antwortet mit ${r.status}.` };
  } catch {
    return { error: 'Keine Verbindung zum Studio.' };
  }
}

/** What the header says of a run: the step it is in, or what it ended with. */
export function runLabel(s: RunStatus): string {
  if (s.state === 'running') return s.step ? `${s.step.index}/${s.step.of} ${s.step.name}` : 'Lauf startet';
  if (s.state === 'waiting') return `Lauf wartet: ${s.error?.step ?? ''}`.trim();
  if (s.state === 'ok') return `Auf Test: ${s.version ?? s.runId}`;
  return 'Lauf abgebrochen';
}

/** The name of a work: lower case, digits and «-» - it becomes part of the work branch. */
export const WORK_NAME = /^[a-z0-9][a-z0-9-]*$/;

export const PLAN_ACTION: Record<string, string> = { create: 'neu', update: 'aktualisiert', merged: 'gemergt', delete: 'gelöscht', conflict: 'Konflikt' };

/** «12 gemergt · 2 neu · 1 gelöscht» - what the merge does, without what stays. */
export const planLine = (summary: Record<string, number>): string =>
  Object.entries(PLAN_ACTION).flatMap(([action, word]) => (summary[action] ? [`${summary[action]} ${word}`] : [])).join(' · ') || 'keine Änderung im Code';

export const duration = (ms: number): string => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`);
