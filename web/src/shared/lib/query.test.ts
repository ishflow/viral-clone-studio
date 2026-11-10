// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { first } from './query';

describe('first', () => {
  it('is the value of a parameter, the first one when the address repeats it, and empty when it is missing', () => {
    expect(first('paid')).toBe('paid');
    expect(first(['paid', 'refunded'])).toBe('paid');
    expect(first([])).toBe('');
    expect(first(undefined)).toBe('');
  });
});
