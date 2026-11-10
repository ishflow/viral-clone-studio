import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function dataDir(): string {
  const env = process.env.VC_DATA_DIR;
  return env ? resolve(env) : join(repoRoot, 'data');
}

/** A path under the data dir, relative to it, using `/`. */
export function rel(...parts: string[]): string {
  return parts.join('/').split(/[\\/]+/).filter(Boolean).join('/');
}

/** Absolute path of a data-relative path; throws when it leaves the data dir. */
export function abs(relative_: string): string {
  const root = dataDir();
  if (isAbsolute(relative_)) throw new Error(`path outside the data dir: ${relative_}`);
  const full = resolve(root, relative_);
  const back = relative(root, full);
  if (back === '..' || back.startsWith('..' + sep) || isAbsolute(back)) throw new Error(`path outside the data dir: ${relative_}`);
  return full;
}
