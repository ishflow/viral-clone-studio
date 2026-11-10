// Real HyperFrames (`VE_RENDER=1 pnpm vitest run src/compose/texts.render.test.ts`): texts and captions, read frame by frame.
// Fix round 1, agent B: a two-line text with a plate (and what `hyperframes check` says about it), pill captions, the slide
// and blur exits of a text. Text fills are chosen so that no clip colour and no frame bar can be mistaken for them.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Edit, TextStyle } from '../edit/types.ts';
import { available, count } from './golden-helpers.ts';
import type { Picture } from './golden-helpers.ts';
import { valueAt } from './testing.ts';
import { SLOW, build, emptyMedia, findings, flatImage, frames, hexOf, near } from './render-cases.ts';
import type { Made, Media } from './render-cases.ts';

const W = 720;
const BG = '26668a';                       // a flat teal: not near the plate, the pill or the yellow, and no frame bar crossing the text
const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
const whole = { x: 0, y: 0, width: W, height: 1280 };


// ── 4: a two-line text with a plate ───────────────────────────────────────────────────────────────────────────────────

const PLATE = '#d000d0';
const YELLOW = '#ffe000';
const plated: TextStyle = { font: 'Inter', weight: 800, size: 64, align: 'center', fill: YELLOW, shadows: [], plate: { colour: PLATE, radius: 0.3, padX: 0.4, padY: 0.15 } };

describe.skipIf(!available)('texts 4: a two-line text with a plate', () => {
  let made: Made;
  let pictures: Map<number, Picture>;
  beforeAll(async () => {
    const media = emptyMedia();
    flatImage(media, 'bg', BG);
    const edit: Edit = {
      version: 1, language: 'en', canvas: { width: 720, height: 1280, fps: 30 }, frames: 90,
      media: { bg: { file: 'assets/bg.png', kind: 'image' } }, styles: { plated },
      shots: [{ id: 's1', at: 0, for: 90, media: 'bg' }],
      texts: [{ id: 'plate', at: 6, for: 60, box: { left: 10, top: 20, right: 80, bottom: 40 }, style: 'plated', copy: 'Plate one\nsecond line is longer', lines: 2, enter: { kind: 'none' }, exit: { kind: 'none' } }],
    };
    made = build(edit, media);
    pictures = frames(made, [5, 6, 30, 65, 66]);
  }, SLOW);

  it('composes two lines, each with a rect, and shows each line on a plate of its own, hugging its text', () => {
    const lines = made.timeline.texts;
    expect(lines.map((l) => l.line)).toEqual([1, 2]);
    const plate = near(hexOf(PLATE), 40);
    const yellow = near(hexOf(YELLOW), 40);
    const pad = 0.4 * 64;
    const box = (picture: Picture, rect: { x: number; y: number; width: number; height: number }, test: (r: number, g: number, b: number) => boolean) => {
      let x0 = Infinity; let x1 = -1; let y0 = Infinity; let y1 = -1; let n = 0;
      for (let y = Math.max(0, rect.y); y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) {
        const i = (y * W + x) * 3;
        if (test(picture.rgb[i]!, picture.rgb[i + 1]!, picture.rgb[i + 2]!)) { n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      }
      return { x0, x1: x1 + 1, y0, y1: y1 + 1, n };
    };
    const seen: Record<number, { plate: ReturnType<typeof box>; ink: ReturnType<typeof box> }> = {};
    for (const f of [6, 30, 65]) {
      const picture = pictures.get(f)!;
      for (const line of lines) {
        const r = line.rect;
        const around = { x: r.x - 30, y: r.y, width: r.width + 60, height: r.height };    // rect = the line box: as wide as the text box, as high as one line
        const middle = { x: around.x, y: r.y + Math.floor(r.height * 0.3), width: around.width, height: Math.floor(r.height * 0.4) };   // the plates of two lines overlap in height: read the rows only this line's plate covers
        const p = { ...box(picture, middle, plate), y0: box(picture, { ...around, y: r.y - 14, height: r.height + 28 }, plate).y0, y1: box(picture, { ...around, y: r.y - 14, height: r.height + 28 }, plate).y1 };
        const i = box(picture, around, yellow);
        expect(i.n, `ink of line ${line.line} on frame ${f}`).toBeGreaterThan(300);
        expect(p.n, `plate of line ${line.line} on frame ${f}`).toBeGreaterThan(0.2 * (i.x1 - i.x0) * 0.4 * (i.y1 - i.y0));
        // the plate runs past the ink by padX on each side (em of the final size) and covers its height
        expect(i.x0 - p.x0, `padX left of line ${line.line} (frame ${f})`).toBeGreaterThanOrEqual(pad - 12);
        expect(i.x0 - p.x0, `padX left of line ${line.line} (frame ${f})`).toBeLessThanOrEqual(pad + 14);
        expect(p.x1 - i.x1, `padX right of line ${line.line} (frame ${f})`).toBeGreaterThanOrEqual(pad - 12);
        expect(p.x1 - i.x1, `padX right of line ${line.line} (frame ${f})`).toBeLessThanOrEqual(pad + 14);
        seen[line.line] = { plate: p, ink: i };
      }
      // no plate pixel outside the two line boxes (the page-wide count equals the sum of the two)
      const all = count(picture, whole, plate).n;
      const top = Math.min(...lines.map((l) => l.rect.y)) - 14;
      const bottom = Math.max(...lines.map((l) => l.rect.y + l.rect.height)) + 14;
      const inBoxes = count(picture, { x: 0, y: top, width: W, height: bottom - top }, plate).n;
      expect(all, `plate pixels outside the line boxes on frame ${f}`).toBe(inBoxes);
    }
    // each line has its own plate: the shorter line has the narrower one
    const [one, two] = [seen[1]!, seen[2]!];
    expect(two.plate.x1 - two.plate.x0, 'plate of line 2 is wider than that of line 1').toBeGreaterThan(one.plate.x1 - one.plate.x0 + 40);
    expect(count(pictures.get(5)!, whole, plate).n, 'plate before the text').toBe(0);
    expect(count(pictures.get(66)!, whole, plate).n, 'plate after the text').toBe(0);
  });

  it('passes lint, and `hyperframes check` at the rest frames does not call the text occluded', () => {
    expect(made.lint.errorCount).toBe(0);
    const all = findings(made.check);
    expect(all.filter((f) => f.includes('text_occluded')), `findings: ${all.join(' | ')}`).toEqual([]);
    expect(made.check.ok, all.join(' | ')).toBe(true);
  });
});

// ── 5: pill captions ──────────────────────────────────────────────────────────────────────────────────────────────────

const PILL = '#7c3aed';
/** The frames of a word on which its group is at rest (the group pops in over its first frames): first, middle, last. */
const pillFrames = (g: { rest: { at: number; for: number } }, w: { at: number; for: number }) => {
  const first = Math.max(w.at, g.rest.at);
  const last = w.at + w.for - 1;
  return [first, first + Math.floor((last - first) / 2), last];
};
const WORDS: [string, number, number][] = [['never', 6, 12], ['looked', 18, 14], ['so', 32, 8], ['good', 50, 14], ['it', 64, 8], ['works', 72, 14]];

describe.skipIf(!available)('texts 5: pill captions', () => {
  let made: Made;
  let pictures: Map<number, Picture>;
  let background: [number, number, number];
  beforeAll(async () => {
    const media = emptyMedia();
    flatImage(media, 'bg', BG);
    background = hexOf(`#${BG}`);
    const edit: Edit = {
      version: 1, language: 'en', canvas: { width: 720, height: 1280, fps: 30 }, frames: 100,
      media: { bg: { file: 'assets/bg.png', kind: 'image' } },
      shots: [{ id: 's1', at: 0, for: 100, media: 'bg' }],
      captions: {
        box: { left: 9, top: 40, right: 86, bottom: 52 },
        words: WORDS.map(([text, at, length]) => ({ text, at, for: length })),
        group: { words: 3, lines: 2, hold: 6, pause: 8 }, active: { kind: 'pill', colour: PILL, text: '#ffffff' },
      },
    };
    made = build(edit, media);
    pictures = frames(made, [5, ...made.timeline.captions.flatMap((g) => g.words.flatMap((w) => [w.at - 1, w.at, ...pillFrames(g, w)]))]);
  }, SLOW);

  it('passes lint and check', () => {
    expect(made.lint.errorCount).toBe(0);
    expect(made.check.ok, findings(made.check).join(' | ')).toBe(true);
  });

  it('puts the pill behind the active word on each word\'s frames, and moves it on the frame the word changes', () => {
    const pill = near(hexOf(PILL), 30);
    expect(near(hexOf(PILL), 30)(...background), 'the clip colour must not look like the pill').toBe(false);
    const white = (r: number, g: number, b: number) => Math.min(r, g, b) > 215;
    expect(count(pictures.get(5)!, whole, pill).n, 'pill before the first group').toBe(0);
    for (const group of made.timeline.captions) {
      const rows = group.lines.map((line) => line.split(' ').length);
      const line = (k: number) => { let n = k; for (const [i, size] of rows.entries()) { if (n < size) return i; n -= size; } return rows.length; };
      const where = group.words.map((word) => {
        const frames = pillFrames(group, word);
        const reads = frames.map((f) => ({ f, ...count(pictures.get(f)!, group.rect, pill) }));
        for (const read of reads) expect(read.n, `pill of "${word.text}" on frame ${read.f}`).toBeGreaterThan(400);
        // the pill stands still for the whole word
        const [first, ...rest] = reads;
        for (const read of rest) {
          expect(Math.abs(read.cx - first!.cx), `pill of "${word.text}" moved sideways on frame ${read.f}`).toBeLessThan(3);
          expect(Math.abs(read.cy - first!.cy), `pill of "${word.text}" moved vertically on frame ${read.f}`).toBeLessThan(3);
        }
        // and the word is in front of it: white letters inside the pill's own box
        let x0 = Infinity; let x1 = -1; let y0 = Infinity; let y1 = -1;
        const picture = pictures.get(frames[1]!)!;
        for (let y = group.rect.y; y < group.rect.y + group.rect.height; y++) for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 3;
          if (pill(picture.rgb[i]!, picture.rgb[i + 1]!, picture.rgb[i + 2]!)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        }
        expect(count(picture, { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }, white).n, `white letters on the pill of "${word.text}"`).toBeGreaterThan(150);
        return { word, ...first! };
      });
      // the pill goes where the word is: next word on the same line → to the right; next line → below
      for (let k = 1; k < where.length; k++) {
        const [a, b] = [where[k - 1]!, where[k]!];
        if (line(k) === line(k - 1)) {
          expect(b.cx - a.cx, `"${b.word.text}" is right of "${a.word.text}"`).toBeGreaterThan(group.size);
          expect(Math.abs(b.cy - a.cy), `"${b.word.text}" is on the line of "${a.word.text}"`).toBeLessThan(6);
        } else {
          expect(b.cy - a.cy, `"${b.word.text}" is a line below "${a.word.text}"`).toBeGreaterThan(group.size * 0.8);
        }
        // the frame before the word's first frame still has the previous word's pill
        const before = count(pictures.get(b.word.at - 1)!, group.rect, pill);        // (a group at rest: the second word's group has popped in)
        expect(Math.abs(before.cx - a.cx) + Math.abs(before.cy - a.cy), `frame ${b.word.at - 1} still shows the pill of "${a.word.text}"`).toBeLessThan(6);
      }
    }
  });
});

// ── 7a: the slide and blur exits of a text ────────────────────────────────────────────────────────────────────────────

/** Ink mass and centroid of a rectangle: every pixel counts as much as it is yellow (min(r, g) − b, over the clip's own), so a fading text counts less. */
function ink(picture: Picture, rect: { x: number; y: number; width: number; height: number }, bg: number): { mass: number; cx: number; cy: number } {
  let mass = 0; let sx = 0; let sy = 0;
  for (let y = Math.max(0, rect.y); y < Math.min(picture.height, rect.y + rect.height); y++) {
    for (let x = Math.max(0, rect.x); x < Math.min(picture.width, rect.x + rect.width); x++) {
      const i = (y * picture.width + x) * 3;
      const w = Math.max(0, Math.min(picture.rgb[i]!, picture.rgb[i + 1]!) - picture.rgb[i + 2]! - bg) / 224;
      mass += w; sx += w * x; sy += w * y;
    }
  }
  return { mass, cx: mass > 0 ? sx / mass : 0, cy: mass > 0 ? sy / mass : 0 };
}

const plain: TextStyle = { font: 'Inter', weight: 800, size: 72, align: 'center', fill: YELLOW, shadows: [] };

describe.skipIf(!available)('texts 7a: slide and blur exits', () => {
  let made: Made;
  let pictures: Map<number, Picture>;
  let bg: number;
  const AT = 6;
  const FOR = 50;
  const EXIT = 10;
  beforeAll(async () => {
    const media = emptyMedia();
    flatImage(media, 'bg', BG);
    const [r, g, b] = hexOf(`#${BG}`);
    bg = Math.max(0, Math.min(r, g) - b);
    const edit: Edit = {
      version: 1, language: 'en', canvas: { width: 720, height: 1280, fps: 30 }, frames: 80,
      media: { bg: { file: 'assets/bg.png', kind: 'image' } }, styles: { plain },
      shots: [{ id: 's1', at: 0, for: 80, media: 'bg' }],
      texts: [
        { id: 'down', at: AT, for: FOR, box: { left: 10, top: 14, right: 80, bottom: 22 }, style: 'plain', copy: 'slides down', enter: { kind: 'none' }, exit: { kind: 'slide', to: 'bottom', frames: EXIT, distance: 5 } },
        { id: 'left', at: AT, for: FOR, box: { left: 10, top: 30, right: 80, bottom: 38 }, style: 'plain', copy: 'slides left', enter: { kind: 'none' }, exit: { kind: 'slide', to: 'left', frames: EXIT, distance: 6 } },
        { id: 'blur', at: AT, for: FOR, box: { left: 10, top: 46, right: 80, bottom: 54 }, style: 'plain', copy: 'blurs away', enter: { kind: 'none' }, exit: { kind: 'blur', frames: EXIT } },
      ],
    };
    made = build(edit, media);
    pictures = frames(made, [AT - 1, AT, 30, ...range(AT + FOR - EXIT - 2, AT + FOR + 1)]);
  }, SLOW);

  it('passes lint and check', () => {
    expect(made.lint.errorCount).toBe(0);
    expect(made.check.ok, findings(made.check).join(' | ')).toBe(true);
  });

  const exitFrames = range(AT + FOR - EXIT, AT + FOR);
  const line = (id: string) => made.timeline.texts.find((t) => t.id === id)!;
  /** Its own band: from just above its rect to well below (a slide down is 5 % of the height = 64 px), clear of the next text. */
  const band = (id: string) => { const r = line(id).rect; return { x: 0, y: r.y - 15, width: W, height: r.height + 100 }; };
  const read = (id: string, f: number) => ink(pictures.get(f)!, band(id), bg);

  /** Measured shift of the ink from its rest place, against what timeline.animations says the line's x / y is on that frame. */
  const follows = (id: string, axis: 'x' | 'y') => {
    const el = line(id).element;
    const rest = read(id, 30);
    const reads = exitFrames.map((f) => ({ f, ...read(id, f) })).filter((r) => r.mass > rest.mass * 0.15);
    expect(reads.length, `frames of the exit on which the ink can be read: ${reads.map((r) => r.f)}`).toBeGreaterThanOrEqual(3);
    const trace = reads.map((r) => `${r.f}: measured ${((axis === 'x' ? r.cx - rest.cx : r.cy - rest.cy)).toFixed(1)} expected ${valueAt(made.timeline, el, axis, r.f, 0).toFixed(1)}`).join(' | ');
    for (const r of reads) {
      const measured = axis === 'x' ? r.cx - rest.cx : r.cy - rest.cy;
      const expected = valueAt(made.timeline, el, axis, r.f, 0);
      expect(Math.abs(measured - expected), `frame ${r.f}: ${trace}`).toBeLessThan(4);
    }
    return { rest, reads, trace };
  };

  it('slides down: whole until the exit starts, then the ink follows the table downwards while it fades, nothing on the frame after', () => {
    const rest = read('down', 30);
    expect(rest.mass, 'rest').toBeGreaterThan(300);
    expect(read('down', AT - 1).mass, 'before').toBeLessThan(rest.mass * 0.01);
    expect(read('down', AT + FOR - EXIT - 1).mass, 'last rest frame').toBeGreaterThan(rest.mass * 0.95);
    const { reads, trace } = follows('down', 'y');
    for (let i = 1; i < reads.length; i++) expect(reads[i]!.mass, `mass falls on frame ${reads[i]!.f}: ${trace}`).toBeLessThanOrEqual(reads[i - 1]!.mass + 5);
    expect(Math.abs(reads.at(-1)!.cx - rest.cx), 'did not move sideways').toBeLessThan(3);
    expect(read('down', AT + FOR).mass, `frame ${AT + FOR}`).toBeLessThan(rest.mass * 0.01);
  });

  it('slides left: the ink follows the table to the left while it fades, nothing on the frame after', () => {
    const rest = read('left', 30);
    expect(rest.mass, 'rest').toBeGreaterThan(300);
    const { reads } = follows('left', 'x');
    expect(Math.abs(reads.at(-1)!.cy - rest.cy), 'did not move vertically').toBeLessThan(3);
    expect(read('left', AT + FOR).mass, `frame ${AT + FOR}`).toBeLessThan(rest.mass * 0.01);
  });

  it('blurs away: the ink falls frame by frame, spreads, and nothing is left on the frame after', () => {
    const rest = read('blur', 30);
    expect(rest.mass, 'rest').toBeGreaterThan(300);
    const reads = exitFrames.map((f) => ({ f, ...read('blur', f) }));
    const trace = reads.map((r) => `${r.f}:${r.mass.toFixed(0)}`).join(' ');
    for (let i = 1; i < reads.length; i++) expect(reads[i]!.mass, `mass falls on frame ${reads[i]!.f}: ${trace}`).toBeLessThanOrEqual(reads[i - 1]!.mass + 5);
    expect(reads.at(-1)!.mass, `last exit frame ${reads.at(-1)!.f}: ${trace}`).toBeLessThan(rest.mass * 0.5);
    expect(read('blur', AT + FOR).mass, `frame ${AT + FOR}`).toBeLessThan(5);
  });
});
