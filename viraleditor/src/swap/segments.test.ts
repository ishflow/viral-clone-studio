import { describe, expect, it } from 'vitest';
import { SwapTemplate } from '../template/swap-schema.ts';
import { segmentsOf } from './segments.ts';

const lengths = (seconds: number, cuts: number[] = [], fps = 30) => segmentsOf(seconds, cuts, fps).map((part) => Number((part.to - part.from).toFixed(3)));
const valid = (seconds: number, cuts: number[] = []) =>
  SwapTemplate.safeParse({ people: 1, persons: [{ slot: 1, box: { left: 0, top: 0, right: 50, bottom: 50 }, hint: 'the person' }], parts: segmentsOf(seconds, cuts, 30), sound: false }).success;

describe('segmentsOf', () => {
  it('one take is cut into the fewest equal parts of at most 10 seconds, on whole frames', () => {
    expect(segmentsOf(25, [], 30)).toEqual([{ n: 1, from: 0, to: 250 / 30 }, { n: 2, from: 250 / 30, to: 500 / 30 }, { n: 3, from: 500 / 30, to: 25 }]);
    expect(lengths(8)).toEqual([8]);
    expect(lengths(10.5)).toEqual([5.267, 5.233]);
  });
  it('a part ends at a cut of the video when the shots are long enough to be parts', () => {
    expect(lengths(20, [6, 13])).toEqual([6, 7, 7]);
  });
  it('shots shorter than 3 seconds are joined to the ones beside them, and a joined run over 10 seconds is cut evenly', () => {
    expect(lengths(12, [1, 2, 7, 10.5])).toEqual([7, 5]);
    expect(lengths(21, [9, 19])).toEqual([9, 6, 6]);
  });
  it('gives parts the template schema takes, for every length from 3 to 30 seconds', () => {
    for (let seconds = 3; seconds <= 30; seconds += 0.7) expect(valid(seconds, [seconds / 3, seconds / 2]), `${seconds} s`).toBe(true);
  });
  it('refuses a video shorter than 3 or longer than 30 seconds', () => {
    expect(() => segmentsOf(2.9, [], 30)).toThrow(/3 to 30 seconds/);
    expect(() => segmentsOf(30.5, [], 30)).toThrow(/3 to 30 seconds/);
  });
});
