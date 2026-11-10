import { describe, expect, it } from 'vitest';
import { freeApplies } from './free';

describe('freeApplies', () => {
  it('a template without talking, while the page may promise the free video (`freeOffer()` in core)', () => {
    expect(freeApplies({ format: 'no-talking' }, true)).toBe(true);
  });
  it('never a talking template, never when the page may not promise it', () => {
    expect(freeApplies({ format: 'talking' }, true)).toBe(false);
    expect(freeApplies({ format: 'talking' }, false)).toBe(false);
    expect(freeApplies({ format: 'no-talking' }, false)).toBe(false);
  });
});
