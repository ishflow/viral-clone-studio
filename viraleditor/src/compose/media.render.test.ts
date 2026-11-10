// Real HyperFrames (`VE_RENDER=1 pnpm vitest run src/compose/media.render.test.ts`): focus on a cropped shot, a card with
// motion, looped music. Fix round 1, agent B. The sources are made here with ffmpeg so that a frame says what it shows by colour.
import { spawnSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Edit } from '../edit/types.ts';
import { available, count, probe } from './golden-helpers.ts';
import type { Picture } from './golden-helpers.ts';
import { FFMPEG, SLOW, build, drawnClip, drawnImage, emptyMedia, findings, flatImage, frames, hexOf, near, toneFile } from './render-cases.ts';
import type { Made } from './render-cases.ts';
import { valueAt } from './testing.ts';

const W = 720;
const H = 1280;
const BG = '26668a';

// ── 7b: `focus` on a cropped shot ─────────────────────────────────────────────────────────────────────────────────────

describe.skipIf(!available)('media 7b: focus on a cropped shot', () => {
  let made: Made;
  let pictures: Map<number, Picture>;
  beforeAll(async () => {
    const media = emptyMedia();
    // a 1280×720 clip: the left half red, the right half blue. On a 720×1280 canvas it is cropped to 31.6 % of its width.
    drawnClip(media, 'wide', '1280x720', 'drawbox=x=0:y=0:w=640:h=720:color=0xdc1e1e:t=fill,drawbox=x=640:y=0:w=640:h=720:color=0x1e3cdc:t=fill', 90);
    const edit: Edit = {
      version: 1, language: 'en', canvas: { width: 720, height: 1280, fps: 30 }, frames: 90,
      media: { wide: { file: 'assets/wide.mp4', kind: 'video' } },
      shots: [
        { id: 's1', at: 0, for: 30, media: 'wide', focus: [40, 50] },
        { id: 's2', at: 30, for: 30, media: 'wide', focus: [100, 50] },
        { id: 's3', at: 60, for: 30, media: 'wide', focus: [40, 50], motion: { kind: 'push-in', to: 1.3 } },
      ],
    };
    made = build(edit, media);
    pictures = frames(made, [0, 15, 29, 30, 45, 59, 60, 65, 75, 85, 89]);
  }, SLOW);

  it('passes lint and check', () => {
    expect(made.lint.errorCount).toBe(0);
    expect(made.check.ok, findings(made.check).join(' | ')).toBe(true);
  });

  /** Where red turns to blue along a few rows (the number of red pixels, as a mean), and how much of the frame is neither. */
  const boundary = (f: number) => {
    const picture = pictures.get(f)!;
    const red = near(hexOf('#dc1e1e'), 40);
    const blue = near(hexOf('#1e3cdc'), 40);
    const rows = [200, 500, 800, 1100].map((y) => count(picture, { x: 0, y, width: W, height: 1 }, red).n);
    const other = 1 - (count(picture, { x: 0, y: 0, width: W, height: H }, red).n + count(picture, { x: 0, y: 0, width: W, height: H }, blue).n) / (W * H);
    return { x: rows.reduce((a, b) => a + b, 0) / rows.length, spread: Math.max(...rows) - Math.min(...rows), other };
  };
  const crossing = (focus: number) => 640 * (H / 720) + (W - 1280 * (H / 720)) * (focus / 100);    // where the red/blue boundary lands (px)

  it('keeps the focus point: focus [40, 50] puts the boundary where object-position says, on every frame', () => {
    for (const f of [0, 15, 29]) {
      const b = boundary(f);
      expect(b.x, `boundary on frame ${f}: ${JSON.stringify(b)}`).toBeGreaterThan(crossing(40) - 4);
      expect(b.x, `boundary on frame ${f}: ${JSON.stringify(b)}`).toBeLessThan(crossing(40) + 4);
      expect(b.spread, `row spread on frame ${f}`).toBeLessThanOrEqual(2);
    }
  });

  it('focus [100, 50] shows only the right edge of the clip (all blue); the cut is on frame 30', () => {
    expect(boundary(29).x, 'frame 29 is still shot 1').toBeGreaterThan(300);
    for (const f of [30, 45, 59]) {
      const b = boundary(f);
      expect(b.x, `red on frame ${f}: ${JSON.stringify(b)}`).toBeLessThan(2);
      expect(b.other, `frame ${f} is blue only`).toBeLessThan(0.01);
    }
  });

  it('zooms a push-in around the focus point, not around the centre', () => {
    const shot = made.timeline.shots[2]!;
    const origin = 0.4 * W;
    for (const f of [60, 65, 75, 85, 89]) {
      const s = valueAt(made.timeline, shot.element, 'scale', f, 1) * valueAt(made.timeline, shot.id, 'scale', f, 1);
      const expected = origin + s * (crossing(40) - origin);
      const b = boundary(f);
      expect(Math.abs(b.x - expected), `frame ${f}: boundary ${b.x.toFixed(1)}, scale ${s.toFixed(3)} puts it at ${expected.toFixed(1)}`).toBeLessThan(4);
    }
    expect(valueAt(made.timeline, shot.element, 'scale', 89, 1), 'the push-in really zooms').toBeGreaterThan(1.2);
    // a push-in around the centre would put the boundary at 360 + s × (515.6 − 360): 14 px away at the end
  });
});

// ── 7c: a card with motion ────────────────────────────────────────────────────────────────────────────────────────────

describe.skipIf(!available)('media 7c: a card with motion', () => {
  let made: Made;
  let pictures: Map<number, Picture>;
  beforeAll(async () => {
    const media = emptyMedia();
    flatImage(media, 'bg', BG);
    // black, a white square 120×100 in the middle: a 'cover' card of 432×384 shows it at 72×60 and a push-in grows it
    drawnImage(media, 'pattern', '720x1280', 'drawbox=x=300:y=590:w=120:h=100:color=white:t=fill');
    const edit: Edit = {
      version: 1, language: 'en', canvas: { width: 720, height: 1280, fps: 30 }, frames: 90,
      media: { bg: { file: 'assets/bg.png', kind: 'image' }, pattern: { file: 'assets/pattern.png', kind: 'image' } },
      shots: [{ id: 's1', at: 0, for: 90, media: 'bg' }],
      cards: [{ id: 'proof', at: 10, for: 60, media: 'pattern', box: { left: 20, top: 30, right: 80, bottom: 60 }, fit: 'cover', motion: { kind: 'push-in', to: 1.5 } }],
    };
    made = build(edit, media);
    const card = made.timeline.cards[0]!;
    pictures = frames(made, [card.at - 1, card.rest.at, card.rest.at + 10, card.rest.at + 25, card.rest.at + card.rest.for - 1, card.at + card.for]);
  }, SLOW);

  it('passes lint and check', () => {
    expect(made.lint.errorCount).toBe(0);
    expect(made.check.ok, findings(made.check).join(' | ')).toBe(true);
  });

  it('grows the white square as the table says, and never draws outside its box', () => {
    const card = made.timeline.cards[0]!;
    const { rect } = card;
    const black = (r: number, g: number, b: number) => Math.max(r, g, b) < 40;
    const white = (r: number, g: number, b: number) => Math.min(r, g, b) > 200;
    const centre = rect.y + Math.floor(rect.height / 2);
    expect(count(pictures.get(card.at - 1)!, { x: 0, y: 0, width: W, height: H }, black).n, 'black before the card').toBe(0);
    expect(count(pictures.get(card.at + card.for)!, { x: 0, y: 0, width: W, height: H }, black).n, 'black after the card').toBe(0);
    const widths: number[] = [];
    for (const f of [card.rest.at, card.rest.at + 10, card.rest.at + 25, card.rest.at + card.rest.for - 1]) {
      const picture = pictures.get(f)!;
      const s = valueAt(made.timeline, card.element, 'scale', f, 1) * valueAt(made.timeline, `${card.id}-box`, 'scale', f, 1);
      const run = count(picture, { x: rect.x, y: centre, width: rect.width, height: 1 }, white).n;
      widths.push(run);
      expect(Math.abs(run - 72 * s), `white square on frame ${f}: ${run} px wide, scale ${s.toFixed(3)} says ${(72 * s).toFixed(1)}`).toBeLessThan(4);
      // nothing of the picture outside the box: a ring of 4 … 24 px around it has no black
      const ring = [
        { x: rect.x - 24, y: rect.y - 24, width: rect.width + 48, height: 20 }, { x: rect.x - 24, y: rect.y + rect.height + 4, width: rect.width + 48, height: 20 },
        { x: rect.x - 24, y: rect.y, width: 20, height: rect.height }, { x: rect.x + rect.width + 4, y: rect.y, width: 20, height: rect.height },
      ];
      expect(ring.reduce((n, r) => n + count(picture, r, black).n, 0), `black outside the box on frame ${f}`).toBe(0);
      expect(count(picture, rect, black).n / (rect.width * rect.height), `the box is filled on frame ${f}`).toBeGreaterThan(0.85);
    }
    expect(widths.at(-1)! - widths[0]!, `the square grows over the rest: ${widths}`).toBeGreaterThan(8);
  });
});

// ── 7d: looped music, no gap at the pass boundary ─────────────────────────────────────────────────────────────────────

/** The RMS of 10 ms windows of the sound of a file, one every 5 ms (mono, 48 kHz). */
function levels(file: string): { t: number; rms: number }[] {
  const run = spawnSync(FFMPEG, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], { maxBuffer: 1 << 28 });
  if (run.status !== 0) throw new Error(run.stderr.toString());
  const samples = new Int16Array(run.stdout.buffer, run.stdout.byteOffset, Math.floor(run.stdout.length / 2));
  const window = 480;
  const out: { t: number; rms: number }[] = [];
  for (let i = 0; i + window <= samples.length; i += 240) {
    let sum = 0;
    for (let k = i; k < i + window; k++) sum += samples[k]! * samples[k]!;
    out.push({ t: (i + window / 2) / 48000, rms: Math.sqrt(sum / window) });
  }
  return out;
}

describe.skipIf(!available)('media 7d: looped music', () => {
  let made: Made;
  beforeAll(async () => {
    const media = emptyMedia();
    flatImage(media, 'bg', BG);
    toneFile(media, 'tone', 1.5);               // 45 frames: a 4 s video makes three passes
    const edit: Edit = {
      version: 1, language: 'en', canvas: { width: 720, height: 1280, fps: 30 }, frames: 120,
      media: { bg: { file: 'assets/bg.png', kind: 'image' }, tone: { file: 'assets/tone.mp3', kind: 'audio' } },
      shots: [{ id: 's1', at: 0, for: 120, media: 'bg' }],
      audio: { music: { media: 'tone', gain: 1, loop: true, fadeOut: 12 }, master: false },
    };
    made = build(edit, media);
  }, SLOW);

  it('passes lint and check, and renders a sound stream of the length of the video', () => {
    expect(made.lint.errorCount).toBe(0);
    expect(made.check.ok, findings(made.check).join(' | ')).toBe(true);
    const p = probe(made.output);
    expect(p.audio).toBe(true);
    expect(p.frames).toBe(120);
  });

  it('has no gap, no dip and no doubling around the pass boundaries', () => {
    const passes = made.timeline.audio.filter((a) => a.media === 'tone');
    expect(passes.length, 'passes').toBeGreaterThanOrEqual(3);
    expect(passes.map((a) => a.at)[0]).toBe(0);
    const all = levels(made.output);
    const steady = all.filter((l) => l.t > 0.1 && l.t < 3.5);                       // after the start-up of the encoder, before the fade-out (frames 108 … 119)
    const sorted = steady.map((l) => l.rms).sort((a, b) => a - b);
    const reference = sorted[Math.floor(sorted.length / 2)]!;
    expect(reference, 'the tone is audible').toBeGreaterThan(500);
    const boundaries = passes.slice(1).map((a) => a.at / 30);
    for (const boundary of boundaries) {
      const near = all.filter((l) => Math.abs(l.t - boundary) <= 0.08);
      const low = near.reduce((m, l) => (l.rms < m.rms ? l : m));
      const high = near.reduce((m, l) => (l.rms > m.rms ? l : m));
      expect(low.rms / reference, `lowest 10 ms level near ${boundary}s is at ${low.t.toFixed(3)}s (reference ${reference.toFixed(0)})`).toBeGreaterThan(0.7);
      expect(high.rms / reference, `highest 10 ms level near ${boundary}s is at ${high.t.toFixed(3)}s (reference ${reference.toFixed(0)})`).toBeLessThan(1.3);
    }
    // and nowhere in the steady part
    expect(Math.min(...steady.map((l) => l.rms)) / reference, 'the quietest 10 ms of the steady part').toBeGreaterThan(0.7);
    // the fade-out: the last window is quieter than the steady part
    expect(all.at(-1)!.rms / reference, 'the end is faded out').toBeLessThan(0.3);
  });
});
