// FINDING 1: one composition folder rendered again and again did not always give the same frames. Seen first as two renders
// of documents 07 and 08 that differed by framemd5 (46 and 65 frames, from frame 55 on, all inside the caption rect); in the
// odd render the one-frame word NOW (group 4's first word, frame 60) was not lit. Cause (C1c, paused.render.test.ts): the
// CSS animations ran on the wall clock until HyperFrames first sought them, and a short one that had ended by then was never
// sought; css.ts now holds every animation paused until it is sought. Each document is rendered twenty times here (a render
// takes about 3 s); every render must light NOW.
import { appendFileSync, cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { frameMd5 } from '../compose/golden-helpers.ts';
import { analyse } from './analyse.ts';
import { captionsFill, captionsPill } from './documents.ts';
import { sweepMedia } from './media.ts';
import { SLOW, available, renderDoc } from './run.ts';

const RENDERS = 20;

describe.skipIf(!available)('sweep repeat: one folder rendered twenty times', () => {
  const seen: Record<string, { differing: number[]; unlit: number[]; lit: number[]; sums: string[]; frames: number[][] }> = {};
  beforeAll(async () => {
    const media = sweepMedia();
    for (const [name, build] of [['07-pill', captionsPill], ['08-fill', captionsFill]] as const) {
      const r = await renderDoc(`repeat-${name}`, build(), media, RENDERS);
      const first = frameMd5(r.outputs[0]!);
      const out = { differing: [] as number[], unlit: [] as number[], lit: [] as number[], sums: [] as string[], frames: [] as number[][] };
      for (const [i, file] of r.outputs.entries()) {
        const sums = frameMd5(file);
        const frames = first.flatMap((v, k) => v !== sums[k] ? [k] : []);
        out.frames.push(frames);
        out.differing.push(frames.length);
        out.sums.push(sums.join(','));
        const a = await analyse(r, media, file);
        if (a.wrong.some((w) => (w.kind === 'caption-lit' || w.kind === 'caption-word') && w.frame === 60)) out.unlit.push(i + 1); else out.lit.push(i + 1);
      }
      seen[name] = out;
      // Optional local diagnostic archive: the test temp root is removed by the existing harness after this run.
      if (process.env.VE_SWEEP_ARTIFACTS) {
        mkdirSync(process.env.VE_SWEEP_ARTIFACTS, { recursive: true });
        cpSync(r.dir, join(process.env.VE_SWEEP_ARTIFACTS, name), { recursive: true, dereference: true, errorOnExist: true, force: false });
      }
    }
    if (process.env.VE_SWEEP_LOG) appendFileSync(process.env.VE_SWEEP_LOG, `${JSON.stringify({ name: 'repeat', renders: RENDERS, seen: Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, { differing: v.differing, frames: v.frames, unlit: v.unlit }])) })}\n`);
  }, SLOW);

  // Before the fix (C1c): NOW unlit in 3 of 24 renders in one run, 1 of 40 and 5 of 40 in others (and 2 of 6, 0 of 5).
  it('FINDING 1 (fixed in C1c): every render lights the one-frame word NOW on frame 60', () => {
    for (const [name, s] of Object.entries(seen)) expect(s.unlit, `${name}: renders that leave NOW unlit on frame 60`).toEqual([]);
  });

  // Not guaranteed yet: under load a second, smaller difference remains (a block of a few hundred pixels redrawn slightly
  // otherwise on a few frames; 1 of 29 renders of the fixed document 08 with 8 busy threads). Kept as a strict gate; a passing batch is not a determinism guarantee.
  it('FINDING 1, second face: every render of one folder is frame-identical', () => {
    for (const [name, s] of Object.entries(seen)) expect(s.differing.filter((n) => n > 0), `${name}: frames differing from render 1, per render`).toEqual([]);
  });

  it('FINDING 1 (recorded in VE_SWEEP_LOG): NOW is lit in most renders, and a render that leaves it unlit is never frame-identical to one that lights it', () => {
    for (const [name, s] of Object.entries(seen)) {
      expect(s.unlit.length, `${name}: unlit renders`).toBeLessThan(RENDERS / 2);
      for (const i of s.unlit) for (const j of s.lit) expect(s.sums[i - 1], `${name}: render ${i} (unlit) and ${j} (lit)`).not.toBe(s.sums[j - 1]);
    }
  });
});
