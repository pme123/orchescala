// A command of a run - git, the merge of Orchescala, sbt, the scripts of the company - as its own
// process of the operating system: with a time limit, its output in a log file and in the result.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';

export type ExecResult = { code: number; output: string; timedOut: boolean };
export type ExecOptions = {
  cwd: string;
  /** on top of the environment of the studio */
  env?: Record<string, string | undefined>;
  /** after this the command and what it started are stopped */
  timeoutMs?: number;
  /** the whole output is appended here */
  logFile?: string;
};
/** Runs `cmd` - never throws: a command that cannot start ends with 127. */
export type Exec = (cmd: string, args: string[], o: ExecOptions) => Promise<ExecResult>;

/** The output kept in the result - the end of it; the log file has all. */
export const MAX_OUTPUT = 1024 * 1024;

export const exec: Exec = (cmd, args, o) =>
  new Promise((done) => {
    // its own process group, so a time limit ends sbt and what sbt started too
    const child = spawn(cmd, args, { cwd: o.cwd, env: { ...process.env, ...o.env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const log = o.logFile ? createWriteStream(o.logFile, { flags: 'a' }) : undefined;
    const chunks: Buffer[] = [];
    const state = { timedOut: false, ended: false };
    const take = (c: Buffer) => {
      chunks.push(c);
      log?.write(c);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const timer = o.timeoutMs
      ? setTimeout(() => {
          state.timedOut = true;
          try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already gone */ }
        }, o.timeoutMs)
      : undefined;
    const end = (code: number, extra = '') => {
      if (state.ended) return;
      state.ended = true;
      clearTimeout(timer);
      log?.end(extra);
      done({ code, output: (Buffer.concat(chunks).toString('utf8') + extra).slice(-MAX_OUTPUT), timedOut: state.timedOut });
    };
    child.on('error', (e) => end(127, `${cmd}: ${e.message}\n`));
    child.on('close', (code) => end(code ?? 1));
  });

/** The last `n` lines - what the status shows of a log. */
export const tail = (text: string, n: number) => text.trimEnd().split('\n').slice(-n).join('\n');
