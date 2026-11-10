import { describe, expect, it } from 'vitest';
import { makeTimeline } from './samples.ts';
import { placed, plainShot, valueOn } from './placement.ts';

type Rows = ReturnType<typeof makeTimeline>['animations'];
const row = (element: string, property: Rows[number]['property'], at: number, length: number, from: number, to: number, hold: Rows[number]['hold'] = 'both'): Rows[number] =>
  ({ element, property, at, for: length, from, to, ease: 'linear', hold });

describe('valueOn', () => {
  it('reads a property on a frame as the timeline defines it: held before and after, linear in between, the later row wins', () => {
    const rows = [row('a', 'scale', 10, 10, 1, 2)];
    expect(valueOn(rows, 'a', 'scale', 5, 1)).toBe(1);
    expect(valueOn(rows, 'a', 'scale', 10, 1)).toBeCloseTo(1.05, 9);        // the middle of the first frame
    expect(valueOn(rows, 'a', 'scale', 30, 1)).toBe(2);
    expect(valueOn(rows, 'b', 'scale', 15, 1)).toBe(1);
    expect(valueOn([row('a', 'opacity', 10, 10, 0, 1, 'none')], 'a', 'opacity', 5, 1)).toBe(1);
    expect(valueOn([...rows, row('a', 'scale', 40, 10, 2, 3)], 'a', 'scale', 60, 1)).toBe(3);
  });
  it('follows the easings of the document', () => {
    const eased = { ...row('a', 'x', 0, 10, 0, 100), ease: 'out' as const };
    expect(valueOn([eased], 'a', 'x', 4, 0)).toBeGreaterThan(80);           // `out` is nearly there before the middle
    expect(valueOn([{ ...eased, ease: 'step' as const }], 'a', 'x', 0, 0)).toBe(100);
  });
});

describe('plainShot', () => {
  const two = makeTimeline({
    shots: [
      { id: 's1', element: 's1-v', media: 'a', kind: 'video', at: 0, for: 40, tail: 8, from: 5 },
      { id: 's2', element: 's2-v', media: 'b', kind: 'image', at: 40, for: 50, tail: 0, from: 0 },
    ],
    transitions: [{ kind: 'crossfade', from: 's1', to: 's2', cut: 40, at: 40, for: 8, overlap: true, colour: null }],
    windows: [{ shot: 's2', behind: 'c', at: 60, for: 20, frames: 5, rect: { x: 0, y: 0, width: 100, height: 100 }, radius: 0, pictures: [] }],
    animations: [row('s2', 'opacity', 40, 8, 0, 1), row('s1-v', 'scale', 0, 48, 1, 1.24)],
  });
  it('names the one shot that fills the frame, its source frame and its scale', () => {
    expect(plainShot(two, 10)).toMatchObject({ shot: { id: 's1' }, source: 15 });
    expect(plainShot(two, 10)!.scale).toBeCloseTo(1 + 0.24 * (10.5 / 48), 9);
    expect(plainShot(two, 50)).toMatchObject({ shot: { id: 's2' }, source: 0, scale: 1 });
  });
  it('gives nothing while two shots are on screen, during a transition, during a window, and where no shot is', () => {
    expect(plainShot(two, 43)).toBeNull();
    expect(plainShot(two, 65)).toBeNull();
    expect(plainShot(two, 95)).toBeNull();
    const flash = makeTimeline({ transitions: [{ kind: 'flash', from: 'x', to: 'main', cut: 30, at: 27, for: 6, overlap: false, colour: '#ffffff' }] });
    expect(plainShot(flash, 29)).toBeNull();
    expect(plainShot(flash, 40)).toMatchObject({ shot: { id: 'main' }, source: 40, scale: 1 });
  });
  it('gives nothing while the shot itself is moved, faded or blurred', () => {
    for (const [property, from] of [['x', 30], ['opacity', 0.5], ['blur', 4], ['scale', 1.3]] as const) {
      expect(plainShot(makeTimeline({ animations: [row('main', property, 0, 20, from, from)] }), 10)).toBeNull();
    }
  });
});

describe('placed', () => {
  const picture = (width: number, height: number, at: (x: number, y: number) => number) => {
    const rgb = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgb.fill(at(x, y), (y * width + x) * 3, (y * width + x) * 3 + 3);
    return { width, height, rgb };
  };
  const grey = (p: { width: number; rgb: Uint8Array }, x: number, y: number) => p.rgb[(y * p.width + x) * 3]!;
  it('is the source itself when the source has the canvas size and the scale is 1', () => {
    const source = picture(8, 16, (x, y) => x * 10 + y);
    expect(placed(source, 8, 16, 1, [50, 50])).toBe(source);
  });
  it('covers the canvas with a source of another size, keeping the focus', () => {
    const wide = picture(32, 16, (x) => x * 8);                               // twice as wide as the 16x16 canvas: half of it is cut
    const middle = placed(wide, 16, 16, 1, [50, 50]);
    expect([middle.width, middle.height]).toEqual([16, 16]);
    expect(grey(middle, 0, 5)).toBe(8 * 8);
    expect(grey(placed(wide, 16, 16, 1, [0, 50]), 0, 5)).toBe(0);
    expect(grey(placed(wide, 16, 16, 1, [100, 50]), 15, 5)).toBe(31 * 8);
    const half = placed(picture(8, 8, (x) => x * 32), 16, 16, 1, [50, 50]);  // enlarged twice
    expect(grey(half, 8, 8)).toBe(3.75 * 32);
  });
  it('scales around the focus', () => {
    const source = picture(16, 16, (x) => x * 16);
    const centred = placed(source, 16, 16, 2, [50, 50]);
    expect(grey(centred, 0, 0)).toBeCloseTo(3.75 * 16, 0);                  // canvas x 0.5 comes from source x 4.25 (centre 8, scale 2)
    const left = placed(source, 16, 16, 2, [0, 0]);
    expect(grey(left, 15, 0)).toBeCloseTo(7.25 * 16, 0);
  });
});
