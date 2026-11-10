import { describe, expect, it } from 'vitest';
import type { SwapPerson } from '../ports.ts';
import { swapPrompt } from './prompt.ts';

const person = (slot: number, hint = ''): SwapPerson => ({ slot, body: `/uploads/u1/body-${slot}.png`, face: null, hint });
const linesOf = (text: string): string[] => text.split('\n');

describe('swapPrompt', () => {
  it('asks to replace only the person and nothing else', () => {
    const [first] = linesOf(swapPrompt([person(1)]));
    expect(first).toMatch(/^Replace ONLY the person in the video/);
    expect(first).toMatch(/nothing else/i);
  });

  it('locks what is not the person: the background, the motion and the camera stay the same', () => {
    const text = swapPrompt([person(1)]);
    expect(text).toMatch(/^Keep the background\b.*exactly the same/m);
    expect(text).toMatch(/^Keep the motion\b.*exactly the same/m);
    expect(text).toMatch(/^Keep the camera\b.*exactly the same/m);
  });

  it('ends with the things to avoid', () => {
    const rows = linesOf(swapPrompt([person(1)]));
    expect(rows.at(-1)).toMatch(/^Avoid: /);
  });

  it('names the person of the video by the hint of each person: Image 1 = …, Image 2 = …', () => {
    const text = swapPrompt([person(1, 'the woman in the middle'), person(2, 'the man on the left')]);
    expect(linesOf(text)).toContain('Image 1 = the woman in the middle');
    expect(linesOf(text)).toContain('Image 2 = the man on the left');
    expect(text).toMatch(/^Replace ONLY the 2 people in the video/);
  });

  it('numbers the images by the place of the person in the request, not by the slot', () => {
    const text = swapPrompt([person(2, 'the man on the left')]);
    expect(linesOf(text)).toContain('Image 1 = the man on the left');
  });

  it('has no Image line for a person without a hint', () => {
    expect(swapPrompt([person(1, '  ')])).not.toMatch(/Image 1/);
    const text = swapPrompt([person(1), person(2, 'the man on the left')]);
    expect(text).not.toMatch(/Image 1 =/);
    expect(linesOf(text)).toContain('Image 2 = the man on the left');
  });

  it('says nothing about the clothes unless it is asked to', () => {
    expect(swapPrompt([person(1)])).not.toMatch(/outfit/i);
    expect(linesOf(swapPrompt([person(1)], { outfit: 'keep' }))).toContain('Outfit: keep the clothes of the person in the video.');
    expect(linesOf(swapPrompt([person(1)], { outfit: 'photo' }))).toContain('Outfit: the person wears the clothes of the photograph.');
  });

  it('is the same text for the same request', () => {
    expect(swapPrompt([person(1, 'the woman')])).toBe(swapPrompt([person(1, 'the woman')]));
  });
});
