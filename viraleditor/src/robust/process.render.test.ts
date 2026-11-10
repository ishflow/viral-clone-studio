// C6 cases 1 and 7 with the real HyperFrames CLI, Chrome and ffmpeg: a render whose parent dies, a render past its time limit.
// `VE_RENDER=1 pnpm vitest run src/robust`. Every process of a test is found by the test's own folder (see harness.ts).
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeFixtureComposition } from '../adapters/fixtures/composition.ts';
import { FFMPEG, canRender, childRender, processesOf, short, until } from './harness.ts';
import type { ChildRender } from './harness.ts';

const T = 300_000;
/** Ends what a test left (a test may kill what it started) and says what that was. */
function reap(base: string): string[] {
  const left = processesOf(base);
  for (const p of left) { try { process.kill(p.pid, 'SIGKILL'); } catch { /* gone */ } }
  return left.map(short);
}
async function setup(name: string) {
  const base = mkdtempSync(join(tmpdir(), `ve-robust-${name}-`));
  const dir = join(base, 'comp');
  await writeFixtureComposition(dir, { master: { lufs: -14, peak: -1 }, ffmpeg: FFMPEG });
  return { base, dir, out: join(base, 'out'), to: join(base, 'out', 'video.mp4'), tmp: join(base, 'tmp') };
}
async function stopAt(r: ChildRender, frame: number, signal: NodeJS.Signals): Promise<void> {
  expect(await until(() => r.frame() >= frame || r.lines.some((l) => /^(done|failed)/.test(l)), 120_000, 50)).toBe(true);
  expect(r.lines.some((l) => /^(done|failed)/.test(l)), 'the render ended before it could be stopped').toBe(false);
  r.child.kill(signal);
  await r.exited;
}

describe.skipIf(!canRender)('the parent of a render dies (C6 case 1)', () => {
  for (const [signal, frame] of [['SIGTERM', 30], ['SIGKILL', 1]] as const) {
    it(`${signal} at frame ${frame}: within 10 s no process of the render is left, no file is at the target, and the next render into the same target succeeds and leaves only its file`, { timeout: T }, async () => {
      const s = await setup(signal.toLowerCase());
      const first = childRender(s.dir, s.to, s.tmp);
      await stopAt(first, frame, signal);
      const clean = await until(() => processesOf(s.base).length === 0, 10_000);
      const left = reap(s.base);
      expect(clean, `left after 10 s: ${left.join(', ')}`).toBe(true);
      expect(existsSync(s.to)).toBe(false);
      const next = childRender(s.dir, s.to, s.tmp);
      await next.exited;
      expect(next.lines.at(-1)).toBe('done');
      expect(readdirSync(s.out)).toEqual(['video.mp4']);                // the dead render's temp file and the CLI's work folders are gone
      expect(reap(s.base)).toEqual([]);
    });
  }
});

describe.skipIf(!canRender)('a render past its time limit (C6 case 7)', () => {
  it('the render is a RenderError on time and within 10 s nothing of it runs: CLI, Chrome, ffmpeg (before the fix Chrome lived 2-3 minutes)', { timeout: T }, async () => {
    const s = await setup('limit');
    const r = childRender(s.dir, s.to, s.tmp, 2500);
    await r.exited;
    expect(r.lines.at(-1)).toMatch(/^failed .*did not finish within 2500 ms/);
    const clean = await until(() => processesOf(s.base).length === 0, 10_000);
    const left = reap(s.base);
    expect(clean, `left after 10 s: ${left.join(', ')}`).toBe(true);
    expect(existsSync(s.to)).toBe(false);
  });
});
