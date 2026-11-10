import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Variables a child may inherit. Anything else (MAGNIFIC_API_KEY included) is dropped unless a caller names it in `passEnv`.
 * HOME is not one of them (SEC2 I5), but that is not isolation: a child that needs a home still finds the real one through the passwd
 * database (`os.homedir()`, Python's `expanduser`). What keeps the owner's own config (`~/.config/yt-dlp`, `~/.claude`) from a child is
 * `isolatedHome` (an empty HOME of its own) together with the tool's own switch (`--ignore-config`, CLAUDE_CONFIG_DIR). A caller that
 * needs the real value names HOME in `passEnv`.
 */
export const ENV_ALLOW_LIST = ['PATH', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM'];

export interface ExecOptions {
  timeoutMs?: number;                 // default 10 minutes
  cwd?: string;
  input?: string;                     // written to stdin
  env?: Record<string, string>;       // set on top of the allow-listed environment
  passEnv?: string[];                 // extra names copied from process.env
  isolatedHome?: boolean;             // HOME is a new empty folder made for this run and removed when it ends (a user config of the owner cannot reach the tool); wins over `env` and `passEnv`
  onData?: (chunk: string, stream: 'stdout' | 'stderr') => void;   // every chunk, while the child runs
  watch?: { everyMs: number; check: () => string | null };   // called every `everyMs` while the child runs; a text it returns ends the run like a timeout does (ExecError 'limit' with that text)
  killGroup?: boolean;                // the child leads its own process group; the whole group is killed on a timeout, after the child exits, and when this process ends
}
export interface ExecResult { code: number; stdout: string; stderr: string }
export type ExecErrorCode = 'spawn-failed' | 'timeout' | 'output-limit' | 'limit';
export class ExecError extends Error {
  code: ExecErrorCode;
  constructor(code: ExecErrorCode, message: string) { super(message); this.code = code; }
}

export function childEnv(options: Pick<ExecOptions, 'env' | 'passEnv'> = {}, source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of [...ENV_ALLOW_LIST, ...(options.passEnv ?? [])]) {
    const value = source[name];
    if (value !== undefined) out[name] = value;
  }
  const merged = { ...out, ...(options.env ?? {}) };
  delete merged.MAGNIFIC_API_KEY;      // hard guard: no child ever gets the provider key, whatever the caller asks
  return merged;
}

/**
 * Removes a folder made for one run. Never throws: a child that was just killed may still be writing into it for a moment (the removal
 * retries), and a folder that stays is left to the tmp cleaner; it must not replace the result or the real error of the run.
 */
export function removeFolder(path: string): void {
  try { rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* left to the tmp cleaner */ }
}

/** Process groups of children started with `killGroup` that are still running. */
const liveGroups = new Set<number>();
let hooked = false;
/** Every process below `root` (its children, theirs, ...) in one `ps` listing; [] when ps cannot run. */
function descendants(root: number): number[] {
  let listing: string;
  try { listing = execFileSync('/bin/ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8', timeout: 5000 }); } catch { return []; }
  const children = new Map<number, number[]>();
  for (const line of listing.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid && ppid) children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  }
  const found: number[] = [];
  for (const queue = [root]; queue.length > 0;) for (const child of children.get(queue.shift()!) ?? []) { found.push(child); queue.push(child); }
  return found;
}
/** The group, and every process below its leader: a child that started a group of its own (puppeteer starts Chrome so) is not in the group. */
function killGroupOf(pid: number): void {
  let leader = true;
  try { process.kill(pid, 0); } catch { leader = false; }
  const below = leader ? descendants(pid) : [];      // listed while the leader lives: once it is gone its children belong to init
  try { process.kill(-pid, 'SIGKILL'); } catch { /* ESRCH: nothing left in the group */ }
  for (const p of below) { try { process.kill(p, 'SIGKILL'); } catch { /* gone already */ } }
}
/** Kills the group once per child: only while its pid is still in the live set, so a pid the system has reused is never hit. */
function killOnce(pid: number | undefined): void {
  if (pid !== undefined && liveGroups.delete(pid)) killGroupOf(pid);
}
/** With `onData` the caller sees everything as it comes; the result keeps only this much of the end of each stream. */
const KEEP_BYTES = 256 * 1024;
/** Without `onData` the whole output is kept, up to this many characters a stream; more stops the child (ExecError 'output-limit'). */
export const OUTPUT_LIMIT = 64 * 1024 * 1024;
function hookProcessEnd(): void {
  if (hooked) return;
  hooked = true;
  process.on('exit', () => { for (const pid of liveGroups) killGroupOf(pid); });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const handler = () => {
      for (const pid of liveGroups) killGroupOf(pid);
      process.removeListener(signal, handler);
      process.kill(process.pid, signal);          // the process still ends as the signal says
    };
    process.on(signal, handler);
  }
}
/** After the child exited and its group was killed, how long to wait for the pipes to drain before settling with what was read. */
const DRAIN_MS = 500;

/** Runs `bin` with an argument array (never a shell). A non-zero exit is a result, not an exception; a missing binary or a timeout throws ExecError. */
export function runProcess(bin: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const group = options.killGroup === true;
  if (group) hookProcessEnd();
  return new Promise((resolve, reject) => {
    const home = options.isolatedHome ? mkdtempSync(join(tmpdir(), 'viraleditor-home-')) : null;
    const env = home === null ? childEnv(options) : { ...childEnv(options), HOME: home };
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(bin, args, { cwd: options.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], shell: false, detached: group });
    } catch (e) {          // an argument or a variable spawn refuses (a NUL byte): nothing started, so nothing may stay behind
      if (home !== null) removeFolder(home);
      reject(new ExecError('spawn-failed', `cannot start ${bin}: ${e instanceof Error ? e.message : String(e)}`));
      return;
    }
    const pid = child.pid;
    if (group && pid !== undefined) liveGroups.add(pid);
    let stdout = '';
    let stderr = '';
    let settled = false;
    let drain: NodeJS.Timeout | undefined;
    let watcher: NodeJS.Timeout | undefined;
    const stop = () => { if (group) killOnce(pid); };
    const finish = (fn: () => void) => {
      if (!settled) {
        settled = true; clearTimeout(timer); clearTimeout(drain); clearInterval(watcher); stop();
        // SIGKILL is delivered a moment after it is sent: a child that is not gone yet may still write into its HOME, so the folder goes when it is
        if (home !== null) { if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) removeFolder(home); else child.once('exit', () => removeFolder(home)); }
        fn();
      }
    };
    const timer = setTimeout(() => {
      if (group) killOnce(pid); else child.kill('SIGKILL');
      finish(() => reject(new ExecError('timeout', `${bin} did not finish within ${timeoutMs} ms`)));
    }, timeoutMs);
    const watch = options.watch;
    if (watch) {
      watcher = setInterval(() => {
        let why: string | null = null;
        try { why = watch.check(); } catch { /* a check that fails is no verdict: the next tick asks again */ }
        if (why === null || settled) return;
        if (group) killOnce(pid); else child.kill('SIGKILL');
        finish(() => reject(new ExecError('limit', why)));
      }, watch.everyMs);
    }
    const keep = (text: string): string => (options.onData && text.length > KEEP_BYTES ? text.slice(-KEEP_BYTES) : text);
    const tooMuch = (stream: string) => {
      if (group) killOnce(pid); else child.kill('SIGKILL');
      finish(() => reject(new ExecError('output-limit', `${bin} wrote more than ${OUTPUT_LIMIT} characters to ${stream}`)));
    };
    child.stdout.setEncoding('utf8').on('data', (d: string) => { if (settled) return; stdout = keep(stdout + d); options.onData?.(d, 'stdout'); if (stdout.length > OUTPUT_LIMIT) tooMuch('stdout'); });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { if (settled) return; stderr = keep(stderr + d); options.onData?.(d, 'stderr'); if (stderr.length > OUTPUT_LIMIT) tooMuch('stderr'); });
    child.on('error', (e) => finish(() => reject(new ExecError('spawn-failed', `cannot start ${bin}: ${e.message}`))));
    if (group) {
      // settle on 'exit', not on 'close': a grandchild that holds a pipe would keep 'close' away
      child.on('exit', (code) => {
        stop();
        drain = setTimeout(() => finish(() => resolve({ code: code ?? -1, stdout, stderr })), DRAIN_MS);
        child.on('close', () => finish(() => resolve({ code: code ?? -1, stdout, stderr })));
      });
    } else {
      child.on('close', (code) => finish(() => resolve({ code: code ?? -1, stdout, stderr })));
    }
    child.stdin.on('error', () => {});
    child.stdin.end(options.input ?? '');
  });
}
