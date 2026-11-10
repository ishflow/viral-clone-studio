// The robustness harness (C6): tools, the processes of a test, a render in a child process.
import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const FFMPEG = '/opt/homebrew/bin/ffmpeg';
export const FFPROBE = '/opt/homebrew/bin/ffprobe';
export const HYPERFRAMES = resolve(import.meta.dirname, '../../node_modules/.bin/hyperframes');
const CHROME = join(homedir(), '.cache', 'hyperframes', 'chrome');
/** The real CLI, Chrome and ffmpeg are installed: the render tests can run. */
export const canRender = existsSync(HYPERFRAMES) && existsSync(FFMPEG) && existsSync(FFPROBE) && existsSync(CHROME) && readdirSync(CHROME).length > 0;

export interface Proc { pid: number; ppid: number; command: string }
export function processes(): Proc[] {
  return execFileSync('/bin/ps', ['-A', '-ww', '-o', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), command: m[3]! }] : [];
  });
}
/** The processes whose command line names `path` (a test's own folder), and everything below them. */
export function processesOf(path: string): Proc[] {
  const all = processes();
  const found = new Map(all.filter((p) => p.command.includes(path) && !p.command.startsWith('/bin/ps')).map((p) => [p.pid, p]));
  for (let grew = true; grew;) {
    grew = false;
    for (const p of all) if (!found.has(p.pid) && found.has(p.ppid)) { found.set(p.pid, p); grew = true; }
  }
  return [...found.values()];
}
export const short = (p: Proc): string => `${p.pid} ${p.command.split(' ')[0]!.split('/').pop()}`;

export async function until(check: () => boolean, ms: number, every = 200): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end;) { if (check()) return true; await new Promise((r) => setTimeout(r, every)); }
  return check();
}

export interface ChildRender { child: ChildProcess; lines: string[]; frame: () => number; exited: Promise<{ code: number | null; signal: string | null }> }
/** `render-child.ts` on `dir` into `to`, with TMPDIR in `tmp` (so Chrome's profile, and with it Chrome's command line, names the test's folder). */
export function childRender(dir: string, to: string, tmp: string, timeoutMs?: number): ChildRender {
  mkdirSync(tmp, { recursive: true });
  const env: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: tmp, HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1' };
  const child = spawn(process.execPath, [join(import.meta.dirname, 'render-child.ts'), dir, to, ...(timeoutMs ? [String(timeoutMs)] : [])], { stdio: ['ignore', 'pipe', 'ignore'], env });
  const lines: string[] = [];
  let frame = 0;
  child.stdout!.setEncoding('utf8').on('data', (d: string) => {
    for (const line of d.split('\n').filter(Boolean)) {
      lines.push(line);
      const m = /^progress (\d+)/.exec(line);
      if (m) frame = Math.max(frame, Number(m[1]));
    }
  });
  const exited = new Promise<{ code: number | null; signal: string | null }>((r) => child.on('exit', (code, signal) => r({ code, signal })));
  return { child, lines, frame: () => frame, exited };
}

