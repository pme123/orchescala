// The projects of the company - configuration, not code (P2): where the repo is, where the project
// lies in it, and the commands of the steps the studio does not know itself. A JSON file
// (`STUDIO_PROJECTS`): `{"projects": [{"name", "repo", "path", "commands": {"deploy": …}}]}`.
import { readFileSync } from 'node:fs';

/** The commands of the steps - run with `sh -c` in the folder of the project, with `ORCH_*` in the
  * environment (see commandEnv in testRun.ts). */
export type StepCommands = {
  /** the plan of the merge of the spec `$ORCH_SPEC_DIR`, written to `$ORCH_PLAN_FILE` - it changes nothing (the preview) */
  check: string;
  /** merges the spec `$ORCH_SPEC_DIR` into the code and writes its plan to `$ORCH_PLAN_FILE` */
  merge: string;
  test: string;
  /** builds the release `$ORCH_VERSION` */
  release: string;
  /** brings `$ORCH_VERSION` to the test environment - the company's */
  deploy: string;
  simulate: string;
  /** checks that the engine has the BPMN/DMN of the project - none: not checked */
  checkImport?: string;
};

export type Project = {
  name: string;
  /** the URL git clones from */
  repo: string;
  /** the folder of the project in the repo - `` for a repo that is the project */
  path: string;
  develop: string;
  master: string;
  /** where pull requests are opened - none: «Übergeben» is not possible */
  gitHost?: { kind: 'github'; repo: string; api?: string };
  /** «Übergeben» merges itself (P7) */
  autoMerge: boolean;
  /** the app on the test environment, for the status */
  testUrl?: string;
  /** the most a step may take */
  timeoutMinutes: number;
  commands: StepCommands;
};

/** The steps of a project of Orchescala - only `deploy` is the company's. `sbt test` would run the
  * simulations too, against a worker on the host. The simulations with `testFull` (sbt 2): `test` takes
  * what did not change from its cache - but the test environment did change. */
export const DEFAULT_COMMANDS: Omit<StepCommands, 'deploy'> = {
  check: './helper.scala processFromSpec --check --from "$ORCH_SPEC_DIR" --json "$ORCH_PLAN_FILE"',
  merge: './helper.scala processFromSpec --merge --from "$ORCH_SPEC_DIR" --markers --yes --json "$ORCH_PLAN_FILE"',
  test: 'sbt --server -batch "compile; worker/test"',
  release: './helper.scala publish "$ORCH_VERSION"',
  simulate: 'sbt --server -batch simulation/testFull',
};
export const DEFAULT_TIMEOUT_MINUTES = 30;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** A project as configured - or what is wrong with it. */
export function parseProject(v: unknown): Project | string {
  if (!isObject(v)) return 'a project is no object';
  const name = text(v.name);
  if (!name) return 'a project has no name';
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return `the name of the project «${name}» is not lower case with digits and «-»`;
  const repo = text(v.repo);
  if (!repo) return `the project «${name}» has no repo`;
  // the URL is in the logs of the runs and in their status - a token in it would be too
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/@]*:[^/@]*@/i.test(repo)) return `the repo of the project «${name}» has a password or token in its URL - use SSH or a credential helper of git`;
  const path = (text(v.path) ?? '').replace(/^\/+|\/+$/g, '');
  if (path.split('/').includes('..')) return `the path of the project «${name}» leaves the repo: «${path}»`;
  const commands = isObject(v.commands) ? v.commands : {};
  const deploy = text(commands.deploy);
  if (!deploy) return `the project «${name}» has no command «deploy» - how its version gets to the test environment`;
  const host = v.gitHost;
  if (host !== undefined && !(isObject(host) && host.kind === 'github' && text(host.repo)))
    return `the gitHost of the project «${name}» is not {"kind": "github", "repo": "<owner>/<name>"}`;
  const timeout = v.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES;
  if (typeof timeout !== 'number' || !(timeout > 0)) return `timeoutMinutes of the project «${name}» is no number above 0`;
  const testUrl = text(v.testUrl);
  const checkImport = text(commands.checkImport);
  return {
    name,
    repo,
    path,
    develop: text(v.develop) ?? 'develop',
    master: text(v.master) ?? 'master',
    ...(isObject(host) ? { gitHost: { kind: 'github' as const, repo: text(host.repo)!, ...(text(host.api) ? { api: text(host.api)! } : {}) } } : {}),
    autoMerge: v.autoMerge === true,
    ...(testUrl ? { testUrl } : {}),
    timeoutMinutes: timeout,
    commands: {
      check: text(commands.check) ?? DEFAULT_COMMANDS.check,
      merge: text(commands.merge) ?? DEFAULT_COMMANDS.merge,
      test: text(commands.test) ?? DEFAULT_COMMANDS.test,
      release: text(commands.release) ?? DEFAULT_COMMANDS.release,
      deploy,
      simulate: text(commands.simulate) ?? DEFAULT_COMMANDS.simulate,
      ...(checkImport ? { checkImport } : {}),
    },
  };
}

/** The projects of a configuration - or the first thing that is wrong. */
export function parseProjects(v: unknown): Project[] | string {
  if (!isObject(v) || !Array.isArray(v.projects)) return 'no list «projects»';
  const parsed = v.projects.map(parseProject);
  const wrong = parsed.find((p) => typeof p === 'string');
  if (typeof wrong === 'string') return wrong;
  const projects = parsed as Project[];
  const twice = projects.find((p, i) => projects.findIndex((q) => q.name === p.name) !== i);
  return twice ? `the project «${twice.name}» is there twice` : projects;
}

export function loadProjects(file: string): Project[] | string {
  try {
    const parsed = parseProjects(JSON.parse(readFileSync(file, 'utf8')) as unknown);
    return typeof parsed === 'string' ? `${file}: ${parsed}` : parsed;
  } catch (e) {
    return `${file}: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** The folder of the repo in the workspace - the last part of its URL. */
export const repoName = (project: Project) => project.repo.replace(/\/+$/, '').replace(/\.git$/, '').split(/[/:]/).pop() || 'repo';

/** `orch-spec/<project>/<work>` (P5). */
export const workBranch = (project: Project, work: string) => `orch-spec/${project.name}/${work}`;
