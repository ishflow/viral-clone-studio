import type * as Fs from 'node:fs';
import type * as Path from 'node:path';
const fs = (): typeof Fs => process.getBuiltinModule('node:fs');
const path = (): typeof Path => process.getBuiltinModule('node:path');
const LOCK_FILE = 'site.lock';
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; } };
export function takeLock(dir: string): boolean {
  const file = path().join(dir, LOCK_FILE);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs().writeFileSync(file, String(process.pid), { flag: 'wx' });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return false;
    }
    try {
      const pid = Number(fs().readFileSync(file, 'utf8'));
      // A creator may still be writing its pid: an empty or malformed lock is never stolen.
      if (!Number.isInteger(pid) || pid <= 0) return false;
      if (pid === process.pid) return true;
      if (Number.isInteger(pid) && pid > 0 && alive(pid)) return false;
      fs().unlinkSync(file);                                  // stale (or unreadable): the next round takes it
    } catch { /* gone meanwhile */ }
  }
  return false;
}

/** Fail closed before reading or mutating the site's cached store. */
export function assertSiteOwner(dir: string): void {
  fs().mkdirSync(dir, { recursive: true });
  if (!takeLock(dir)) throw new Error('site-not-started: another site process owns site.lock');
}

