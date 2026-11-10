import { describe, expect, it } from 'vitest';
import { RULES } from '@/data/ports';
import { fileProblem, pictureProblem } from './photo-check';

const MIN = RULES.swapPhotoShortSideMin;

describe('the check of a photograph before it is sent', () => {
  it('takes a JPG, PNG or WebP of up to 10 MB', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) expect(fileProblem({ type, size: 10 * 1024 * 1024 })).toBeNull();
  });

  it('refuses another type, and a larger file', () => {
    expect(fileProblem({ type: 'image/gif', size: 10 })).toBe('type');
    expect(fileProblem({ type: 'image/png', size: 10 * 1024 * 1024 + 1 })).toBe('size');
  });

  it('refuses a picture whose short side is under the rule, whichever side that is', () => {
    expect(pictureProblem('body', { width: MIN - 1, height: 900 })).toBe('small');
    expect(pictureProblem('face', { width: 900, height: MIN - 1 })).toBe('small');
    expect(pictureProblem('face', { width: MIN, height: MIN })).toBeNull();
  });

  it('wants the full-body photograph upright; the face photograph may lie', () => {
    expect(pictureProblem('body', { width: 800, height: 600 })).toBe('landscape');
    expect(pictureProblem('body', { width: 600, height: 600 })).toBe('landscape');
    expect(pictureProblem('body', { width: 600, height: 800 })).toBeNull();
    expect(pictureProblem('face', { width: 800, height: 600 })).toBeNull();
  });

  it('holds the side photograph to the rules of the face one: the short side, and it may lie', () => {
    expect(pictureProblem('side', { width: 900, height: MIN - 1 })).toBe('small');
    expect(pictureProblem('side', { width: MIN, height: MIN })).toBeNull();
    expect(pictureProblem('side', { width: 800, height: 600 })).toBeNull();
  });
});
