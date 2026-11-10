// One thing wrong, as every command reports it: a stable code, where it is, what is wrong and what to do about it.
import { CLI_CODES } from './codes.ts';
import type { CliCode } from './codes.ts';

export interface Issue {
  code: string;
  path?: string;       // a place in the edit document: 'shots[2].in.frames', 'media.clip'
  target?: string;     // what it is about when that is not (only) a place in the document: a file, an element, a flag, a tool
  message: string;
  fix: string;
  at?: number;         // a frame of the video
}

/** An issue of the command line itself; without `fix` it takes the table's. */
export function issue(code: CliCode, where: { path?: string; target?: string }, message: string, fix?: string): Issue {
  return { code, ...where, message, fix: fix ?? CLI_CODES[code].fix };
}

/** Thrown anywhere inside a command to end it with these issues (a missing file, a tool that failed). */
export class Stop extends Error {
  issues: Issue[];
  result: unknown;     // what the answer carries as `result` beside the issues; default null
  constructor(issues: Issue[], result: unknown = null) { super(issues[0]?.message ?? 'stopped'); this.name = 'Stop'; this.issues = issues; this.result = result; }
}

/** A path as it can be pasted into a shell: in single quotes when it holds anything a shell would read differently. */
export function sh(path: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;
}
