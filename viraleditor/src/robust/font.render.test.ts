// C6 case 4, the render side: the composition's bundled font removed after it was written (writeComposition refuses a missing font
// before writing; this is the font going missing afterwards). Real HyperFrames: `VE_RENDER=1 pnpm vitest run src/robust`.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeFixtureComposition } from '../adapters/fixtures/composition.ts';
import { createMeasure } from '../adapters/measure.ts';
import { createRenderer } from '../adapters/renderer.ts';
import { FFMPEG, FFPROBE, HYPERFRAMES, canRender } from './harness.ts';

describe.skipIf(!canRender)('the bundled font is gone from the composition folder (C6 case 4)', () => {
  const renderer = createRenderer({ bin: HYPERFRAMES, ffmpeg: FFMPEG, ffprobe: FFPROBE, measure: createMeasure(FFMPEG, FFPROBE) });
  const base = mkdtempSync(join(tmpdir(), 've-robust-font-'));
  const dir = join(base, 'comp');
  const ready = (async () => {
    await writeFixtureComposition(dir, { master: null, ffmpeg: FFMPEG });
    for (const font of readdirSync(join(dir, 'assets', 'fonts'))) rmSync(join(dir, 'assets', 'fonts', font));
  })();

  it('check says so: not ok, an issue that names the font file', { timeout: 300_000 }, async () => {
    await ready;
    const { ok, issues } = await renderer.check(dir);
    expect(ok).toBe(false);
    expect(issues.some((i) => /inter-latin-wght-normal\.woff2/.test(`${i.message} ${i.target ?? ''}`)), JSON.stringify(issues).slice(0, 400)).toBe(true);
  });

  // FINDING 7: render does not look at fonts; with the file gone Chrome draws the text in a fallback face and the render succeeds.
  // In the engine every render follows a check, so this only bites a caller that renders without checking (the command line's `render` does both).
  it('FINDING 7 (today): render alone succeeds: 60 frames, no error', { timeout: 300_000 }, async () => {
    await ready;
    expect(await renderer.render(dir, join(base, 'today', 'v.mp4'), () => {})).toMatchObject({ frames: 60, width: 720, height: 1280 });
  });
  it.fails('FINDING 7: render alone refuses a composition whose font file is missing (today it renders with a fallback font, no error)', { timeout: 300_000 }, async () => {
    await ready;
    await expect(renderer.render(dir, join(base, 'out', 'v.mp4'), () => {})).rejects.toThrow();
  });
});
