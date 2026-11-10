import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const PREFIX = 've-run-';

/** True when a process with this pid exists (signal 0 only checks). EPERM means it exists but is not ours. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/** Removes every `ve-run-<pid>-*` folder in `parent` whose pid is not alive. Returns the removed folder names. */
export function removeStaleRoots(parent: string, alive: (pid: number) => boolean = pidAlive): string[] {
  const removed: string[] = [];
  for (const name of readdirSync(parent)) {
    const match = /^ve-run-(\d+)-/.exec(name);
    if (!match || alive(Number(match[1]))) continue;
    rmSync(join(parent, name), { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

/** Creates `<parent>/ve-run-<pid>-XXXXXX` for this process. */
export function createRoot(parent: string, pid: number = process.pid): string {
  return mkdtempSync(join(parent, `${PREFIX}${pid}-`));
}
