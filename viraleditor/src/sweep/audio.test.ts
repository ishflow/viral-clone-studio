// How short a hole the method of the sweep can see (no render needed): clean tones, and the same tones with zeroed samples.
import { describe, expect, it } from 'vitest';
import { HOLE_LIMIT, MIN_HOLE, RATE, longestQuiet, phaseLag } from './audio.ts';

const sine = (n: number, hz = 440, amplitude = 4096) => Int16Array.from({ length: n }, (_, i) => Math.round(amplitude * Math.sin((2 * Math.PI * hz * i) / RATE)));

describe('hole detector', () => {
  const clean = sine(48000);
  it('finds no hole in a clean tone, and its longest quiet run is a zero crossing', () => {
    expect(longestQuiet(clean, 0, clean.length, HOLE_LIMIT(4096)).run).toBeLessThan(MIN_HOLE);
  });
  for (const hole of [1, 2, 3, 4, 8, 32, 64]) {
    it(`sees a hole of ${hole} sample(s) at a seam: ${hole >= MIN_HOLE ? 'flagged' : 'below the method (not flagged)'}`, () => {
      const damaged = Int16Array.from(clean);
      const at = 10000 + 37;                                      // not at a zero crossing: the seam of a loop falls anywhere
      for (let i = 0; i < hole; i++) damaged[at + i] = 0;
      const { run } = longestQuiet(damaged, at - 200, at + 400, HOLE_LIMIT(4096));
      if (hole >= MIN_HOLE) expect(run).toBeGreaterThanOrEqual(MIN_HOLE); else expect(run).toBeLessThan(MIN_HOLE + 1);
    });
  }
  it('sees a hole that falls on a zero crossing, as long as it is longer than the crossing itself', () => {
    const damaged = Int16Array.from(clean);
    const crossing = Math.round(RATE / 440 / 2) * 20;             // a half period multiple: s ≈ 0 there
    for (let i = 0; i < 8; i++) damaged[crossing + i] = 0;
    expect(longestQuiet(damaged, crossing - 100, crossing + 200, HOLE_LIMIT(4096)).run).toBeGreaterThanOrEqual(MIN_HOLE);
  });
  it('reads a shift of a pass by its phase', () => {
    const shifted = sine(4000);
    const late = new Int16Array(4000); late.set(shifted.subarray(0, 4000 - 24), 24);          // starts 24 samples late
    expect(phaseLag(late, 440, 0)).toBe(24);
    expect(phaseLag(shifted, 440, 0)).toBe(0);
  });
});
