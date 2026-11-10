// A caption group whose active word is drawn in the mark's colour shows too little of the fill to be read by the fill. The footage rule still sees what lies over
// the footage; the contrast of that (the colour most of it has, against what is around it) is then judged. Fast: no ffmpeg, pictures made by hand.
import { describe, expect, it } from 'vitest';
import type { Timeline } from '../edit/timeline.ts';
import type { Measure, Picture, StreamFacts } from '../ports.ts';
import { checkOutput } from './output.ts';
import { makeTimeline } from './samples.ts';

const W = 270;
const H = 480;
const RECT = { x: 20, y: 200, width: 230, height: 40 };
type Rgb = [number, number, number];

function flat(c: Rgb): Picture {
  const rgb = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) rgb.set(c, i * 3);
  return { width: W, height: H, rgb };
}
function paint(base: Picture, boxes: { x: number; y: number; width: number; height: number; colour: Rgb }[]): Picture {
  const rgb = base.rgb.slice();
  for (const b of boxes) for (let y = b.y; y < b.y + b.height; y++) for (let x = b.x; x < b.x + b.width; x++) rgb.set(b.colour, (y * W + x) * 3);
  return { width: W, height: H, rgb };
}
/** Three "letters" of one word, 24 x 28 pixels, inside RECT. `edge`: a frame of that colour, 2 pixels wide, around each. */
function word(colour: Rgb, edge?: Rgb) {
  return Array.from({ length: 3 }, (_, i) => {
    const x = RECT.x + 20 + i * 60;
    const y = RECT.y + 6;
    return [...(edge ? [{ x: x - 2, y: y - 2, width: 28, height: 32, colour: edge }] : []), { x, y, width: 24, height: 28, colour }];
  }).flat();
}

function measureOf(render: Picture, footage: Picture): Measure {
  const facts: StreamFacts = {
    width: W, height: H, fps: 30, frames: 90, seconds: 3, audio: false, codec: 'h264', pixelFormat: 'yuv420p',
    colour: { space: 'bt709', transfer: 'bt709', primaries: 'bt709' }, keyframes: [0], sound: null, constantRate: true,
  };
  return {
    streams: async () => facts,
    black: async () => [],
    frozen: async () => [],
    loudness: async () => null,
    momentary: async () => [],
    picture: async (file, frame) => (file === 'render.mp4' && frame >= 20 && frame < 80 ? render : footage),      // the caption group is on screen on frames 20 … 79
  };
}
/** One group of one word ("MAKEUP."), active on frames 30 … 69: the word is drawn in the mark, so none of the fill (white) shows. */
const timeline: Timeline = makeTimeline({
  captions: [{ group: 0, element: 'cap-0', at: 20, for: 60, rect: RECT, size: 28, colour: '#ffffff', lines: ['MAKEUP.'], words: [{ index: 0, text: 'MAKEUP.', at: 30, for: 40 }], rest: { at: 30, for: 40 } }],
  animations: [{ element: 'cap-0-w0', property: 'active', at: 30, for: 40, from: 0, to: 1, ease: 'step', hold: 'none' }],
});
const sources = { clip: 'clip.mp4' };
const codes = async (render: Picture, footage: Picture) => (await checkOutput('render.mp4', timeline, measureOf(render, footage), sources)).map((i) => `${i.code}:${i.severity}`);

describe('a marked caption group with too little fill', () => {
  const dark = flat([60, 60, 60]);
  it('a bright mark colour over dark footage is readable: no issue', async () => {
    expect(await codes(paint(dark, word([255, 224, 0])), dark)).toEqual([]);
  });
  it('a word in the footage colour with a thin edge of a close colour cannot be read: low-contrast', async () => {
    // letters 70 over footage 60 (inside the match distance, so not drawn), an edge of 90 around them (drawn, contrast 1.4 : 1 against the footage)
    expect(await codes(paint(dark, word([70, 70, 70], [90, 90, 90])), dark)).toEqual(['low-contrast:warning']);
  });
  it('a word in the footage colour with a dark edge far from it is readable: no issue', async () => {
    const mid = flat([128, 128, 128]);
    expect(await codes(paint(mid, word([130, 130, 130], [10, 10, 10])), mid)).toEqual([]);
  });
  it('nothing over the footage is still text-missing', async () => {
    expect(await codes(dark, dark)).toEqual(['text-missing:error']);
  });
});
