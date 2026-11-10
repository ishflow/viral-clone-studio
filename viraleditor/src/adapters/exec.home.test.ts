import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { timeoutWhenReady } from '../testing/timeout-when-ready.ts';

// rmSync is replaced by a wrapper that can be told to fail: the clean-up of a HOME must never take the worker down (SEC2 fix round, I1).
const rm = vi.hoisted(() => ({ calls: [] as { path: string; options: unknown }[], failWith: null as string | null }));
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    rmSync: (path: string, options?: unknown) => {
      rm.calls.push({ path: String(path), options });
      if (rm.failWith !== null && String(path).includes('viraleditor-')) throw Object.assign(new Error(`${rm.failWith}: directory not empty`), { code: rm.failWith });
      return real.rmSync(path, options as never);
    },
  };
});

const { ExecError, runProcess } = await import('./exec.ts');
const { createClaudeLlm } = await import('./llm.ts');

const mine = (dir: string): string[] => readdirSync(dir).filter((n) => n.startsWith('viraleditor-'));

describe('the clean-up of an isolated HOME (SEC2 fix round, I1)', () => {
  const savedTmp = process.env.TMPDIR;
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-home-tmp-')); process.env.TMPDIR = tmp; rm.calls = []; rm.failWith = null; });
  afterEach(() => { if (savedTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = savedTmp; rm.failWith = null; });

  it('a failing removal does not throw out of the run: the result still comes back', async () => {
    rm.failWith = 'ENOTEMPTY';
    const r = await runProcess(process.execPath, ['-e', 'console.log("ok")'], { isolatedHome: true });
    expect(r).toMatchObject({ code: 0, stdout: 'ok\n' });
  });
  it('a failing removal after a timeout still ends in the timeout error (the promise settles, nothing is thrown from the timer)', async () => {
    rm.failWith = 'EBUSY';
    await expect(runProcess(process.execPath, ['-e', 'setTimeout(()=>{},5000)'], { isolatedHome: true, timeoutMs: 300 })).rejects.toMatchObject({ code: 'timeout' });
    // the removal runs when the killed child is gone: an uncaught error would fail the file here
    await vi.waitFor(() => expect(rm.calls.some((c) => c.path.includes('viraleditor-home-'))).toBe(true), { timeout: 20_000 });
  });
  it('the removal retries (maxRetries / retryDelay), because a child that was just killed may still be writing', async () => {
    await runProcess(process.execPath, ['-e', '0'], { isolatedHome: true });
    const call = rm.calls.find((c) => c.path.includes('viraleditor-home-'));
    expect(call?.options).toMatchObject({ recursive: true, force: true, maxRetries: expect.any(Number), retryDelay: expect.any(Number) });
    expect((call!.options as { maxRetries: number }).maxRetries).toBeGreaterThan(0);
  });
  it('a child that keeps writing into HOME while the timeout fires: the run is a timeout error and the HOME is gone once the child is', { timeout: 60_000 }, async () => {
    const script = 'const fs=require("node:fs");console.log(process.env.HOME);let i=0;for(;;){try{fs.writeFileSync(process.env.HOME+"/f"+(i++%50),"x".repeat(1000))}catch{}}';
    let home = '';
    // the timeout counts from the moment the child is writing into its HOME: a child that is slow to start (a loaded machine) must not be killed before it is up
    await expect(timeoutWhenReady(
      () => runProcess(process.execPath, ['-e', script], { isolatedHome: true, timeoutMs: 700, onData: (c) => { home = c.trim(); } }),
      () => home !== '' && existsSync(home) && readdirSync(home).length > 0,
      700,
    )).rejects.toMatchObject({ code: 'timeout' });
    for (let i = 0; i < 1000 && existsSync(home); i++) await new Promise((r) => setTimeout(r, 50));
    expect(home).not.toBe('');
    expect(existsSync(home)).toBe(false);
  });
  it('a spawn that throws at once does not leak its HOME', async () => {
    await expect(runProcess(process.execPath, ['a\0b'], { isolatedHome: true })).rejects.toBeInstanceOf(ExecError);
    expect(mine(tmp)).toEqual([]);
  });
  it('llm: a failing removal of the call\'s folders neither hides the answer nor a real error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 've-llm-rm-'));
    const bin = join(dir, 'claude');
    writeFileSync(bin, '#!/bin/sh\ncat > /dev/null\necho \'{"n":1}\'\n');
    chmodSync(bin, 0o755);
    const saved = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-token-made-up';
    try {
      rm.failWith = 'EBUSY';
      expect(await createClaudeLlm(bin).run({ prompt: 'p', files: [], schema: z.object({ n: z.number() }) })).toEqual({ n: 1 });
      writeFileSync(bin, '#!/bin/sh\ncat > /dev/null\necho broken >&2\nexit 3\n');
      await expect(createClaudeLlm(bin).run({ prompt: 'p', files: [], schema: z.object({ n: z.number() }) })).rejects.toThrow(/claude exited 3: broken/);
    } finally {
      if (saved === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN; else process.env.CLAUDE_CODE_OAUTH_TOKEN = saved;
    }
    expect(readFileSync(bin, 'utf8')).toContain('exit 3');
  });
});
