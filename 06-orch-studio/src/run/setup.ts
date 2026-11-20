// The runs of the studio from its settings: the projects of the company (`STUDIO_PROJECTS`), the
// workspace, who commits, and the token of the Git platform - for the studio and for the command line.
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { consoleLog, type Log } from '../log.ts';
import { exec } from './exec.ts';
import { gitHub } from './gitHost.ts';
import { loadProjects, type Project } from './project.ts';
import type { Deps } from './testRun.ts';

type Env = Record<string, string | undefined>;

/** `STUDIO_WORKSPACE` (default `~/.orch-platform/workspaces`), `STUDIO_GIT_NAME`, `STUDIO_GIT_EMAIL` (who
  * commits for the studio) and `STUDIO_GIT_TOKEN` (the Git platform, for «Übergeben» - read when needed,
  * never logged). */
export function depsFromEnv(env: Env = process.env, log: Log = consoleLog, cwd = process.cwd()): Deps {
  const get = (name: string) => env[name]?.trim() || undefined;
  return {
    exec,
    workspace: resolve(cwd, get('STUDIO_WORKSPACE') ?? join(homedir(), '.orch-platform', 'workspaces')),
    now: () => new Date(),
    log,
    committer: { name: get('STUDIO_GIT_NAME') ?? 'Orch Studio', email: get('STUDIO_GIT_EMAIL') ?? 'orch-studio@localhost' },
    gitHost: (project: Project) => {
      if (!project.gitHost) return `Für das Projekt «${project.name}» ist keine Git-Plattform eingestellt (gitHost).`;
      const token = get('STUDIO_GIT_TOKEN');
      return token ? gitHub({ ...project.gitHost, token }) : 'Das Studio hat kein Token für die Git-Plattform (STUDIO_GIT_TOKEN).';
    },
  };
}

/** The runs of the studio: the projects and what they run with. */
export type Platform = { projects: Project[]; deps: Deps };

/** The runs from the environment - none without `STUDIO_PROJECTS`: then orch-spec shows no buttons.
  * A file of projects that is wrong ends the start. */
export function platformFromEnv(env: Env = process.env, cwd = process.cwd(), log: Log = consoleLog): Platform | undefined {
  const file = env.STUDIO_PROJECTS?.trim();
  if (!file) return undefined;
  const projects = loadProjects(isAbsolute(file) ? file : resolve(cwd, file));
  if (typeof projects === 'string') throw new Error(`STUDIO_PROJECTS - ${projects}`);
  return { projects, deps: depsFromEnv(env, log, cwd) };
}
