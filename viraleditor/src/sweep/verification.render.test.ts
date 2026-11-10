// C1d mitigation smoke: the actual renderer decodes and verifies two renders before publishing.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createMeasure } from '../adapters/measure.ts';
import { createRenderer } from '../adapters/renderer.ts';
import { compose } from '../compose/index.ts';
import { writeComposition } from '../compose/write.ts';
import { captionsFill } from './documents.ts';
import { FFMPEG, FFPROBE, sweepMedia } from './media.ts';
import { available } from './run.ts';

it.skipIf(!available)('verifies the repeated decoded picture with the real CLI before publication', async () => {
  const media = sweepMedia(), edit = captionsFill();
  const dir = mkdtempSync(join(tmpdir(), 've-c1d-verification-'));
  writeComposition(dir, compose(edit, media.facts), media.sources);
  const renderer = createRenderer({ bin: join(import.meta.dirname, '../../node_modules/.bin/hyperframes'), ffmpeg: FFMPEG, ffprobe: FFPROBE,
    measure: createMeasure(FFMPEG, FFPROBE), verifyRepeat: true, timeoutMs: 180_000 });
  const facts = await renderer.render(dir, join(dir, 'verified.mp4'), () => {});
  expect(facts.frames).toBe(edit.frames);
  const passes = facts.stages.filter(stage => stage.stage === 'picture-verify').length;
  expect(passes).toBeGreaterThanOrEqual(2);
  expect(passes).toBeLessThanOrEqual(3);
}, 300_000);
