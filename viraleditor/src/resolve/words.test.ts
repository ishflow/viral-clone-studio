import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ResolveError } from './error.ts';
import { JOIN_FRAMES, markFrames, placeWords } from './words.ts';

const FPS = 30;
const time = (start: number, end: number) => ({ start, end });

describe('placeWords', () => {
  it('rounds seconds to frames with Math.round(seconds × fps), from the first frame of the segment', () => {
    const words = placeWords(['one', 'two'], [time(1.234, 1.5), time(1.549, 1.983)], { at: 100, for: 90 }, FPS);
    expect(words).toEqual([{ text: 'one', at: 137, for: 8 }, { text: 'two', at: 146, for: 13 }]);   // 37.02 → 37 · 45 · 46.47 → 46 · 59.49 → 59
  });
  it('a word never starts before the one before it ends', () => {
    const words = placeWords(['one', 'two', 'three'], [time(0.1, 0.5), time(0.4, 0.8), time(0.7, 1)], { at: 0, for: 60 }, FPS);
    expect(words).toEqual([{ text: 'one', at: 3, for: 12 }, { text: 'two', at: 15, for: 9 }, { text: 'three', at: 24, for: 6 }]);
  });
  it('a word of 0 frames gets 1, and the next one moves on', () => {
    const words = placeWords(['a', 'b', 'c'], [time(0.5, 0.5), time(0.5, 0.51), time(0.5, 0.6)], { at: 0, for: 60 }, FPS);
    expect(words).toEqual([{ text: 'a', at: 15, for: 1 }, { text: 'b', at: 16, for: 1 }, { text: 'c', at: 17, for: 1 }]);
  });
  it('words heard after the clip ends come back inside it, one frame each from the cut backwards', () => {
    const words = placeWords(['a', 'b', 'c'], [time(0.2, 0.4), time(5, 5.2), time(5.2, 5.6)], { at: 30, for: 30 }, FPS);
    expect(words).toEqual([{ text: 'a', at: 36, for: 6 }, { text: 'b', at: 58, for: 1 }, { text: 'c', at: 59, for: 1 }]);
  });
  it('a time that is not a number counts as the start of the clip', () => {
    const words = placeWords(['a', 'b'], [time(Number.NaN, Number.POSITIVE_INFINITY), time(0.2, 0.3)], { at: 10, for: 30 }, FPS);
    expect(words).toEqual([{ text: 'a', at: 10, for: 1 }, { text: 'b', at: 16, for: 3 }]);
  });
  it('segment-short: more words than the clip has frames', () => {
    const run = () => placeWords(['a', 'b', 'c'], [time(0, 0.1), time(0.1, 0.2), time(0.2, 0.3)], { at: 0, for: 2 }, FPS);
    expect(run).toThrow(ResolveError);
    expect(run).toThrow(/2 frames/);
  });

  it('whatever the times are: the words are in order, at least one frame long, never overlapping and inside the segment', () => {
    const anyTime = fc.record({ start: fc.double({ min: -5, max: 40, noNaN: false }), end: fc.double({ min: -5, max: 40, noNaN: false }) });
    fc.assert(fc.property(fc.array(anyTime, { minLength: 1, maxLength: 40 }), fc.integer({ min: 0, max: 900 }), fc.integer({ min: 40, max: 450 }), (times, at, length) => {
      const words = placeWords(times.map((_, i) => `w${i}`), times, { at, for: length }, FPS);
      expect(words).toHaveLength(times.length);
      let free = at;
      for (const word of words) {
        expect(Number.isInteger(word.at) && Number.isInteger(word.for)).toBe(true);
        expect(word.for).toBeGreaterThanOrEqual(1);
        expect(word.at).toBeGreaterThanOrEqual(free);
        free = word.at + word.for;
      }
      expect(free).toBeLessThanOrEqual(at + length);
    }), { numRuns: 300 });
  });
});

describe('markFrames', () => {
  const words = [
    { text: 'a', at: 10, for: 5 }, { text: 'b', at: 15, for: 5 },       // 0, 1
    { text: 'c', at: 20 + JOIN_FRAMES, for: 5 },                         // 2: begins exactly JOIN_FRAMES after b ends
    { text: 'd', at: 60, for: 5 },                                       // 3: begins long after c ends
    { text: 'e', at: 80, for: 6 },                                       // 4: the last word, ends 4 frames before the cut
  ];
  const segment = { at: 0, for: 90 };

  it('runs from its first word to where the next word begins, when that is close', () => {
    expect(markFrames(words, { from: 0, to: 1 }, segment)).toEqual({ at: 10, for: 22 });
  });
  it('stays JOIN_FRAMES after its last word when the next word is far', () => {
    expect(markFrames(words, { from: 1, to: 2 }, segment)).toEqual({ at: 15, for: 22 + JOIN_FRAMES });       // c ends at 37, d begins at 60
  });
  it('runs to the cut when its last word is the last of the segment and the cut is close', () => {
    expect(markFrames(words, { from: 4, to: 4 }, segment)).toEqual({ at: 80, for: 10 });
  });
  it('stays JOIN_FRAMES after its last word when the cut is far', () => {
    expect(markFrames(words, { from: 4, to: 4 }, { at: 0, for: 200 })).toEqual({ at: 80, for: 6 + JOIN_FRAMES });
  });
  it('a one-word mark before a pause is not a flash: a word of 2 frames gives 2 + JOIN_FRAMES frames', () => {
    const short = [{ text: 'Now', at: 40, for: 2 }, { text: 'look', at: 100, for: 9 }];
    expect(markFrames(short, { from: 0, to: 0 }, { at: 0, for: 150 })).toEqual({ at: 40, for: 14 });
    expect(markFrames([{ text: 'Now', at: 40, for: 1 }, { text: 'look', at: 45, for: 9 }], { from: 0, to: 0 }, { at: 0, for: 150 })).toEqual({ at: 40, for: 5 });
  });
});
