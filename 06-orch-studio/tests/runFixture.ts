// A company repo for the tests of the runs: bare, with `develop` and the project `projects/app`, a
// workspace of the studio and the project as configured. The commands of the project are small shell
// scripts that behave like the real ones - they copy the spec, write a plan and JUnit reports, and can
// fail; what they did is in `calls`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { memoryLog } from '../src/log.ts';
import { exec } from '../src/run/exec.ts';
import type { GitHost } from '../src/run/gitHost.ts';
import { parseProject, type Project } from '../src/run/project.ts';
import { pathsOf, type RunStatus } from '../src/run/status.ts';
import type { Deps } from '../src/run/testRun.ts';

export const ME = { GIT_AUTHOR_NAME: 'Dev', GIT_AUTHOR_EMAIL: 'dev@democompany.ch', GIT_COMMITTER_NAME: 'Dev', GIT_COMMITTER_EMAIL: 'dev@democompany.ch' };
export const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: { ...process.env, ...ME }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
export const write = (file: string, text: string) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};
export const RE = { name: 'Rita RE', email: 're@democompany.ch' };
export const BRANCH = 'orch-spec/app/filiale';

/** A company repo (bare, with `develop`) with the project `projects/app`, a workspace of the studio and
  * the project as configured - its commands write what they did to `calls`. */
export function fixture(over: Partial<Project> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'run-'));
  const origin = join(root, 'company.git');
  const dev = join(root, 'dev');
  const calls = join(root, 'calls.txt');
  git(root, 'init', '-q', '--bare', '-b', 'develop', origin);
  git(root, 'init', '-q', '-b', 'develop', dev);
  write(join(dev, '.gitignore'), 'target/\n');
  write(join(dev, 'projects/app/project/ProjectDef.scala'), 'object ProjectDef {\n  val version = "0.1.0-SNAPSHOT"\n}\n');
  write(join(dev, 'projects/app/spec/config/model.json'), '{"v":1}\n');
  write(join(dev, 'projects/app/src/Main.scala'), 'object Main\n');
  git(dev, 'add', '-A');
  git(dev, 'commit', '-q', '-m', 'the project');
  git(dev, 'remote', 'add', 'origin', origin);
  git(dev, 'push', '-q', 'origin', 'develop');
  const report = (dir: string, tests: number, failures: string) =>
    `mkdir -p target/out/${dir}/test-reports && printf '<testsuite name="a" tests="${tests}" failures="%s" errors="0" skipped="0">' ${failures} > target/out/${dir}/test-reports/a.xml`;
  const plan = `if [ -f "$ORCH_SPEC_DIR/conflict" ]; then echo '{"summary":{"conflict":1},"files":[{"path":"projects/app/src/Main.scala","action":"conflict"}]}' > "$ORCH_PLAN_FILE"; `
    + `else echo '{"summary":{"update":2,"conflict":0},"files":[{"path":"a","action":"update"},{"path":"b","action":"unchanged"}]}' > "$ORCH_PLAN_FILE"; fi`;
  const project = parseProject({
    name: 'app', repo: origin, path: 'projects/app', testUrl: 'http://localhost:8889/app/app',
    gitHost: { kind: 'github', repo: 'democompany/company' },
    commands: {
      // like `processFromSpec --merge --from`: the spec 1:1, the code generated from it, the plan as JSON
      // like `processFromSpec --check`: only the plan
      check: `echo check >> ${calls}; ${plan}`,
      merge: `echo merge >> ${calls}; rm -rf spec && cp -R "$ORCH_SPEC_DIR" spec && cp spec/config/model.json src/Generated.json && ${plan}`,
      // a spec that says «broken» breaks a test - until development adds src/Fix.scala
      test: `if grep -q broken spec/config/model.json && [ ! -f src/Fix.scala ]; then F=1; else F=0; fi; ${report('worker', 3, '$F')}; echo "error: 1 test failed"; test $F = 0`,
      release: `echo "release $ORCH_VERSION" >> ${calls}; echo "$ORCH_VERSION" > project/version.txt`,
      deploy: `echo "deploy $ORCH_VERSION" >> ${calls}`,
      simulate: report('simulation', 2, '0'),
      checkImport: `echo "checkImport $ORCH_BRANCH" >> ${calls}`,
    },
    ...over,
  }) as Project;
  const clock = { t: Date.parse('2026-11-18T09:00:00Z') };
  const log = memoryLog();
  const prs: { head: string; base: string; title: string; body: string }[] = [];
  const merged: number[] = [];
  const host: GitHost = {
    pullRequest: async (o) => {
      prs.push(o);
      return { url: 'https://github.com/democompany/company/pull/14', number: 14, merged: false };
    },
    merge: async (n) => void merged.push(n),
  };
  const deps: Deps = {
    exec, workspace: join(root, 'workspace'), log, committer: { name: 'Orch Studio', email: 'studio@democompany.ch' },
    now: () => new Date((clock.t += 1000)),
    gitHost: () => host,
  };
  /** a spec of orch-spec in a folder of its own */
  const spec = (name: string, model: string, extra: Record<string, string> = {}) => {
    const dir = join(root, 'specs', name);
    write(join(dir, 'config/model.json'), model);
    Object.entries(extra).forEach(([file, text]) => write(join(dir, file), text));
    return dir;
  };
  /** development on the work branch: a commit with these files, pushed */
  const fix = (files: Record<string, string>, branch = BRANCH) => {
    git(dev, 'fetch', '-q', 'origin');
    git(dev, 'checkout', '-q', '-B', branch, `origin/${branch}`);
    Object.entries(files).forEach(([file, text]) => write(join(dev, file), text));
    git(dev, 'add', '-A');
    git(dev, 'commit', '-q', '-m', 'the fix');
    git(dev, 'push', '-q', 'origin', branch);
  };
  const p = pathsOf(deps.workspace, project);
  return {
    root, origin, dev, project, deps, clock, log, prs, merged, spec, fix, p,
    calls: () => (existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : []),
    onBranch: (file: string, branch = BRANCH) => git(origin, 'show', `${branch}:${file}`),
    done: () => rmSync(root, { recursive: true, force: true }),
  };
}

export const ok = (r: RunStatus | string): RunStatus => {
  assert.equal(typeof r, 'object', String(r));
  return r as RunStatus;
};

