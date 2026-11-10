// FINDING 1 (C1c): the cause, made certain. A composition's CSS animations used to run on the wall clock from the moment the
// page drew its first frame until HyperFrames 0.8.120's runtime first sought them. The runtime finds the animations it seeks
// with document.getAnimations(), which leaves out an animation that has ended and fills nothing after its end (fill none or
// backwards). Such an element then gets the runtime's fallback (inline animation-delay, paused), which holds the animation
// at the time it had reached: on frame 60 of document 08 the one-frame word NOW stays unlit and group 4 shows at rest instead
// of entering. Under load the page draws before the runtime starts often enough (1 render in 7 to 40 in the sweep).
// Here the gap is made certain: a 200 MB script at the end of the body keeps the parser waiting while the page draws.
// css.ts now holds every animation paused (`animation-play-state: paused !important`), so it stands at 0 until it is sought.
import { linkSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync, writeSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { createMeasure } from '../adapters/measure.ts';
import { createRenderer } from '../adapters/renderer.ts';
import { compose } from '../compose/index.ts';
import { writeComposition } from '../compose/write.ts';
import { count, decode, frameMd5 } from '../compose/golden-helpers.ts';
import { parseEdit } from '../edit/schema.ts';
import type { Timeline } from '../edit/timeline.ts';
import { captionsFill } from './documents.ts';
import { streamFrames } from './frames.ts';
import { FFMPEG, FFPROBE, sweepMedia } from './media.ts';
import { SLOW, available } from './run.ts';

const BIN = join(fileURLToPath(new URL('../..', import.meta.url)), 'node_modules/.bin/hyperframes');
const PAUSED = '#root, #root * { animation-play-state: paused !important; }';
const GAP_MB = 200;
const FRAME = 60;                                       // cap-4 enters, its first word NOW is active for this frame only

/** A script of `mb` megabytes that does nothing (one comment). */
function bigScript(file: string, mb: number): void {
  const fd = openSync(file, 'w');
  try {
    writeSync(fd, '/*');
    const chunk = ' '.repeat(1 << 20);
    for (let i = 0; i < mb; i++) writeSync(fd, chunk);
    writeSync(fd, '*/\n');
  } finally { closeSync(fd); }
}

describe.skipIf(!available)('FINDING 1: a composition stands still until HyperFrames seeks it', () => {
  let timeline: Timeline;
  const sums: Record<string, string[]> = {};
  const ink: Record<string, { red: number; green: number }[]> = {};       // per frame, in the caption box
  const word: Record<string, { lit: number; unlit: number }> = {};

  beforeAll(async () => {
    const media = sweepMedia();
    const parsed = parseEdit(captionsFill());
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues).slice(0, 500));
    const composition = compose(parsed.edit, media.facts);
    timeline = composition.timeline;
    const root = mkdtempSync(join(tmpdir(), 've-paused-'));
    const big = join(root, 'big.js');
    bigScript(big, GAP_MB);
    const renderer = createRenderer({ bin: BIN, ffmpeg: FFMPEG, ffprobe: FFPROBE, measure: createMeasure(FFMPEG, FFPROBE), quality: 'draft', timeoutMs: 10 * 60_000 });
    const group = timeline.captions.find((c) => c.at === FRAME)!;
    const box = group.rect;                             // every group of document 08 lies in this box (one caption box)
    // name → [keep the paused rule, add the gap]
    const cases: Record<string, [boolean, boolean]> = { calm: [true, false], gap: [true, true], 'gap-without-rule': [false, true] };
    for (const [name, [rule, gap]] of Object.entries(cases)) {
      const dir = join(root, name);
      mkdirSync(dir);
      writeComposition(dir, composition, media.sources);
      const index = join(dir, 'index.html');
      let html = readFileSync(index, 'utf8');
      if (!html.includes(PAUSED)) throw new Error('compose does not write the paused rule');
      if (!rule) html = html.replace(PAUSED, '');
      if (gap) { linkSync(big, join(dir, 'big.js')); html = html.replace('</body>', '<script src="big.js"></script>\n  </body>'); }
      writeFileSync(index, html);
      const out = join(dir, 'out.mp4');
      await renderer.render(dir, out, () => {});
      sums[name] = frameMd5(out);
      const sumsOfInk: { red: number; green: number }[] = [];
      await streamFrames(out, timeline.width, timeline.height, (n, p) => {
        let red = 0; let green = 0;
        for (let y = box.y; y < box.y + box.height; y++) for (let x = box.x; x < box.x + box.width; x++) { const i = (y * p.width + x) * 3; red += p.rgb[i]!; green += p.rgb[i + 1]!; }
        sumsOfInk[n] = { red, green };
      });
      ink[name] = sumsOfInk;
      const picture = decode(out, timeline.width, timeline.height, [FRAME]).get(FRAME)!;
      // colour mode: the active colour is #00ff00, the fill #ff0000 (both at the group's enter opacity on this frame)
      word[name] = {
        lit: count(picture, group.rect, (r, g) => g > 60 && g > r + 40).n,
        unlit: count(picture, group.rect, (r, g) => r > 60 && r > g + 40).n,
      };
    }
  }, SLOW);

  /** Frames whose red or green ink in the caption box is more than 3 % away from the calm render's. */
  const apart = (name: string): number[] => ink[name]!.map((v, k) => {
    const c = ink.calm![k]!;
    const off = (a: number, b: number) => Math.abs(a - b) > 0.03 * Math.max(a, b, 1);
    return off(v.red, c.red) || off(v.green, c.green) ? k : -1;
  }).filter((k) => k >= 0);

  it('without the rule, the gap leaves NOW unlit on frame 60 (the fault of the sweep, reproduced on purpose)', () => {
    expect(word['gap-without-rule']!.lit, JSON.stringify(word)).toBe(0);
    expect(apart('gap-without-rule')).toContain(FRAME);
  });

  // Not framemd5: a second, smaller difference remains under load (a block of a few hundred pixels redrawn slightly
  // otherwise on a few frames, seen in 1 of 29 renders of the fixed document; see the accuracy sweep, FINDING 1). The race
  // moves the caption ink by far more than 3 % (NOW: all of its green; group 4's enter: half of the group's ink).
  it('with the rule, the same gap changes nothing: the caption ink of every frame is the calm render\'s, and NOW is lit on frame 60', () => {
    expect(word.gap!.lit, JSON.stringify(word)).toBeGreaterThan(1000);
    expect(word.calm!.lit, JSON.stringify(word)).toBeGreaterThan(1000);
    expect(apart('gap'), `framemd5 differs on ${sums.gap!.filter((s, k) => s !== sums.calm![k]).length} frames`).toEqual([]);
  });
});
