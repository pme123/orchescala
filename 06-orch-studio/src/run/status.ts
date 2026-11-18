// The status of a run as orch-spec reads it (`status.json`) and the files of a project in the
// workspace of the studio:
//   <workspace>/<repo>/repo                    the clone of the repo - never the checkout of a developer
//   <workspace>/<repo>/work/<project>          the worktree on the work branch
//   <workspace>/<repo>/runs/<project>/status.json     the last run - it is the lock of the project
//   <workspace>/<repo>/runs/<project>/work.json       the open work: its branch, rounds and pull request
//   <workspace>/<repo>/runs/<project>/durations.json  how long each step took in the last run that was ok
//   <workspace>/<repo>/runs/<project>/<runId>/        the spec of the run, its plan and the logs of the steps
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { PullRequest } from './gitHost.ts';
import { repoName, type Project } from './project.ts';

export type StepState = 'pending' | 'running' | 'ok' | 'failed';
export type StepStatus = { name: string; state: StepState; durationMs?: number; expectedMs?: number };
export type Counts = { passed: number; failed: number };
export type RunError = {
  step: string;
  message: string;
  /** the last 200 lines of the step */
  log: string;
  /** the files with conflicts of the merge */
  conflicts: string[];
};

export type RunStatus = {
  runId: string;
  kind: 'test';
  project: string;
  /** `running`, `waiting` (a step failed - the run goes on after the fix), `ok`, `error` (cancelled) */
  state: 'running' | 'waiting' | 'ok' | 'error';
  startedBy: string;
  step: { index: number; of: number; name: string; since: string } | null;
  steps: StepStatus[];
  workBranch: string;
  version: string | null;
  testUrl: string | null;
  pullRequest: PullRequest | null;
  tests: Counts | null;
  simulations: Counts | null;
  /** what the merge did: files per action (create, update, merged, delete, conflict …) */
  merge: Record<string, number> | null;
  waitingFor: 'developer' | 'ai' | null;
  error: RunError | null;
  // what the studio needs to go on
  work: string;
  summary: string;
  author: string | null;
  /** the step (from 0) a waiting run goes on with */
  resumeAt: number | null;
  /** the process that runs it - a run that says `running` without it was interrupted */
  pid: number;
};

/** One round of «Auf Testumgebung» that was ok - for the text of the pull request. */
export type Round = { runId: string; summary: string; version: string | null; tests: Counts | null; simulations: Counts | null };
export type Work = { work: string; branch: string; rounds: Round[]; pullRequest: PullRequest | null };

export type Paths = { repo: string; tree: string; projectDir: string; runs: string; status: string; work: string; durations: string };

export function pathsOf(workspace: string, project: Project): Paths {
  const base = join(workspace, repoName(project));
  const tree = join(base, 'work', project.name);
  const runs = join(base, 'runs', project.name);
  return {
    repo: join(base, 'repo'),
    tree,
    projectDir: join(tree, project.path),
    runs,
    status: join(runs, 'status.json'),
    work: join(runs, 'work.json'),
    durations: join(runs, 'durations.json'),
  };
}

/** The JSON of a file - undefined if it is not there or no JSON. */
export function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

/** Written next to the file, then renamed - a reader never sees half a status. */
export function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

/** Does the process of a run still live? */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** `running` with a process that is gone: the studio was stopped - the run waits and can go on (P1). */
export const interrupted = (s: RunStatus) => s.state === 'running' && !alive(s.pid);
/** A run that holds the lock of its project: the spec is locked, no second run. */
export const open = (s: RunStatus) => s.state === 'running' || s.state === 'waiting';
