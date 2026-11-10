import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoot, removeStaleRoots } from './temp-root.ts';

describe('temp root', () => {
  let parent: string;
  beforeEach(() => {
    parent = mkdtempSync(join(tmpdir(), 've-troot-'));
  });
  afterEach(() => rmSync(parent, { recursive: true, force: true }));

  it('removes roots of dead pids, keeps live ones and other folders', () => {
    const dead = join(parent, 've-run-111-aaaaaa');
    const live = join(parent, 've-run-222-bbbbbb');
    const other = join(parent, 've-something');
    for (const d of [dead, live, other]) mkdirSync(d);
    const removed = removeStaleRoots(parent, (pid) => pid === 222);
    expect(removed).toEqual(['ve-run-111-aaaaaa']);
    expect(existsSync(dead)).toBe(false);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(other)).toBe(true);
  });

  it('keeps the root of this very process with the real pid check', () => {
    const mine = createRoot(parent);
    expect(removeStaleRoots(parent)).toEqual([]);
    expect(existsSync(mine)).toBe(true);
  });

  it('runs in the run temp root', () => {
    expect(tmpdir()).toMatch(/ve-run-\d+-/);
  });
});
