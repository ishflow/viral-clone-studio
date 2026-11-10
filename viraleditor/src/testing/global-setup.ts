import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRoot, removeStaleRoots } from './temp-root.ts';

// One temp root per Vitest run (this module runs once, in the main process). Workers and their children inherit TMPDIR.
export default function setup(): () => void {
  const parent = tmpdir();
  removeStaleRoots(parent);
  const root = createRoot(parent);
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = root;
  return () => {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
    rmSync(root, { recursive: true, force: true });
  };
}
