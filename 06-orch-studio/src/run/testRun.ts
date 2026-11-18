// «Auf Testumgebung» (E25, P1): the run of the studio that brings a spec of orch-spec to the test
// environment - eight steps, one after the other, each a command that is there already (git, the merge
// of Orchescala, sbt, the scripts of the company). Without an engine: the run is its `status.json`.
//
//   1 Projekt   2 Auschecken   3 Branch   4 Merge             the Git part: the work branch, the spec merged into the code
//   5 Kompilieren und testen                                  «Generieren, kompilieren, testen» with step 4
//   6 Release   7 Deploy auf Test                             the version `x.y.z-<runId>` on the test environment
//   8 Simulationen, Import prüfen
//
// A step that fails makes the run wait (`waiting`): development fixes it on the work branch - later the
// AI first - and the run goes on (continueRun). A failed step 1-3, or a merge that itself failed, goes
// on at that step; after conflicts of the merge and after any later error at step 5 - the code of the
// spec is on the branch since step 4. A run that was interrupted goes on at the step it was in.
//
// The texts of the status are German: the RE reads them in orch-spec. The log of the studio is English.
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import type { Log } from '../log.ts';
import { tail, type Exec, type ExecResult } from './exec.ts';
import type { GitHost, PullRequest } from './gitHost.ts';
import { workBranch, type Project } from './project.ts';
import {
  alive, open, pathsOf, readJson, writeJson,
  type Counts, type Paths, type RunStatus, type StepStatus, type Work,
} from './status.ts';

export type Person = { name: string; email: string };

export type Deps = {
  exec: Exec;
  /** the folder of the clones and runs - `~/.orch-platform/workspaces` */
  workspace: string;
  now: () => Date;
  log: Log;
  /** who commits for the studio - the RE is the author */
  committer: Person;
  /** the Git platform of a project, for «Übergeben» - or why there is none */
  gitHost?: (project: Project) => GitHost | string;
  /** is this run, which says `running`, still at work? Without it: does its process live. The studio
    * knows the runs it started - one that is not among them was interrupted. */
  running?: (status: RunStatus) => boolean;
};

/** `running`, but nobody runs it any more: the studio was stopped - the run waits and can go on (P1). */
export const interrupted = (d: Pick<Deps, 'running'>, s: RunStatus) => s.state === 'running' && !(d.running ? d.running(s) : alive(s.pid));

export const STEPS = [
  'Projekt', 'Auschecken', 'Branch', 'Merge', 'Kompilieren und testen', 'Release', 'Deploy auf Test', 'Simulationen, Import prüfen',
] as const;
/** The step (from 0) a run goes on with after conflicts of the merge or a later error: «Kompilieren und testen». */
export const COMPILE = 4;
const GIT_TIMEOUT_MS = 10 * 60 * 1000;
const LOG_LINES = 200;

/** A step that failed - with what the status shows of it. */
export class StepFailed extends Error {
  log: string;
  conflicts: string[];
  /** what the step found out before it failed (the tests that failed) */
  patch: Partial<RunStatus>;
  constructor(message: string, o: { log?: string; conflicts?: string[]; patch?: Partial<RunStatus> } = {}) {
    super(message);
    this.log = o.log ?? '';
    this.conflicts = o.conflicts ?? [];
    this.patch = o.patch ?? {};
  }
}

type Ctx = { d: Deps; project: Project; p: Paths; status: RunStatus; runDir: string; logFile: string };

const gitEnv = (d: Deps) => ({
  GIT_AUTHOR_NAME: d.committer.name, GIT_AUTHOR_EMAIL: d.committer.email,
  GIT_COMMITTER_NAME: d.committer.name, GIT_COMMITTER_EMAIL: d.committer.email,
  // never ask for a password: a repo the studio cannot reach fails the step
  GIT_TERMINAL_PROMPT: '0',
});

const note = (c: Ctx, line: string) => appendFileSync(c.logFile, `$ ${line}\n`);

/** git in `cwd` - its output, or the step fails with it. */
async function git(c: Ctx, cwd: string, args: string[]): Promise<string> {
  note(c, `git ${args.join(' ')}`);
  const r = await c.d.exec('git', args, { cwd, env: gitEnv(c.d), timeoutMs: GIT_TIMEOUT_MS, logFile: c.logFile });
  if (r.code !== 0) throw new StepFailed(`«git ${args[0]}» ist gescheitert.`, { log: r.output });
  return r.output.trim();
}

/** What a command of the project finds in its environment. */
export const commandEnv = (c: { project: Project; status: RunStatus; runDir: string; p: Paths }) => ({
  ORCH_RUN_ID: c.status.runId,
  ORCH_PROJECT: c.project.name,
  ORCH_WORK: c.status.work,
  ORCH_BRANCH: c.status.workBranch,
  ORCH_VERSION: c.status.version ?? '',
  ORCH_SPEC_DIR: join(c.runDir, 'spec'),
  ORCH_PLAN_FILE: join(c.runDir, 'plan.json'),
  ORCH_PROJECT_DIR: c.p.projectDir,
});

/** A command of the project (`sh -c`, in its folder) - its result; the step decides what a failure means. */
async function command(c: Ctx, script: string, env: Record<string, string> = {}): Promise<ExecResult> {
  note(c, script);
  return c.d.exec('sh', ['-c', script], {
    cwd: c.p.projectDir, env: { ...gitEnv(c.d), ...commandEnv(c), ...env }, timeoutMs: c.project.timeoutMinutes * 60 * 1000, logFile: c.logFile,
  });
}

const ended = (what: string, r: ExecResult, c: Ctx) =>
  r.timedOut ? `${what} hat länger als ${c.project.timeoutMinutes} Minuten gebraucht und wurde beendet.` : `${what} ist gescheitert (Exit ${r.code}).`;

/** The JUnit reports (`test-reports/*.xml`) under `dir`, each with the time it was written. */
export function reportTimes(dir: string): Map<string, number> {
  const reports = (d: string): string[] =>
    !existsSync(d) ? [] : readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') return [];
      const sub = join(d, e.name);
      return e.name === 'test-reports' ? readdirSync(sub).filter((f) => f.endsWith('.xml')).map((f) => join(sub, f)) : reports(sub);
    });
  return new Map(reports(dir).map((f) => [f, statSync(f).mtimeMs]));
}

/** What the reports under `dir` say that are new or rewritten since `before` - those of this step, not
  * of an earlier one (the tests, when the simulations are counted). None: null. */
export function countReports(dir: string, before: Map<string, number> = new Map()): Counts | null {
  const files = [...reportTimes(dir)].filter(([f, time]) => before.get(f) !== time).map(([f]) => f);
  if (!files.length) return null;
  const attr = (suite: string, name: string) => Number(new RegExp(`\\b${name}="(\\d+)"`).exec(suite)?.[1] ?? 0);
  return files
    .flatMap((f) => readFileSync(f, 'utf8').match(/<testsuite\b[^>]*>/g) ?? [])
    .reduce<Counts>((sum, suite) => {
      const failed = attr(suite, 'failures') + attr(suite, 'errors');
      return { passed: sum.passed + attr(suite, 'tests') - failed - attr(suite, 'skipped'), failed: sum.failed + failed };
    }, { passed: 0, failed: 0 });
}

/** `x.y.z` of the project - `val version = "x.y.z-SNAPSHOT"` in `project/ProjectDef.scala`. */
export function baseVersion(projectDir: string): string | undefined {
  try {
    return /\bval\s+version\s*=\s*"(\d+\.\d+\.\d+)/.exec(readFileSync(join(projectDir, 'project', 'ProjectDef.scala'), 'utf8'))?.[1];
  } catch {
    return undefined;
  }
}

export type Plan = { summary: Record<string, number>; conflicts: string[]; files: { path: string; action: string }[] };

/** The plan of the merge (`--json`): files per action, those with conflicts, and what changes. */
function readPlan(file: string): Plan | undefined {
  const plan = readJson<{ summary?: unknown; files?: unknown }>(file);
  if (!plan) return undefined;
  const summary = plan.summary && typeof plan.summary === 'object'
    ? Object.fromEntries(Object.entries(plan.summary).filter((e): e is [string, number] => typeof e[1] === 'number'))
    : {};
  const files = (Array.isArray(plan.files) ? (plan.files as { path?: unknown; action?: unknown }[]) : [])
    .filter((f): f is { path: string; action: string } => typeof f?.path === 'string' && typeof f.action === 'string')
    .map((f) => ({ path: f.path, action: f.action }));
  return { summary, conflicts: files.filter((f) => f.action === 'conflict').map((f) => f.path), files: files.filter((f) => f.action !== 'unchanged') };
}

/** The tree as Git has it - what a step left behind (the version of a release) is gone. */
async function clean(c: Ctx) {
  await git(c, c.p.tree, ['reset', '--hard']);
  await git(c, c.p.tree, ['clean', '-fd']);
}

/** Before a run goes on at step 5 or later: what development (or the AI) pushed to the work branch. */
async function syncTree(c: Ctx) {
  await clean(c);
  await git(c, c.p.repo, ['fetch', '--prune', 'origin']);
  await git(c, c.p.tree, ['merge', '--ff-only', `origin/${c.status.workBranch}`]);
}

type Step = (c: Ctx) => Promise<Partial<RunStatus>>;

const projectStep: Step = async (c) => {
  const spec = join(c.runDir, 'spec');
  const has = (...path: string[]) => existsSync(join(spec, ...path));
  if (!(has('config', 'model.json') || has('model.json') || has('processes') || has('services')))
    throw new StepFailed('Der Ordner der Spez hat weder config/model.json noch processes/ oder services/.');
  return {};
};

const checkoutStep: Step = async (c) => {
  mkdirSync(dirname(c.p.repo), { recursive: true });
  // one clone per repo in the workspace of the studio - never the checkout of a developer
  if (!existsSync(join(c.p.repo, '.git'))) await git(c, dirname(c.p.repo), ['clone', '--no-checkout', c.project.repo, c.p.repo]);
  await git(c, c.p.repo, ['fetch', '--prune', 'origin']);
  if (!existsSync(join(c.p.tree, '.git'))) {
    await git(c, c.p.repo, ['worktree', 'prune']);
    await git(c, c.p.repo, ['worktree', 'add', '--detach', c.p.tree, `origin/${c.project.develop}`]);
  }
  await clean(c);
  if (!existsSync(c.p.projectDir)) throw new StepFailed(`Das Repo hat keinen Ordner «${c.project.path}» für das Projekt.`);
  return {};
};

const branchStep: Step = async (c) => {
  const branch = c.status.workBranch;
  // again when the step runs again: development has merged develop into the work branch meanwhile
  await git(c, c.p.repo, ['fetch', '--prune', 'origin']);
  note(c, `git rev-parse origin/${branch}`);
  const remote = (await c.d.exec('git', ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`], { cwd: c.p.repo, timeoutMs: GIT_TIMEOUT_MS })).code === 0;
  // the first run of a work creates its branch from develop, every later one goes on with it (P5)
  await git(c, c.p.tree, ['checkout', '-B', branch, `origin/${remote ? branch : c.project.develop}`]);
  if (!remote) await git(c, c.p.tree, ['push', '-u', 'origin', branch]);
  note(c, `git merge origin/${c.project.develop}`);
  const merged = await c.d.exec('git', ['merge', '--no-edit', `origin/${c.project.develop}`], { cwd: c.p.tree, env: gitEnv(c.d), timeoutMs: GIT_TIMEOUT_MS, logFile: c.logFile });
  if (merged.code !== 0) {
    await c.d.exec('git', ['merge', '--abort'], { cwd: c.p.tree, timeoutMs: GIT_TIMEOUT_MS });
    throw new StepFailed(
      `«${c.project.develop}» lässt sich nicht in den Arbeits-Branch mergen. Die Entwicklung mergt ihn auf «${branch}» und setzt den Lauf fort.`,
      { log: merged.output },
    );
  }
  await git(c, c.p.tree, ['push', 'origin', branch]);
  return {};
};

const mergeStep: Step = async (c) => {
  // the step can run again: what a merge that failed left behind is gone
  await clean(c);
  const planFile = commandEnv(c).ORCH_PLAN_FILE;
  rmSync(planFile, { force: true });
  const r = await command(c, c.project.commands.merge);
  if (r.code !== 0) throw new StepFailed(ended('Der Merge der Spez in den Code', r, c), { log: r.output });
  const plan = readPlan(planFile);
  await git(c, c.p.tree, ['add', '-A']);
  const changed = (await c.d.exec('git', ['diff', '--cached', '--quiet'], { cwd: c.p.tree, timeoutMs: GIT_TIMEOUT_MS })).code !== 0;
  // the RE is the author, the studio commits; with conflicts their markers go along, for development
  if (changed)
    await git(c, c.p.tree, [
      'commit', '-m', c.status.summary || `orch-spec: ${c.status.work}`,
      ...(c.status.author ? ['--author', c.status.author] : []),
    ]);
  await git(c, c.p.tree, ['push', 'origin', c.status.workBranch]);
  const merge = plan?.summary ?? null;
  if (plan?.conflicts.length)
    throw new StepFailed(
      `Der Merge hat ${plan.conflicts.length === 1 ? 'einen Konflikt' : `${plan.conflicts.length} Konflikte`}: Spez und Code haben dieselbe Stelle geändert. Die Entwicklung löst sie auf «${c.status.workBranch}» und setzt den Lauf fort.`,
      { conflicts: plan.conflicts, log: r.output, patch: { merge } },
    );
  return { merge };
};

const testStep: Step = async (c) => {
  const before = reportTimes(c.p.projectDir);
  const r = await command(c, c.project.commands.test);
  const tests = countReports(c.p.projectDir, before);
  if (r.code !== 0 || tests?.failed)
    throw new StepFailed(
      tests?.failed ? `${tests.failed === 1 ? 'Ein Test ist' : `${tests.failed} Tests sind`} fehlgeschlagen.` : ended('Kompilieren und Testen', r, c),
      { log: r.output, patch: { tests } },
    );
  return { tests };
};

const releaseStep: Step = async (c) => {
  const base = baseVersion(c.p.projectDir);
  if (!base) throw new StepFailed('Die Version des Projekts steht nicht in project/ProjectDef.scala (val version = "x.y.z…").');
  // a version with «-» is no release of its own: it is built for the test environment and removed with «Freigeben» (P6)
  const version = `${base}-${c.status.runId}`;
  const r = await command(c, c.project.commands.release, { ORCH_VERSION: version });
  if (r.code !== 0) throw new StepFailed(ended(`Das Release ${version}`, r, c), { log: r.output });
  return { version };
};

const deployStep: Step = async (c) => {
  const r = await command(c, c.project.commands.deploy);
  if (r.code !== 0) throw new StepFailed(ended(`Der Deploy von ${c.status.version} auf die Test-Umgebung`, r, c), { log: r.output });
  return { testUrl: c.project.testUrl ?? null };
};

const simulateStep: Step = async (c) => {
  const before = reportTimes(c.p.projectDir);
  const r = await command(c, c.project.commands.simulate);
  const simulations = countReports(c.p.projectDir, before);
  if (r.code !== 0 || simulations?.failed)
    throw new StepFailed(
      simulations?.failed
        ? `${simulations.failed === 1 ? 'Eine Simulation ist' : `${simulations.failed} Simulationen sind`} fehlgeschlagen.`
        : ended('Die Simulationen', r, c),
      { log: r.output, patch: { simulations } },
    );
  const check = c.project.commands.checkImport ? await command(c, c.project.commands.checkImport) : undefined;
  if (check && check.code !== 0)
    throw new StepFailed('Die Engine der Test-Umgebung hat nicht die BPMN/DMN dieses Stands.', { log: check.output, patch: { simulations } });
  return { simulations };
};

const RUN: Step[] = [projectStep, checkoutStep, branchStep, mergeStep, testStep, releaseStep, deployStep, simulateStep];

const mark = (steps: StepStatus[], index: number, change: Partial<StepStatus>) => steps.map((s, i) => (i === index ? { ...s, ...change } : s));

/** The steps from `from` on - until the end or the first that fails. */
async function runSteps(d: Deps, project: Project, before: RunStatus, from: number, resumed: boolean): Promise<RunStatus> {
  const p = pathsOf(d.workspace, project);
  const save = (s: RunStatus) => {
    writeJson(p.status, s);
    return s;
  };
  const label = `${project.name} ${before.runId}`;
  const runDir = join(p.runs, before.runId);
  if (from >= RUN.length) {
    // what the release changed in the tree (its version) is not committed
    await d.exec('git', ['reset', '--hard'], { cwd: p.tree, timeoutMs: GIT_TIMEOUT_MS });
    writeJson(p.durations, Object.fromEntries(before.steps.map((s) => [s.name, s.durationMs ?? 0])));
    const work = readJson<Work>(p.work);
    if (work)
      writeJson(p.work, {
        ...work,
        rounds: [...work.rounds, { runId: before.runId, summary: before.summary, version: before.version, tests: before.tests, simulations: before.simulations }],
      } satisfies Work);
    d.log.info(`${label} - ok: version ${before.version}`);
    return save({ ...before, state: 'ok', step: null, resumeAt: null });
  }
  const name = STEPS[from];
  const started = d.now();
  const status = save({
    ...before, state: 'running', waitingFor: null, error: null, resumeAt: null, pid: process.pid,
    step: { index: from + 1, of: RUN.length, name, since: started.toISOString() },
    steps: mark(before.steps, from, { state: 'running' }),
  });
  const logFile = join(runDir, `${from + 1}.log`);
  const c: Ctx = { d, project, p, status, runDir, logFile };
  const took = () => d.now().getTime() - started.getTime();
  try {
    if (resumed && from >= COMPILE) await syncTree(c);
    const patch = await RUN[from](c);
    d.log.info(`${label} - ${from + 1}/${RUN.length} ${name}: ok in ${took()} ms`);
    return runSteps(d, project, { ...status, ...patch, steps: mark(status.steps, from, { state: 'ok', durationMs: took() }) }, from + 1, false);
  } catch (e) {
    const failed = e instanceof StepFailed ? e : new StepFailed(`Unerwarteter Fehler: ${e instanceof Error ? e.message : String(e)}`);
    // conflicts are on the branch: the fix goes on with compiling; a step of the Git part runs again
    const resumeAt = from < COMPILE && !failed.conflicts.length ? from : COMPILE;
    d.log.warn(`${label} - ${from + 1}/${RUN.length} ${name}: waiting for development - ${failed.message}`);
    return save({
      ...status, ...failed.patch, state: 'waiting', waitingFor: 'developer', resumeAt,
      steps: mark(status.steps, from, { state: 'failed', durationMs: took() }),
      error: { step: name, message: failed.message, log: tail(failed.log, LOG_LINES), conflicts: failed.conflicts },
    });
  }
}

/** `yyyymmdd-hhmm` (UTC) - with the seconds if a run of this minute is there already. */
function runIdOf(now: Date, taken: (id: string) => boolean): string {
  const iso = now.toISOString().replace(/[-:]/g, '');
  const id = `${iso.slice(0, 8)}-${iso.slice(9, 13)}`;
  return taken(id) ? `${id}${iso.slice(13, 15)}` : id;
}

/** «Auf Testumgebung»: starts a run with the spec in `specDir` - the status at its end (ok, or waiting),
  * or why it does not start. The first run of a work names it and creates its branch. */
export async function startTest(
  d: Deps, project: Project, o: { specDir: string; work?: string; summary?: string; author?: Person },
): Promise<RunStatus | string> {
  const p = pathsOf(d.workspace, project);
  const last = readJson<RunStatus>(p.status);
  if (last && open(last))
    return `Das Projekt «${project.name}» hat den Lauf ${last.runId} offen (${interrupted(d, last) ? 'unterbrochen' : last.state === 'waiting' ? 'wartet' : 'läuft'}) – zuerst fortsetzen oder abbrechen.`;
  const openWork = readJson<Work>(p.work);
  const work = o.work ?? openWork?.work;
  if (!work) return 'Der erste Lauf einer Arbeit braucht ihren Namen.';
  if (!/^[a-z0-9][a-z0-9-]*$/.test(work)) return `Der Name der Arbeit «${work}» ist nicht klein geschrieben, mit Ziffern und «-».`;
  if (openWork && openWork.work !== work) return `Das Projekt «${project.name}» hat die offene Arbeit «${openWork.work}» – eine Arbeit je Projekt.`;
  if (!existsSync(o.specDir) || !statSync(o.specDir).isDirectory()) return `Die Spez «${o.specDir}» ist kein Ordner.`;
  const runId = runIdOf(d.now(), (id) => existsSync(join(p.runs, id)));
  const runDir = join(p.runs, runId);
  mkdirSync(runDir, { recursive: true });
  // the spec of the run stays with it: a run that goes on later merges the same one
  cpSync(o.specDir, join(runDir, 'spec'), { recursive: true });
  const branch = workBranch(project, work);
  if (!openWork) writeJson(p.work, { work, branch, rounds: [], pullRequest: null } satisfies Work);
  const expected = readJson<Record<string, number>>(p.durations) ?? {};
  d.log.info(`${project.name} ${runId} - «Auf Testumgebung» of the work ${work}`);
  return runSteps(d, project, {
    runId, kind: 'test', project: project.name, state: 'running', startedBy: o.author?.email ?? d.committer.email,
    step: null,
    steps: STEPS.map((name) => ({ name, state: 'pending' as const, ...(expected[name] ? { expectedMs: expected[name] } : {}) })),
    workBranch: branch, version: null, testUrl: null, pullRequest: openWork?.pullRequest ?? null,
    tests: null, simulations: null, merge: null, waitingFor: null, error: null,
    work, summary: o.summary?.trim() ?? '', author: o.author ? `${o.author.name} <${o.author.email}>` : null,
    resumeAt: null, pid: process.pid,
  }, 0, false);
}

/** A run that waits - or that was interrupted - goes on, after the fix on the work branch. */
export async function continueRun(d: Deps, project: Project): Promise<RunStatus | string> {
  const status = readJson<RunStatus>(pathsOf(d.workspace, project).status);
  if (!status || !open(status)) return `Das Projekt «${project.name}» hat keinen Lauf, der wartet.`;
  if (status.state === 'running' && !interrupted(d, status)) return `Der Lauf ${status.runId} läuft noch.`;
  // interrupted: the step it was in runs again - every step can
  const from = status.resumeAt ?? (status.step ? status.step.index - 1 : 0);
  d.log.info(`${project.name} ${status.runId} - goes on at step ${from + 1}`);
  return runSteps(d, project, {
    ...status,
    // what failed before the step it goes on with is fixed: the conflicts of the merge are resolved
    steps: status.steps.map((s, i) =>
      i >= from ? { name: s.name, state: 'pending' as const, ...(s.expectedMs ? { expectedMs: s.expectedMs } : {}) } : s.state === 'failed' ? { ...s, state: 'ok' as const } : s),
  }, from, true);
}

/** The RE gives up a run that waits: the spec is free again, the work branch stays. */
export function cancelRun(d: Deps, project: Project): RunStatus | string {
  const p = pathsOf(d.workspace, project);
  const status = readJson<RunStatus>(p.status);
  if (!status || !open(status)) return `Das Projekt «${project.name}» hat keinen Lauf, der wartet.`;
  if (status.state === 'running' && !interrupted(d, status)) return `Der Lauf ${status.runId} läuft noch.`;
  const cancelled: RunStatus = {
    ...status, state: 'error', waitingFor: null, resumeAt: null, step: null,
    error: { step: status.error?.step ?? status.step?.name ?? '', message: 'Abgebrochen.', log: status.error?.log ?? '', conflicts: status.error?.conflicts ?? [] },
  };
  writeJson(p.status, cancelled);
  d.log.info(`${project.name} ${status.runId} - cancelled`);
  return cancelled;
}

/** The status of the project: its last run, with one that was interrupted shown as waiting. */
export function runStatus(d: Deps, project: Project): RunStatus | undefined {
  const status = readJson<RunStatus>(pathsOf(d.workspace, project).status);
  return status && interrupted(d, status)
    ? { ...status, state: 'waiting', waitingFor: 'developer', resumeAt: status.step ? status.step.index - 1 : 0 }
    : status;
}

/** A file of a spec as orch-spec sends it - text, or base64 for what is none. */
export type SpecFile = { path: string; text?: string; base64?: string };

/** Writes the files of a spec into `dir` - or the path that is not one inside it. */
export function writeSpec(dir: string, files: SpecFile[]): string | undefined {
  const bad = files.find((f) =>
    typeof f?.path !== 'string' || !f.path || f.path.startsWith('/') || f.path.includes('\\') || f.path.split('/').some((part) => part === '..' || part === '')
    || (typeof f.text !== 'string' && typeof f.base64 !== 'string'));
  if (bad) return `Die Datei «${String(bad?.path)}» der Spez hat keinen Pfad im Ordner oder keinen Inhalt.`;
  files.forEach((f) => {
    const file = join(dir, ...f.path.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof f.text === 'string' ? f.text : Buffer.from(f.base64!, 'base64'));
  });
  return undefined;
}

/** The files of the folder `dir`, as orch-spec reads them back. */
export function readSpec(dir: string): SpecFile[] {
  const walk = (d: string): string[] =>
    !existsSync(d) ? [] : readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.isFile() ? [join(d, e.name)] : []));
  return walk(dir).sort().map((file) => {
    const bytes = readFileSync(file);
    const path = relative(dir, file).split(sep).join('/');
    try {
      return { path, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
    } catch {
      return { path, base64: bytes.toString('base64') };
    }
  });
}

/** What «Auf Testumgebung» shows before it starts (P12): the plan of the merge - nothing is built or
  * written to the branch - and the spec as it is on the branch, for the comparison in orch-spec. */
export type Preview = {
  previewId: string;
  /** the open work - none: the run that follows is the first of a new one and names it */
  work: string | null;
  plan: Plan | null;
  before: SpecFile[];
};

/** The preview of a run with the spec `files`: it is kept, and the run starts with it (specDirOf). */
export async function previewTest(d: Deps, project: Project, files: SpecFile[]): Promise<Preview | string> {
  const p = pathsOf(d.workspace, project);
  const last = readJson<RunStatus>(p.status);
  if (last && open(last)) return `Das Projekt «${project.name}» hat den Lauf ${last.runId} offen – die Spez ist gesperrt.`;
  const work = readJson<Work>(p.work) ?? null;
  const previewId = `p${runIdOf(d.now(), () => true)}`;
  // one RE per project (PoC): the last preview only
  rmSync(p.previews, { recursive: true, force: true });
  const dir = join(p.previews, previewId);
  mkdirSync(join(dir, 'spec'), { recursive: true });
  const wrong = writeSpec(join(dir, 'spec'), files);
  if (wrong) return wrong;
  const blank: RunStatus = {
    runId: previewId, kind: 'test', project: project.name, state: 'running', startedBy: d.committer.email, step: null, steps: [],
    workBranch: work?.branch ?? '', version: null, testUrl: null, pullRequest: null, tests: null, simulations: null, merge: null,
    waitingFor: null, error: null, work: work?.work ?? '', summary: '', author: null, resumeAt: null, pid: process.pid,
  };
  const c: Ctx = { d, project, p, status: blank, runDir: dir, logFile: join(dir, 'preview.log') };
  try {
    await projectStep(c);
    await checkoutStep(c);
    // the code the spec is merged into: the work branch, or develop before the first run of a work
    const remote = work && (await d.exec('git', ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${work.branch}`], { cwd: p.repo, timeoutMs: GIT_TIMEOUT_MS })).code === 0;
    await git(c, p.tree, ['checkout', '--detach', `origin/${remote ? work.branch : project.develop}`]);
    const before = readSpec(join(p.projectDir, 'spec'));
    const r = await command(c, project.commands.check);
    if (r.code !== 0) throw new StepFailed(ended('Die Vorschau des Merge', r, c), { log: r.output });
    await clean(c);
    return { previewId, work: work?.work ?? null, plan: readPlan(commandEnv(c).ORCH_PLAN_FILE) ?? null, before };
  } catch (e) {
    const failed = e instanceof StepFailed ? e : new StepFailed(`Unerwarteter Fehler: ${e instanceof Error ? e.message : String(e)}`);
    d.log.warn(`${project.name} ${previewId} - the preview failed: ${failed.message}`);
    return [failed.message, tail(failed.log, 20)].filter(Boolean).join('\n');
  }
}

/** The folder of the spec of a preview - undefined if it is gone (a newer preview replaced it). */
export function specDirOf(d: Deps, project: Project, previewId: string): string | undefined {
  const dir = join(pathsOf(d.workspace, project).previews, previewId, 'spec');
  return /^p[0-9-]+$/.test(previewId) && existsSync(dir) ? dir : undefined;
}

const counts = (what: string, c: Counts | null) => (c ? `, ${c.passed} ${what} ok${c.failed ? `, ${c.failed} fehlgeschlagen` : ''}` : '');

/** The text of the pull request: the rounds of the work - what the RE wrote, and what was tested. */
export const pullRequestBody = (work: Work) =>
  [
    `Aus Orch Spec, Arbeit «${work.work}» – vom Requirements Engineer auf der Test-Umgebung getestet.`,
    '',
    ...work.rounds.map((r) => `- **${r.version ?? r.runId}**${counts('Tests', r.tests)}${counts('Simulationen', r.simulations)}${r.summary ? `\n  ${r.summary.replace(/\n/g, '\n  ')}` : ''}`),
  ].join('\n');

/** «Übergeben»: the RE has tested and is done - the pull request of the work branch into develop, created
  * or brought up to date; merged by the studio for a project with `autoMerge` (P7). */
export async function handOver(d: Deps, project: Project): Promise<PullRequest | string> {
  const p = pathsOf(d.workspace, project);
  const work = readJson<Work>(p.work);
  const status = readJson<RunStatus>(p.status);
  if (!work) return `Das Projekt «${project.name}» hat keine offene Arbeit.`;
  if (status && open(status)) return `Der Lauf ${status.runId} ist noch offen – übergeben wird, was auf der Test-Umgebung ok war.`;
  if (!work.rounds.length) return `Die Arbeit «${work.work}» war noch nie ok auf der Test-Umgebung.`;
  const host = d.gitHost?.(project) ?? 'Für das Projekt ist keine Git-Plattform eingestellt.';
  if (typeof host === 'string') return host;
  try {
    const opened = await host.pullRequest({ head: work.branch, base: project.develop, title: `Orch Spec: ${work.work}`, body: pullRequestBody(work) });
    const pullRequest = project.autoMerge && !opened.merged ? (await host.merge(opened.number), { ...opened, merged: true }) : opened;
    writeJson(p.work, { ...work, pullRequest } satisfies Work);
    if (status) writeJson(p.status, { ...status, pullRequest } satisfies RunStatus);
    d.log.info(`${project.name} - handed over: ${pullRequest.url}${pullRequest.merged ? ' (merged)' : ''}`);
    return pullRequest;
  } catch (e) {
    return `Der Pull Request liess sich nicht anlegen: ${e instanceof Error ? e.message : String(e)}`;
  }
}
