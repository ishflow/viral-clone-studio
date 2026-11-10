import { describe, expect, it } from 'vitest';
import { contrast, parseColour, readInk, readOver } from './pixels.ts';

function flat(width: number, height: number, c: [number, number, number]) {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) rgb.set(c, i * 3);
  return { width, height, rgb };
}

describe('contrast', () => {
  it('matches the WCAG values: black on white 21, white on white 1, #777 on white about 4.48', () => {
    expect(contrast({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 5);
    expect(contrast({ r: 255, g: 255, b: 255 }, { r: 255, g: 255, b: 255 })).toBe(1);
    expect(contrast(parseColour('#777'), parseColour('#ffffff'))).toBeCloseTo(4.48, 1);
  });
});

describe('readInk', () => {
  it('finds the ink, a ring of at most 3 pixels around it, and the contrast against the ring', () => {
    const pic = flat(40, 20, [0, 0, 0]);
    for (let y = 8; y < 12; y++) for (let x = 15; x < 25; x++) pic.rgb.set([255, 255, 255], (y * 40 + x) * 3);   // a 10x4 white bar
    const r = readInk(pic, { x: 0, y: 0, width: 40, height: 20 }, { r: 255, g: 255, b: 255 });
    expect(r.ink).toBe(40);
    expect(r.ring).toBe(16 * 10 - 40);                    // the solid core of the bar (the bar less one pixel) grown by 4: 16 x 10, minus the bar
    expect(r.contrast).toBeCloseTo(21, 5);
  });
  it('clips the rect to the picture and reads an empty rect as nothing', () => {
    const pic = flat(10, 10, [0, 0, 0]);
    expect(readInk(pic, { x: 8, y: 8, width: 50, height: 50 }, { r: 255, g: 255, b: 255 })).toMatchObject({ area: 4, ink: 0 });
    expect(readInk(pic, { x: 20, y: 20, width: 5, height: 5 }, { r: 255, g: 255, b: 255 })).toMatchObject({ area: 0, ink: 0, contrast: null });
  });
});

describe('readOver', () => {
  const WHITE = { r: 255, g: 255, b: 255 };
  const all = { x: 0, y: 0, width: 40, height: 20 };
  const bar = (pic: ReturnType<typeof flat>, x0: number, x1: number, y0: number, y1: number, c: [number, number, number]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) pic.rgb.set(c, (y * pic.width + x) * 3);
    return pic;
  };
  it('counts what the render shows that the footage does not, and how much of it is in the fill colour', () => {
    const footage = flat(40, 20, [40, 90, 200]);
    const output = bar(bar(flat(40, 20, [40, 90, 200]), 13, 27, 6, 14, [0, 0, 0]), 15, 25, 8, 12, [255, 255, 255]);   // a white bar with a black outline of 2 px
    expect(readOver(output, footage, all, WHITE)).toMatchObject({ area: 800, drawn: 14 * 8, ink: 40 });
    expect(readOver(footage, footage, all, WHITE)).toMatchObject({ area: 800, drawn: 0, ink: 0 });
  });
  it('gives the colour most of the drawn pixels have (the outline here: 72 pixels against 40), and none when nothing is drawn', () => {
    const footage = flat(40, 20, [40, 90, 200]);
    const output = bar(bar(flat(40, 20, [40, 90, 200]), 13, 27, 6, 14, [0, 0, 0]), 15, 25, 8, 12, [255, 255, 255]);
    expect(readOver(output, footage, all, WHITE).colour).toEqual({ r: 0, g: 0, b: 0 });
    expect(readOver(footage, footage, all, WHITE).colour).toBeNull();
  });
  it('a colour the footage shows within 2 pixels of the place, or between two of its colours there, is not drawn: an edge that moved a little or went soft', () => {
    const footage = bar(flat(40, 20, [0, 0, 0]), 20, 40, 0, 20, [255, 255, 255]);           // black | white
    const moved2 = bar(flat(40, 20, [0, 0, 0]), 18, 40, 0, 20, [255, 255, 255]);
    const moved4 = bar(flat(40, 20, [0, 0, 0]), 16, 40, 0, 20, [255, 255, 255]);
    const soft = bar(bar(flat(40, 20, [0, 0, 0]), 20, 40, 0, 20, [255, 255, 255]), 19, 21, 0, 20, [128, 128, 128]);
    expect(readOver(moved2, footage, all, WHITE).drawn).toBe(0);
    expect(readOver(moved4, footage, all, WHITE).drawn).toBe(2 * 20);
    expect(readOver(soft, footage, all, WHITE).drawn).toBe(0);
  });
  it('white letters on white footage draw nothing; their dark outline does', () => {
    const footage = flat(40, 20, [250, 250, 250]);
    const bare = bar(flat(40, 20, [250, 250, 250]), 15, 25, 8, 12, [255, 255, 255]);
    const outlined = bar(bar(flat(40, 20, [250, 250, 250]), 13, 27, 6, 14, [0, 0, 0]), 15, 25, 8, 12, [255, 255, 255]);
    expect(readOver(bare, footage, all, WHITE).drawn).toBe(0);
    expect(readOver(outlined, footage, all, WHITE)).toMatchObject({ drawn: 14 * 8 - 40, ink: 0 });
  });
  it('leaves the masked rects out, clips the rect, and can read every n-th pixel only', () => {
    const footage = flat(40, 20, [40, 90, 200]);
    const output = bar(flat(40, 20, [40, 90, 200]), 0, 10, 0, 20, [255, 255, 255]);
    expect(readOver(output, footage, all, WHITE, [{ x: 0, y: 0, width: 10, height: 20 }])).toMatchObject({ area: 600, drawn: 0, ink: 0 });
    expect(readOver(output, footage, { x: 30, y: 10, width: 50, height: 50 }, WHITE)).toMatchObject({ area: 100, drawn: 0, ink: 0 });
    expect(readOver(output, footage, all, WHITE, [], 2)).toMatchObject({ area: 200, drawn: 50, ink: 50 });
    expect(readOver(output, flat(20, 20, [0, 0, 0]), all, WHITE)).toMatchObject({ area: 0, drawn: 0, ink: 0 });   // pictures of two sizes: nothing can be compared
  });
});

describe('readInk on thin text', () => {
  it('a few solid pixels where thin strokes meet do not own the ring: under a fifth of the ink solid, the ring goes around all strokes', () => {
    const pic = flat(60, 30, [0, 0, 0]);
    const white = (x0: number, x1: number, y0: number, y1: number) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) pic.rgb.set([255, 255, 255], (y * 60 + x) * 3); };
    white(10, 50, 10, 12);                                  // a stroke 2 px thick: no solid ink
    white(20, 23, 16, 19);                                  // a 3x3 blob: one solid pixel of 89 ink pixels
    const r = readInk(pic, { x: 0, y: 0, width: 60, height: 30 }, { r: 255, g: 255, b: 255 });
    expect(r.ink).toBe(89);
    expect(r.solid).toBe(false);
    expect(r.ring).toBeGreaterThan(300);                    // around the stroke and the blob, not the 72 pixels around the blob alone
  });
});
