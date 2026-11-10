import { describe, expect, it } from 'vitest';
import { halfSeconds, seconds } from './time.ts';

describe('time', () => {
  it('writes seconds with full precision, never rounded (R1)', () => {
    expect(seconds(47, 30)).toBe('1.5666666666666667');
    expect(seconds(0, 30)).toBe('0');
    expect(seconds(180, 30)).toBe('6');
  });

  it('puts an edge half a frame before its frame (R2)', () => {
    expect(halfSeconds(0, 30)).toBe(String(-0.5 / 30));
    expect(halfSeconds(60, 30)).toBe(String(59.5 / 30));
    expect(Number(halfSeconds(30, 30)) * 30).toBeCloseTo(29.5, 12);
  });
});
