// Real HyperFrames (`VE_RENDER=1 pnpm vitest run src/compose/windows.render.test.ts`): windows, read frame by frame.
// Fix round 1, agent B: two windows on one shot, swaps inside a window, a video behind a window, a whip and a push into a
// shot that has a window. Pictures are flat colours, so a frame says what is where by colour; clips carry the frame bar.
import { beforeAll, describe, expect, it } from 'vitest';
import { readBar } from '../adapters/framebar.ts';
import type { Timeline } from '../edit/timeline.ts';
import type { Edit } from '../edit/types.ts';
import { available, count, readShot, showsExpected } from './golden-helpers.ts';
import type { Picture } from './golden-helpers.ts';
import { FPS, SLOW, build, colourOf, fakeClips, findings, flatImage, frames, near } from './render-cases.ts';
import type { Made, Media, Rgb } from './render-cases.ts';
import { valueAt } from './testing.ts';

const W = 720;
const H = 1280;
const AREA = W * H;
const share = (picture: Picture, test: (r: number, g: number, b: number) => boolean) => count(picture, { x: 0, y: 0, width: W, height: H }, test).n / AREA;
const probe = { x: 20, y: 600, width: 100, height: 80 };                 // left edge, between the two halves of a frame bar: no window reaches it
const seen = (picture: Picture, test: (r: number, g: number, b: number) => boolean) => count(picture, probe, test).n / (probe.width * probe.height);

/** The bounding box of the pixels that pass a test. */
function bbox(picture: Picture, test: (r: number, g: number, b: number) => boolean): { x0: number; y0: number; x1: number; y1: number; n: number } {
  let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1; let n = 0;
  for (let y = 0; y < picture.height; y++) {
    for (let x = 0; x < picture.width; x++) {
      const i = (y * picture.width + x) * 3;
      if (test(picture.rgb[i]!, picture.rgb[i + 1]!, picture.rgb[i + 2]!)) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  return { x0, y0, x1, y1, n };
}
const range = (from: number, to: number, step = 1) => Array.from({ length: Math.max(0, Math.ceil((to - from) / step)) }, (_, i) => from + i * step);

const RED = 'cc2020'; const GREEN = '20b030'; const BLUE = '2040d0'; const BASE = 'e0c030'; const BASE2 = '30c8d0';
const rgb = (hex: string): Rgb => [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];

async function mediaWithPictures(): Promise<Media> {
  const media = await fakeClips();
  flatImage(media, 'red', RED); flatImage(media, 'green', GREEN); flatImage(media, 'blue', BLUE); flatImage(media, 'base', BASE); flatImage(media, 'base2', BASE2);
  return media;
}
const mediaKeys = (media: Media, keys: string[]) => Object.fromEntries(keys.map((key) => [key, { file: `assets/${key}.${['a', 'b', 'c'].includes(key) ? 'mp4' : 'png'}`, kind: (['a', 'b', 'c'].includes(key) ? 'video' : 'image') as 'video' | 'image' }]));

// ── 1: two windows on one shot, in order ──────────────────────────────────────────────────────────────────────────────

function twoWindows(media: Media): Edit {
  return {
    version: 1, language: 'en', canvas: { width: 720, height: 1280, fps: 30 }, frames: 120,
    media: mediaKeys(media, ['base', 'red', 'green']),
    shots: [{
      id: 's1', at: 0, for: 120, media: 'base',
      windows: [{ at: 6, for: 30, corner: 'bottom-right', behind: 'red' }, { at: 60, for: 30, corner: 'bottom-right', behind: 'green' }],
    }],
  };
}

describe.skipIf(!available)('windows 1: two windows on one shot, in order', () => {
  let made: Made;
  let pictures: Map<number, Picture>;
  const base = near(rgb(BASE));
  beforeAll(async () => {
    const media = await mediaWithPictures();
    made = build(twoWindows(media), media);
    pictures = frames(made, [...range(0, 2), ...range(5, 38), 38, 45, 59, ...range(60, 100), 100, 105, 119]);
  }, SLOW);

  it('passes lint and check', () => {
    expect(made.lint.errorCount).toBe(0);
    expect(made.check.ok, JSON.stringify(findings(made.check))).toBe(true);
  });

  it('shrinks and returns on the frames of each window, and is full frame between and around them', () => {
    const [w1, w2] = made.timeline.windows;
    for (const w of [w1!, w2!]) {
      const areaShare = (w.rect.width * w.rect.height) / AREA;
      const fraction = (f: number) => share(pictures.get(f)!, base);
      expect(fraction(w.at - 1), `full frame on ${w.at - 1}`).toBeGreaterThan(0.98);
      // the shrink: strictly smaller on every frame of its 10, down to the window's own size
      const shrink = range(w.at, w.at + w.frames).map(fraction);
      const grow = range(w.at + w.for - w.frames, w.at + w.for).map(fraction);
      for (let i = 1; i < shrink.length; i++) expect(shrink[i]!, `shrink frame ${w.at + i}: ${shrink.map((v) => v.toFixed(3))}`).toBeLessThan(shrink[i - 1]! + 1e-6);
      for (let i = 1; i < grow.length; i++) expect(grow[i]!, `return frame ${w.at + w.for - w.frames + i}: ${grow.map((v) => v.toFixed(3))}`).toBeGreaterThan(grow[i - 1]! - 1e-6);
      expect(shrink[0]!, 'first shrink frame is still nearly full').toBeGreaterThan(0.7);
      const rest = fraction(w.at + w.frames);
      expect(rest, `rest ${w.at + w.frames}`).toBeGreaterThan(areaShare * 0.8);
      expect(rest, `rest ${w.at + w.frames}`).toBeLessThan(areaShare * 1.2);
      expect(fraction(w.at + w.for - w.frames - 1), 'last rest frame').toBeLessThan(areaShare * 1.2);
      expect(grow.at(-1)!, 'last return frame is nearly full again').toBeGreaterThan(0.7);
      expect(fraction(w.at + w.for), `full frame on ${w.at + w.for}`).toBeGreaterThan(0.98);
    }
    // between the windows: full frame, no picture of either behind
    for (const f of [38, 45, 59]) {
      expect(share(pictures.get(f)!, base), `frame ${f}`).toBeGreaterThan(0.98);
      expect(share(pictures.get(f)!, near(rgb(RED))) + share(pictures.get(f)!, near(rgb(GREEN))), `behind on ${f}`).toBe(0);
    }
    // the first window shows red, the second green, each only while its window runs
    for (const f of [20, 30]) expect(seen(pictures.get(f)!, near(rgb(RED))), `red on ${f}`).toBeGreaterThan(0.95);
    for (const f of [66, 75, 85]) expect(seen(pictures.get(f)!, near(rgb(GREEN))), `green on ${f}`).toBeGreaterThan(0.95);
    for (const f of [66, 75, 85]) expect(seen(pictures.get(f)!, near(rgb(RED))), `red on ${f}`).toBe(0);
    for (const f of [100, 105, 119]) expect(share(pictures.get(f)!, base), `frame ${f}`).toBeGreaterThan(0.98);
  });

  it('rests at the same place in both windows, where the table says', () => {
    for (const [k, w] of made.timeline.windows.entries()) {
      for (const f of [w.at + w.frames, w.at + Math.floor(w.for / 2), w.at + w.for - w.frames - 1]) {
        const box = bbox(pictures.get(f)!, base);
        expect(Math.abs(box.x0 - w.rect.x), `window ${k + 1} x0 on frame ${f}`).toBeLessThanOrEqual(2);
        expect(Math.abs(box.y0 - w.rect.y), `window ${k + 1} y0 on frame ${f}`).toBeLessThanOrEqual(2);
        expect(Math.abs(box.x1 + 1 - (w.rect.x + w.rect.width)), `window ${k + 1} x1 on frame ${f}`).toBeLessThanOrEqual(2);
        expect(Math.abs(box.y1 + 1 - (w.rect.y + w.rect.height)), `window ${k + 1} y1 on frame ${f}`).toBeLessThanOrEqual(2);
      }
    }
  });
});

// ── 2 and 6: swaps inside a window; a video behind a window ───────────────────────────────────────────────────────────

function swapsEdit(media: Media): Edit {
  return {
    version: 1, language: 'en', canvas: { width: 720, height: 1280, fps: 30 }, frames: 230,
    media: mediaKeys(media, ['base', 'base2', 'red', 'green', 'blue', 'b', 'c']),
    shots: [
      { id: 's1', at: 0, for: 110, media: 'base',
        windows: [{ at: 6, for: 90, corner: 'bottom-right', behind: 'red', swaps: [{ at: 40, behind: 'green' }, { at: 70, behind: 'blue' }] }] },
      { id: 's2', at: 110, for: 120, media: 'base2',
        windows: [{ at: 120, for: 100, corner: 'bottom-right', behind: 'b', swaps: [{ at: 160, behind: 'c' }] }] },
    ],
  };
}

describe.skipIf(!available)('windows 2 and 6: swaps and a video behind a window', () => {
  let made: Made;
  let pictures: Map<number, Picture>;
  const swapFrames = [15, 16, 25, 39, 40, 41, 69, 70, 71, 85, 86, 95, 96, 100];
  const videoFrames = [119, 120, 129, 130, 131, 150, 159, 160, 161, 175, 190, 209];
  beforeAll(async () => {
    const media = await mediaWithPictures();
    made = build(swapsEdit(media), media);
    pictures = frames(made, [...swapFrames, ...range(16, 96, 8), ...videoFrames, 110, 111, 225]);
  }, SLOW);

  it('passes lint and check', () => {
    expect(made.lint.errorCount).toBe(0);
    expect(made.check.ok, JSON.stringify(findings(made.check))).toBe(true);
  });

  it('changes the picture behind on the swap frames, and the window does not move', () => {
    const w = made.timeline.windows[0]!;
    expect(w.pictures.map((p) => [p.behind, p.at, p.for])).toEqual([['red', 6, 34], ['green', 40, 30], ['blue', 70, 26]]);
    const colour = (f: number) => (seen(pictures.get(f)!, near(rgb(RED))) > 0.95 ? 'red' : seen(pictures.get(f)!, near(rgb(GREEN))) > 0.95 ? 'green'
      : seen(pictures.get(f)!, near(rgb(BLUE))) > 0.95 ? 'blue' : seen(pictures.get(f)!, near(rgb(BASE))) > 0.95 ? 'base' : 'other');
    const read = Object.fromEntries(swapFrames.map((f) => [f, colour(f)]));
    expect(read).toEqual({ 15: 'red', 16: 'red', 25: 'red', 39: 'red', 40: 'green', 41: 'green', 69: 'green', 70: 'blue', 71: 'blue', 85: 'blue', 86: 'blue', 95: 'base', 96: 'base', 100: 'base' });
    // the window itself: the same box on every rest frame, across both swaps
    const base = near(rgb(BASE));
    const boxes = range(16, 86, 8).concat([39, 40, 41, 69, 70, 71]).filter((f) => f >= 16 && f < 86 && pictures.has(f)).map((f) => ({ f, box: bbox(pictures.get(f)!, base) }));
    for (const { f, box } of boxes) {
      expect(Math.abs(box.x0 - w.rect.x), `x0 on ${f}`).toBeLessThanOrEqual(2);
      expect(Math.abs(box.y0 - w.rect.y), `y0 on ${f}`).toBeLessThanOrEqual(2);
      expect(Math.abs(box.x1 + 1 - (w.rect.x + w.rect.width)), `x1 on ${f}`).toBeLessThanOrEqual(2);
      expect(Math.abs(box.y1 + 1 - (w.rect.y + w.rect.height)), `y1 on ${f}`).toBeLessThanOrEqual(2);
    }
    expect(boxes.length).toBeGreaterThanOrEqual(8);
  });

  it('shows the video behind from its own first frame after each switch (what the table says: source frame f − picture.at)', () => {
    const w = made.timeline.windows[1]!;
    expect(w.pictures.map((p) => [p.behind, p.at, p.for])).toEqual([['b', 120, 40], ['c', 160, 60]]);
    const read: Record<number, number | null> = {};
    for (const f of [130, 131, 150, 159, 160, 161, 175, 190, 209]) read[f] = readBar(pictures.get(f)!.rgb, W, H);
    const expected: Record<number, number> = {};
    for (const f of Object.keys(read).map(Number)) { const p = w.pictures.findLast((q) => q.at <= f)!; expected[f] = f - p.at; }
    // RECORD: what the video behind shows after the swap is in `read`; the assertion below is the table's claim
    expect(read, `expected ${JSON.stringify(expected)}`).toEqual(expected);
  });

  it('has no window on the second shot before its window starts', () => {
    expect(share(pictures.get(111)!, near(rgb(BASE2)))).toBeGreaterThan(0.98);
    expect(share(pictures.get(225)!, near(rgb(BASE2)))).toBeGreaterThan(0.98);
  });
});

// ── 3: a whip and a push into a shot that has a window ────────────────────────────────────────────────────────────────

function movingEdit(media: Media): Edit {
  return {
    version: 1, language: 'en', canvas: { width: 720, height: 1280, fps: 30 }, frames: 210,
    media: mediaKeys(media, ['a', 'b', 'c', 'red', 'green']),
    shots: [
      { id: 's1', at: 0, for: 50, media: 'a' },
      { id: 's2', at: 50, for: 80, media: 'b', in: { kind: 'whip', to: 'left' }, windows: [{ at: 66, for: 40, corner: 'bottom-right', behind: 'red' }] },
      { id: 's3', at: 130, for: 80, media: 'c', in: { kind: 'push', to: 'left' }, windows: [{ at: 146, for: 40, corner: 'bottom-right', behind: 'green' }] },
    ],
  };
}

function transitionFrames(t: Timeline['transitions'][number]): number[] {
  return [...new Set([t.cut - 1, t.cut, ...Array.from({ length: t.for }, (_, i) => t.at + i)])].sort((x, y) => x - y);
}

describe.skipIf(!available)('windows 3: a whip and a push into a shot that has a window', () => {
  let made: Made;
  let media: Media;
  let pictures: Map<number, Picture>;
  beforeAll(async () => {
    media = await mediaWithPictures();
    made = build(movingEdit(media), media);
    const rests = made.timeline.windows.flatMap((w) => [w.at + w.frames, w.at + 20, w.at + w.for - w.frames - 1]);
    pictures = frames(made, [...made.timeline.transitions.flatMap(transitionFrames), ...rests, 60, 120, 170]);
  }, SLOW);

  it('passes lint and check', () => {
    expect(made.lint.errorCount).toBe(0);
    expect(made.check.ok, JSON.stringify(findings(made.check))).toBe(true);
  });

  it('shows the right source frame of both shots on every frame of the whip and of the push', () => {
    for (const t of made.timeline.transitions) {
      const a = made.timeline.shots.findIndex((s) => s.id === t.from);
      const b = made.timeline.shots.findIndex((s) => s.id === t.to);
      const wrong: string[] = [];
      const read: Record<string, number[]> = { [t.from]: [], [t.to]: [] };
      for (const f of transitionFrames(t)) {
        for (const index of [a, b]) {
          const reading = readShot(made.timeline, pictures.get(f)!, index, f);
          const ok = showsExpected(reading);
          if (ok === null) continue;
          read[made.timeline.shots[index]!.id]!.push(f);
          if (!ok) wrong.push(`frame ${f}: ${made.timeline.shots[index]!.id} should show source frame ${reading!.source}: ${JSON.stringify(reading)}`);
        }
      }
      expect(wrong, `${t.kind} at ${t.cut}`).toEqual([]);
      expect(read[t.from], `${t.from} before the ${t.kind}`).toContain(t.cut - 1);
      expect(read[t.to]!.length, `${t.to} inside the ${t.kind}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('rests the window after each transition where the table says, with rounded corners and the picture behind', () => {
    const shots = ['b', 'c'].map((key) => near([colourOf(media.sources[`assets/${key}.mp4`]!, 10, 640)[0], colourOf(media.sources[`assets/${key}.mp4`]!, 10, 640)[1], colourOf(media.sources[`assets/${key}.mp4`]!, 10, 640)[2]]));
    const behind = [near(rgb(RED)), near(rgb(GREEN))];
    made.timeline.windows.forEach((w, k) => {
      for (const f of [w.at + w.frames, w.at + 20, w.at + w.for - w.frames - 1]) {
        const picture = pictures.get(f)!;
        const box = bbox(picture, shots[k]!);
        expect(Math.abs(box.x0 - w.rect.x), `window ${k + 1} x0 on ${f}`).toBeLessThanOrEqual(2);
        expect(Math.abs(box.y0 - w.rect.y), `window ${k + 1} y0 on ${f}`).toBeLessThanOrEqual(2);
        expect(Math.abs(box.x1 + 1 - (w.rect.x + w.rect.width)), `window ${k + 1} x1 on ${f}`).toBeLessThanOrEqual(2);
        expect(Math.abs(box.y1 + 1 - (w.rect.y + w.rect.height)), `window ${k + 1} y1 on ${f}`).toBeLessThanOrEqual(2);
        expect(seen(picture, behind[k]!), `behind ${k + 1} on ${f}`).toBeGreaterThan(0.95);
        // rounded: a square of the radius at the bottom-right corner is a quarter disc (π/4 = 0.785 full), not a full square
        const r = Math.round(w.radius);
        const corner = count(picture, { x: w.rect.x + w.rect.width - r, y: w.rect.y + w.rect.height - r, width: r, height: r }, shots[k]!).n / (r * r);
        expect(corner, `corner of window ${k + 1} on ${f}: radius ${w.radius}`).toBeGreaterThan(0.68);
        expect(corner, `corner of window ${k + 1} on ${f}: radius ${w.radius}`).toBeLessThan(0.9);
      }
    });
  });

  it('has no window before it starts or after it ends, and shows the picture behind while it rests', () => {
    expect(share(pictures.get(60)!, near(rgb(RED)))).toBe(0);
    expect(share(pictures.get(120)!, near(rgb(RED)))).toBe(0);
    expect(share(pictures.get(170)!, near(rgb(GREEN))), 'green behind on 170, inside window 2 (146 … 185)').toBeGreaterThan(0.5);
  });
});
