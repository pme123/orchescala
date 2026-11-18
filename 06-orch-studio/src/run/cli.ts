// The runs of the studio from the command line - for development and tests, without the studio (P1):
//
//   npm run platform -- test      --project <name> --spec <folder> [--work <name>] [--summary <text>] [--author "Name <mail>"]
//   npm run platform -- continue  --project <name>      a run that waits goes on, after the fix on the work branch
//   npm run platform -- cancel    --project <name>      a run that waits is given up - the work branch stays
//   npm run platform -- status    --project <name>      the status.json of the project
//   npm run platform -- hand-over --project <name>      «Übergeben»: the pull request into develop
//
// The projects from `--projects <file>` or `STUDIO_PROJECTS`; the clones and runs in `STUDIO_WORKSPACE`
// (default `~/.orch-platform/workspaces`); the token of the Git platform in `STUDIO_GIT_TOKEN`.
// Exit: 0 ok, 2 the run waits, 1 it did not start (or was cancelled).
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { consoleLog } from '../log.ts';
import { exec } from './exec.ts';
import { gitHub } from './gitHost.ts';
import { loadProjects, type Project } from './project.ts';
import type { RunStatus } from './status.ts';
import { cancelRun, continueRun, handOver, runStatus, startTest, type Deps, type Person } from './testRun.ts';

type Env = Record<string, string | undefined>;

/** `Name <mail>` - or undefined. */
export function personOf(text: string | undefined): Person | undefined {
  const m = /^\s*(.+?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(text ?? '');
  return m ? { name: m[1], email: m[2] } : undefined;
}

export function depsFromEnv(env: Env = process.env): Deps {
  const get = (name: string) => env[name]?.trim() || undefined;
  return {
    exec,
    workspace: resolve(get('STUDIO_WORKSPACE') ?? join(homedir(), '.orch-platform', 'workspaces')),
    now: () => new Date(),
    log: consoleLog,
    committer: { name: get('STUDIO_GIT_NAME') ?? 'Orch Studio', email: get('STUDIO_GIT_EMAIL') ?? 'orch-studio@localhost' },
    gitHost: (project: Project) => {
      if (!project.gitHost) return `Für das Projekt «${project.name}» ist keine Git-Plattform eingestellt (gitHost).`;
      const token = get('STUDIO_GIT_TOKEN');
      return token ? gitHub({ ...project.gitHost, token }) : 'Das Studio hat kein Token für die Git-Plattform (STUDIO_GIT_TOKEN).';
    },
  };
}

/** One line per step, then what the run ended with. */
export function describe(s: RunStatus): string {
  const steps = s.steps.map((step, i) => `  ${i + 1}/${s.steps.length} ${step.name}: ${step.state}${step.durationMs !== undefined ? ` (${(step.durationMs / 1000).toFixed(1)} s)` : ''}`);
  const count = (what: string, c: RunStatus['tests']) => (c ? [`  ${what}: ${c.passed} ok, ${c.failed} fehlgeschlagen`] : []);
  return [
    `Lauf ${s.runId} von ${s.project}, Arbeit «${s.work}» (${s.workBranch}): ${s.state}`,
    ...steps,
    ...count('Tests', s.tests),
    ...count('Simulationen', s.simulations),
    ...(s.version ? [`  Version: ${s.version}`] : []),
    ...(s.testUrl ? [`  Test-Umgebung: ${s.testUrl}`] : []),
    ...(s.pullRequest ? [`  Pull Request: ${s.pullRequest.url}${s.pullRequest.merged ? ' (gemergt)' : ''}`] : []),
    ...(s.error ? [`  ${s.error.step}: ${s.error.message}`, ...s.error.conflicts.map((f) => `    Konflikt: ${f}`)] : []),
    ...(s.state === 'waiting' ? ['  Nach der Korrektur auf dem Arbeits-Branch: continue - oder cancel.'] : []),
  ].join('\n');
}

const USAGE = 'usage: test --project <name> --spec <folder> [--work <name>] [--summary <text>] [--author "Name <mail>"] | continue | cancel | status | hand-over --project <name>   [--projects <file>]';

/** Runs a command - what to print and the exit code. */
export async function main(argv: string[], env: Env = process.env, deps: Deps = depsFromEnv(env)): Promise<{ text: string; code: number }> {
  const parsed = (() => {
    try {
      return parseArgs({
        args: argv, allowPositionals: true,
        options: { project: { type: 'string' }, projects: { type: 'string' }, spec: { type: 'string' }, work: { type: 'string' }, summary: { type: 'string' }, author: { type: 'string' } },
      });
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  })();
  if (typeof parsed === 'string') return { text: `${parsed}\n${USAGE}`, code: 1 };
  const { values, positionals } = parsed;
  const file = values.projects ?? env.STUDIO_PROJECTS?.trim();
  if (!file) return { text: `no projects: --projects <file> or STUDIO_PROJECTS\n${USAGE}`, code: 1 };
  const projects = loadProjects(resolve(file));
  if (typeof projects === 'string') return { text: projects, code: 1 };
  const project = projects.find((p) => p.name === values.project);
  if (!project) return { text: `no project «${values.project ?? ''}» - there are: ${projects.map((p) => p.name).join(', ')}`, code: 1 };
  const ofRun = (r: RunStatus | string | undefined) =>
    typeof r === 'string' ? { text: r, code: 1 } : r ? { text: describe(r), code: r.state === 'ok' ? 0 : r.state === 'error' ? 1 : 2 } : { text: 'Noch kein Lauf.', code: 0 };
  switch (positionals[0]) {
    case 'test': {
      if (!values.spec) return { text: `test needs --spec <folder>\n${USAGE}`, code: 1 };
      const author = personOf(values.author);
      if (values.author && !author) return { text: `--author is not "Name <mail>": «${values.author}»`, code: 1 };
      return ofRun(await startTest(deps, project, { specDir: resolve(values.spec), work: values.work, summary: values.summary, author }));
    }
    case 'continue':
      return ofRun(await continueRun(deps, project));
    case 'cancel':
      return ofRun(cancelRun(deps, project));
    case 'status': {
      const status = runStatus(deps, project);
      return { text: status ? JSON.stringify(status, null, 2) : 'Noch kein Lauf.', code: 0 };
    }
    case 'hand-over': {
      const pr = await handOver(deps, project);
      return typeof pr === 'string' ? { text: pr, code: 1 } : { text: `Pull Request: ${pr.url}${pr.merged ? ' (gemergt)' : ''}`, code: 0 };
    }
    default:
      return { text: USAGE, code: 1 };
  }
}

if (import.meta.main) {
  const { text, code } = await main(process.argv.slice(2));
  console.log(text);
  process.exit(code);
}
