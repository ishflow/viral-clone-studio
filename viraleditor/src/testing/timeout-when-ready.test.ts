import { describe, expect, it } from 'vitest';
import { runProcess } from '../adapters/exec.ts';
import { timeoutWhenReady } from './timeout-when-ready.ts';

describe('timeoutWhenReady', () => {
  it('fires the timeout only once the child is up, however late that is', async () => {
    let seen = '';
    // the child says "up" after 600 ms, the run's own timeout is 50 ms: counted from the spawn it would end before the child was up
    const script = 'setTimeout(()=>{console.log("up");setTimeout(()=>{},5000)},600)';
    await expect(timeoutWhenReady(
      () => runProcess(process.execPath, ['-e', script], { timeoutMs: 50, onData: (c) => { seen += c; } }),
      () => seen.includes('up'),
      50,
    )).rejects.toMatchObject({ code: 'timeout' });
    expect(seen).toBe('up\n');
  });
  it('returns the result of a run that ends on its own, and leaves real timers behind', async () => {
    const r = await timeoutWhenReady(() => runProcess(process.execPath, ['-e', 'console.log(1)'], { timeoutMs: 5000 }), () => false, 5000);
    expect(r).toMatchObject({ code: 0, stdout: '1\n' });
    const before = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(Date.now() - before).toBeGreaterThanOrEqual(25);
  });
});
