import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SHOT_SECONDS_MAX } from '../template/limits.ts';
import { Template } from '../template/schema.ts';
import { FAINT_SECONDS_MIN, offPlan, shotPlan, SHOT_FRAMES_MIN, SHOTS_MAX, shownFrames } from './cuts.ts';

const lengths = (plan: { at: number; for: number }[]) => plan.map((shot) => shot.for);
/** Every shot starts on the frame the one before it ends, the first at 0. */
const gapless = (plan: { at: number; for: number }[]) => plan.every((shot, i) => shot.at === (i === 0 ? 0 : plan[i - 1]!.at + plan[i - 1]!.for));

describe('shotPlan', () => {
  it('the first real reference: 27 cuts measured in seconds are its 28 shots, frame for frame', () => {
    const cuts = [1.7, 2.7, 3.733333, 4.833333, 5.633333, 6.9, 7.9, 8.6, 9.733333, 10.566667, 11.266667, 12.466667, 13.466667, 14.333333, 15.433333, 16.266667, 17,
      18.166667, 18.966667, 20.366667, 21.9, 22.866667, 24.333333, 26, 26.933333, 29.933333, 31.466667];
    const plan = shotPlan(cuts, 34.4, 30);
    expect(lengths(plan)).toEqual([51, 30, 31, 33, 24, 38, 30, 21, 34, 25, 21, 36, 30, 26, 33, 25, 22, 35, 24, 42, 46, 29, 44, 50, 28, 90, 46, 88]);
    expect(plan.slice(0, 3)).toEqual([{ at: 0, for: 51 }, { at: 51, for: 30 }, { at: 81, for: 31 }]);
    expect(plan.at(-1)).toEqual({ at: 944, for: 88 });
    expect(gapless(plan)).toBe(true);
  });

  it('a second becomes the nearest frame, and the last shot ends on the nearest frame of the length', () => {
    expect(shotPlan([1.016, 2.017], 3.349, 30)).toEqual([{ at: 0, for: 30 }, { at: 30, for: 31 }, { at: 61, for: 39 }]);   // 30.48 → 30, 60.51 → 61, 100.47 → 100
    expect(shotPlan([0.98], 2.02, 25)).toEqual([{ at: 0, for: 25 }, { at: 25, for: 26 }]);                                // 24.5 → 25, 50.5 → 51
  });

  it('one continuous take is one shot', () => {
    expect(shotPlan([], 8, 30)).toEqual([{ at: 0, for: 240 }]);
  });

  it(`a cut less than ${SHOT_FRAMES_MIN} frames after the kept cut before it, or before the end, is dropped`, () => {
    const at = (...frames: number[]) => frames.map((frame) => frame / 30);
    expect(lengths(shotPlan(at(7), 2, 30))).toEqual([60]);                         // 7 frames after the start
    expect(lengths(shotPlan(at(8), 2, 30))).toEqual([8, 52]);
    expect(lengths(shotPlan(at(30, 37), 2, 30))).toEqual([30, 30]);                // a flash: 7 frames after a cut
    expect(lengths(shotPlan(at(30, 38), 2, 30))).toEqual([30, 8, 22]);
    expect(lengths(shotPlan(at(30, 53), 2, 30))).toEqual([30, 30]);                // 7 frames before the end
    expect(lengths(shotPlan(at(30, 52), 2, 30))).toEqual([30, 22, 8]);
    // the distance is counted from the cut that was kept, not from the one that was dropped
    expect(shotPlan(at(10, 15, 18, 23), 2, 30)).toEqual([{ at: 0, for: 10 }, { at: 10, for: 8 }, { at: 18, for: 42 }]);
    expect(gapless(shotPlan(at(3, 10, 15, 18, 23, 57), 2, 30))).toBe(true);
  });

  it('a shot longer than a template allows is split into the fewest equal parts that fit, whole frames, at most one apart', () => {
    const longest = SHOT_SECONDS_MAX * 30;
    expect(lengths(shotPlan([], longest / 30, 30))).toEqual([longest]);                              // just fits: not split
    expect(lengths(shotPlan([], (longest + 1) / 30, 30))).toEqual([longest / 2, longest / 2 + 1]);
    expect(lengths(shotPlan([], 1000 / 30, 30))).toEqual([333, 333, 334]);
    const plan = shotPlan([2], 2 + (2 * longest + 100) / 30, 30);                                    // only the long shot is split
    expect(plan.map((shot) => shot.at)).toEqual([0, 60, 60 + 333, 60 + 666]);
    expect(lengths(plan)).toEqual([60, 333, 333, 334]);
    expect(gapless(plan)).toBe(true);
    expect(Math.max(...lengths(plan))).toBeLessThanOrEqual(longest);
  });

  describe('a take too long for one shot, with faint cuts in it', () => {
    const longest = SHOT_SECONDS_MAX * 30;
    const apart = FAINT_SECONDS_MIN * 30;
    const faint = (...cuts: [number, number][]) => cuts.map(([frame, score]) => ({ second: frame / 30, score }));
    const starts = (plan: { at: number; for: number }[]) => plan.map((shot) => shot.at);

    it('the second real reference: a 22 s take between two cuts is cut at its two faint cuts, not in two equal parts', () => {
      const cuts = [2.5, 24.766667];
      expect(starts(shotPlan(cuts, 27.466667, 30))).toEqual([0, 75, 409, 743]);                        // without them: 13.63 s, the middle of a scene
      const plan = shotPlan(cuts, 27.466667, 30, [{ second: 8.2, score: 0.215948 }, { second: 17.9, score: 0.172012 }]);
      expect(plan).toEqual([{ at: 0, for: 75 }, { at: 75, for: 171 }, { at: 246, for: 291 }, { at: 537, for: 206 }, { at: 743, for: 81 }]);
      expect(gapless(plan)).toBe(true);
    });

    it('the strongest faint cut is taken first, and a part that fits is cut no further', () => {
      // 20 s: the cut at 4 s leaves 16 s, which the next strongest cuts; the weakest, in a part that fits by then, is left alone
      expect(starts(shotPlan([], 20, 30, faint([120, 0.25], [300, 0.2], [450, 0.15])))).toEqual([0, 120, 300]);
      expect(starts(shotPlan([], 20, 30, faint([120, 0.15], [300, 0.25], [450, 0.2])))).toEqual([0, 300]);
      expect(starts(shotPlan([], 20, 30, faint([200, 0.2], [400, 0.2])))).toEqual([0, 200]);            // as strong as each other: the earlier one
    });

    it('a take that fits in a shot is never cut at a faint cut', () => {
      expect(shotPlan([], longest / 30, 30, faint([200, 0.29]))).toEqual([{ at: 0, for: longest }]);
      const plan = shotPlan([10], 10 + (longest + 30) / 30, 30, faint([150, 0.29], [300 + 120, 0.2]));  // the first take is 10 s, the second 16 s
      expect(starts(plan)).toEqual([0, 300, 420]);
    });

    it('a long take with no faint cut in it is split in equal parts, as without any', () => {
      const plan = shotPlan([2], 2 + (2 * longest + 100) / 30, 30, faint([30, 0.29]));                  // the only faint cut is in the 2 s take
      expect(starts(plan)).toEqual([0, 60, 60 + 333, 60 + 666]);
      expect(lengths(plan)).toEqual([60, 333, 333, 334]);
    });

    it(`a faint cut less than ${FAINT_SECONDS_MIN} s after the start of its take, or before its end, is not used`, () => {
      const even = [longest / 2 + 15, longest / 2 + 15];                                                // 16 s in two equal parts
      expect(lengths(shotPlan([], 16, 30, faint([apart - 1, 0.29])))).toEqual(even);
      expect(lengths(shotPlan([], 16, 30, faint([apart, 0.29])))).toEqual([apart, 480 - apart]);
      expect(lengths(shotPlan([], 16, 30, faint([480 - apart + 1, 0.29])))).toEqual(even);
      expect(lengths(shotPlan([], 16, 30, faint([480 - apart, 0.29])))).toEqual([480 - apart, apart]);
      // counted from the cut that starts the take, and from the faint cut already taken
      expect(starts(shotPlan([2], 18, 30, faint([60 + apart - 1, 0.29])))).toEqual([0, 60, 60 + 240]);
      expect(starts(shotPlan([], 20, 30, faint([120, 0.29], [120 + apart - 1, 0.2])))).toEqual([0, 300]);   // 120 leaves 480 frames, and the cut that would split them is too near it
    });

    it('faint cuts that leave a part too long are not used at all: the take is split in equal parts, never both ways', () => {
      expect(lengths(shotPlan([], 20, 30, faint([60, 0.29])))).toEqual([300, 300]);                      // 60 would leave 18 s
      expect(lengths(shotPlan([], 40, 30, faint([300, 0.29], [600, 0.2])))).toEqual([400, 400, 400]);   // 600 would leave 20 s
      expect(lengths(shotPlan([], 40, 30, faint([300, 0.29], [600, 0.2], [900, 0.15])))).toEqual([300, 300, 300, 300]);
    });

    it('a take the faint cuts would cut into more than one part beyond its equal parts is split in equal parts: every part is a billed shot', () => {
      const many = Array.from({ length: 8 }, (_, i): [number, number] => [apart * (i + 1), 0.29 - i * 0.01]);   // 45 s: nine parts, where three fit
      expect(lengths(shotPlan([], 45, 30, faint(...many)))).toEqual([450, 450, 450]);
      // one part more than the equal parts is the price of following the real cuts, as in the second real reference
      expect(starts(shotPlan([], 22, 30, faint([200, 0.2], [400, 0.2])))).toEqual([0, 200, 400]);
      // the cap is counted for each take: the take beside it, cut at its faint cuts, keeps them
      const plan = shotPlan([45], 67, 30, faint(...many, [1350 + 200, 0.2], [1350 + 400, 0.2]));
      expect(starts(plan)).toEqual([0, 450, 900, 1350, 1550, 1750]);
    });

    it('a faint cut that would leave a part shorter than a clip is billed for is not used', () => {
      expect(lengths(shotPlan([], 16, 30, faint([36, 0.29])))).toEqual([240, 240]);                     // 1.2 s: billed as 4 s
      expect(lengths(shotPlan([], 16, 30, faint([480 - 36, 0.29])))).toEqual([240, 240]);
      expect(lengths(shotPlan([], 16, 30, faint([36, 0.29], [200, 0.2])))).toEqual([200, 280]);          // the cut that is left is used
    });

    it('a plan that the faint cuts make too long for a template falls back to equal parts', () => {
      const cuts = Array.from({ length: SHOTS_MAX - 2 }, (_, i) => (i + 1) / 2);                       // 28 cuts: 29 takes, the last one 20 s
      const last = cuts.at(-1)! * 30;
      const two = faint([last + 120, 0.29], [last + 420, 0.2]);                                         // would cut it in three
      expect(shotPlan(cuts, last / 30 + 20, 30, two)).toHaveLength(SHOTS_MAX);
      expect(starts(shotPlan(cuts, last / 30 + 20, 30, two)).slice(-2)).toEqual([last, last + 300]);
      expect(starts(shotPlan(cuts.slice(1), last / 30 + 20, 30, two)).slice(-3)).toEqual([last, last + 120, last + 420]);   // one shot fewer before it: the three fit
    });
  });

  it('the most shots a plan may have is the most a template may have', () => {
    const shape = z.toJSONSchema(Template) as { properties: Record<string, { maxItems?: number }> };
    expect(SHOTS_MAX).toBe(shape.properties.shots!.maxItems);
    const cuts = Array.from({ length: SHOTS_MAX }, (_, i) => (i + 1) / 2);                           // one more shot than cuts: nothing is merged
    expect(shotPlan(cuts, SHOTS_MAX / 2 + 0.5, 30)).toHaveLength(SHOTS_MAX + 1);
  });
});

describe('shownFrames', () => {
  it('a shot is shown two frames after it starts and three before it ends, never outside itself', () => {
    expect(shownFrames({ at: 51, for: 30 })).toEqual([53, 78]);
    expect(shownFrames({ at: 0, for: SHOT_FRAMES_MIN })).toEqual([2, 5]);
    expect(shownFrames({ at: 40, for: 2 })).toEqual([41, 40]);
  });
});

describe('offPlan', () => {
  const plan = [{ at: 0, for: 51 }, { at: 51, for: 30 }, { at: 81, for: 31 }];
  const shots = (...pairs: [number, number][]) => pairs.map(([at, frames]) => ({ at, for: frames }));

  it('the shots of the plan, in its order, with its frames: nothing', () => {
    expect(offPlan(shots([0, 51], [51, 30], [81, 31]), plan)).toEqual([]);
  });

  it('another number of shots: one issue, and its fix names every shot of the plan', () => {
    expect(offPlan(shots([0, 81], [81, 31]), plan)).toEqual([{
      code: 'cuts', path: 'shots', message: 'The template has 2 shots, the reference has 3.',
      fix: 'Write exactly 3 shots, with these "at"/"for": 0/51, 51/30, 81/31.',
    }]);
    expect(offPlan([], plan)).toHaveLength(1);
  });

  it('one wrong "at", one wrong "for": an issue for each such shot, with the right numbers', () => {
    expect(offPlan(shots([0, 51], [50, 30], [81, 31]), plan)).toEqual([{
      code: 'cuts', path: 'shots.1.at', message: 'The shot is at 50 for 30 frames; shot 2 of the reference is at 51 for 30.', fix: 'Write "at": 51, "for": 30.',
    }]);
    expect(offPlan(shots([0, 51], [51, 30], [81, 64]), plan)).toEqual([{
      code: 'cuts', path: 'shots.2.at', message: 'The shot is at 81 for 64 frames; shot 3 of the reference is at 81 for 31.', fix: 'Write "at": 81, "for": 31.',
    }]);
    expect(offPlan(shots([0, 50], [50, 31], [81, 31]), plan).map((issue) => issue.path)).toEqual(['shots.0.at', 'shots.1.at']);
  });

  it('a shot without frames (a speech shot) is off the plan', () => {
    expect(offPlan([{}, { at: 51, for: 30 }, { at: 81, for: 31 }], plan).map((issue) => issue.path)).toEqual(['shots.0.at']);
  });
});
