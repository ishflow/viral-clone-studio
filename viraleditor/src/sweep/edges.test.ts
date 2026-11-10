import { describe, expect, it } from 'vitest';
import { crossing, edgesOf } from './edges.ts';
import { runs } from './words.ts';

const ramp = (start: number, frames: number) => (f: number) => Math.min(1, Math.max(0, (f - start + 0.5) / frames));

describe('the frame of a faded edge', () => {
  it('finds where a ramp crosses half, between frames', () => {
    expect(crossing(ramp(10, 6), 0, 20, 0.5, 'enter')).toBeCloseTo(12.5, 6);
    expect(crossing((f) => 1 - ramp(30, 12)(f), 20, 45, 0.5, 'exit')).toBeCloseTo(35.5, 6);
    expect(crossing(() => 1, 0, 20, 0.5, 'enter')).toBeNull();
  });

  it('gives an error of one frame for a fade one frame late, whatever its length', () => {
    for (const length of [6, 12]) {
      const row = { element: 'x', at: 10, for: 40, rest: { at: 10 + length, for: 40 - 2 * length } };
      const promise = (f: number) => Math.min(ramp(10, length)(f), 1 - ramp(50 - length, length)(f));
      const late = (f: number) => promise(f - 1);
      const edges = edgesOf(row, 80, late, promise);
      expect(edges.map((e) => e.side)).toEqual(['enter', 'exit']);
      for (const e of edges) expect(e.error).toBeCloseTo(1, 6);
      expect(edgesOf(row, 80, promise, promise).every((e) => e.error === 0)).toBe(true);
    }
  });

  it('skips zones shorter than three frames and edges the promise does not fade', () => {
    expect(edgesOf({ element: 'x', at: 10, for: 20, rest: { at: 12, for: 18 } }, 40, () => 1, () => 1)).toEqual([]);
  });
});

describe('runs of ink', () => {
  it('merges gaps shorter than `gap` and keeps the others', () => {
    const v = [0, 1, 1, 0, 1, 0, 0, 0, 0, 1, 1, 0];
    expect(runs(v, 0.5, 1)).toEqual([[1, 3], [4, 5], [9, 11]]);
    expect(runs(v, 0.5, 2)).toEqual([[1, 5], [9, 11]]);
    expect(runs(v, 0.5, 5)).toEqual([[1, 11]]);
  });
});
