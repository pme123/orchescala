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
/** How long the output of a command that has ended is still read: something it started in the background
  * (a server of sbt) may hold its output open for good - the command does not wait for that. */
export const GRACE_MS = 1000;

/** The environment of a command: the studio's, with `env` on top - but none of the studio's own settings
  * (`STUDIO_*`): its token of the Git platform and its key of the AI are not for the commands of a
  * project, and so never in their logs. */
export const commandEnvOf = (env: Record<string, string | undefined> = {}, own: Record<string, string | undefined> = process.env) =>
  Object.fromEntries(Object.entries({ ...own, ...env }).filter(([name, value]) => value !== undefined && !name.startsWith('STUDIO_')));

export const exec: Exec = (cmd, args, o) =>
  new Promise((done) => {
    // its own process group (POSIX), so a time limit ends sbt and what sbt started too
    const child = spawn(cmd, args, { cwd: o.cwd, env: commandEnvOf(o.env), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const log = o.logFile ? createWriteStream(o.logFile, { flags: 'a' }) : undefined;
    // a log that cannot be written (the disk is full) is lost - the command and the studio go on
    log?.on('error', () => undefined);
    const chunks: Buffer[] = [];
    const state = { timedOut: false, ended: false, size: 0 };
    const take = (c: Buffer) => {
      chunks.push(c);
      state.size += c.length;
      // only the end is kept - a command that writes a lot does not fill the memory
      while (chunks.length > 1 && state.size - chunks[0].length >= MAX_OUTPUT) state.size -= chunks.shift()!.length;
      log?.write(c);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const timer = o.timeoutMs
      ? setTimeout(() => {
          state.timedOut = true;
          try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already gone */ }
          // what left the process group lives on and may hold the output - the command ends anyway
          setTimeout(() => end(137), GRACE_MS);
        }, o.timeoutMs)
      : undefined;
    const end = (code: number, extra = '') => {
      if (state.ended) return;
      state.ended = true;
      clearTimeout(timer);
      child.stdout.destroy();
      child.stderr.destroy();
      log?.end(extra);
      done({ code, output: (Buffer.concat(chunks).toString('utf8') + extra).slice(-MAX_OUTPUT), timedOut: state.timedOut });
    };
    child.on('error', (e) => end(127, `${cmd}: ${e.message}\n`));
    child.on('close', (code) => end(code ?? 1));
    // ended, but its output is still open: the rest of it for a moment, then the result
    child.on('exit', (code) => setTimeout(() => end(code ?? 1), GRACE_MS));
  });

/** The last `n` lines - what the status shows of a log. */
export const tail = (text: string, n: number) => text.trimEnd().split('\n').slice(-n).join('\n');
