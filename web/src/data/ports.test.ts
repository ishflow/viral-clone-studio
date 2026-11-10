import { describe, expect, it } from 'vitest';
import { RULES, swapCredits, swapPeopleProblem } from './ports';
import type { SwapSlot } from './ports';

describe('the price of a person swap', () => {
  it.each([
    [3, 1], [5, 1], [5.1, 2], [10, 2], [10.4, 3], [25, 5], [30, 6],
  ])('a video of %s s is %s started blocks of five seconds', (seconds, blocks) => {
    expect(swapCredits(seconds, 1)).toBe(blocks);
  });
  it('every block costs the rate of the quality: 10 s and 30 s at 1 and at 2 credits', () => {
    expect([swapCredits(10, 1), swapCredits(30, 1)]).toEqual([2, 6]);
    expect([swapCredits(10, 2), swapCredits(30, 2)]).toEqual([4, 12]);
  });
  it('follows the block length of the rules', () => {
    expect(swapCredits(RULES.swapBlockSeconds, 3)).toBe(3);
    expect(swapCredits(RULES.swapBlockSeconds * 2, 3)).toBe(6);
  });
});

describe('the rules of a person swap', () => {
  it('are the ones decided for the launch', () => {
    expect(RULES).toMatchObject({
      swapSecondsMin: 3, swapSecondsMax: 30, swapBlockSeconds: 5,
      swapPhotoShortSideMin: 340,
      swapPhotosKeptHours: 24, swapStoppedPhotosKeptDays: 7, swapVideosKeptDays: 30,
    });
  });
});

describe('the people an admin sets for a person-swap video', () => {
  const woman: SwapSlot = { slot: 1, box: { left: 12.5, top: 20, right: 60, bottom: 98 }, hint: 'the woman on the left in a red dress' };
  const man: SwapSlot = { slot: 2, box: { left: 55, top: 0, right: 100, bottom: 100 }, hint: 'the man on the right' };
  const box = (change: Partial<SwapSlot['box']>): SwapSlot => ({ ...woman, box: { ...woman.box, ...change } });

  it('are one or two, numbered from 1 in order, each with a box inside the picture and one line of words', () => {
    expect([swapPeopleProblem([woman]), swapPeopleProblem([woman, man])]).toEqual([null, null]);
    expect(swapPeopleProblem([{ ...woman, hint: 'a'.repeat(RULES.swapHintMax) }])).toBeNull();
    expect(swapPeopleProblem([box({ left: 0, top: 0, right: 100, bottom: 100 })])).toBeNull();
  });

  it.each<[string, unknown, string]>([
    ['nobody', [], 'people'],
    ['three people', [woman, man, { ...man, slot: 3 }], 'people'],
    ['no list', { persons: [woman] }, 'people'],
    ['a person that is none', [null], 'people'],
    ['a person numbered 2 alone', [{ ...woman, slot: 2 }], 'slot'],
    ['two people in the wrong order', [man, woman], 'slot'],
    ['a box past the right edge', [box({ right: 100.5 })], 'box'],
    ['a box past the left edge', [box({ left: -0.1 })], 'box'],
    ['a box past the bottom', [box({ bottom: 101 })], 'box'],
    ['a box with no width', [box({ left: 60 })], 'box'],
    ['a box that is upside down', [box({ top: 98, bottom: 20 })], 'box'],
    ['a box with an edge that is no number', [box({ top: Number.NaN })], 'box'],
    ['a box with words for an edge', [box({ top: '20' as unknown as number })], 'box'],
    ['no box', [{ slot: 1, hint: woman.hint }], 'box'],
    ['no words', [{ ...woman, hint: '' }], 'hint'],
    ['blanks for words', [{ ...woman, hint: '   ' }], 'hint'],
    ['words longer than the rule', [{ ...woman, hint: 'a'.repeat(RULES.swapHintMax + 1) }], 'hint'],
    ['words on two lines', [{ ...woman, hint: 'the woman\non the left' }], 'hint'],
    ['words with a hidden direction mark', [{ ...woman, hint: 'the woman ‮on the left' }], 'hint'],
    ['words that are no text', [{ ...woman, hint: 7 }], 'hint'],
    ['a field no person has', [{ ...woman, face: 'uploads/u1/face.png' }], 'people'],
  ])('%s is refused', (_name, persons, problem) => {
    expect(swapPeopleProblem(persons)).toBe(problem);
  });
});
