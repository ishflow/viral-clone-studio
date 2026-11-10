import { describe, expect, it } from 'vitest';
import { scanSchedule } from './query';
import { clock, moveShot, tileShots } from './shots';

describe('scanSchedule', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 4, h, m);
  it('next is the first time later than now', () => {
    expect(scanSchedule(['21:00', '09:00', '15:00'], at(10)).next).toBe('15:00');
    expect(scanSchedule(['09:00', '15:00', '21:00'], at(15)).next).toBe('21:00');
    expect(scanSchedule(['09:00', '15:00', '21:00'], at(8, 59)).next).toBe('09:00');
  });
  it('when none is left today, it is the first time tomorrow', () => {
    expect(scanSchedule(['09:00', '15:00', '21:00'], at(22))).toMatchObject({ next: '09:00', tomorrow: true });
    expect(scanSchedule(['09:00', '15:00', '21:00'], at(10))).toMatchObject({ next: '15:00', tomorrow: false });
  });
  it('sorts the times and survives an empty list', () => {
    expect(scanSchedule(['21:00', '09:00'], at(1)).times).toEqual(['09:00', '21:00']);
    expect(scanSchedule([], at(1))).toEqual({ times: [], next: '', tomorrow: false });
  });
});

describe('shots', () => {
  const drafts = (n: number) => Array.from({ length: n }, (_, i) => ({ action: `a${i}`, text: '', product: null }));
  it.each([[13, 5], [13, 1], [8, 4], [30, 7]])('%i sec over %i shots tile exactly: first at 0, last at the end, no gaps, each at least one second', (seconds, n) => {
    const shots = tileShots(seconds, drafts(n));
    expect(shots[0]!.from).toBe(0);
    expect(shots.at(-1)!.to).toBe(seconds);
    shots.forEach((s, i) => {
      expect(s.n).toBe(i + 1);
      expect(s.to - s.from).toBeGreaterThanOrEqual(1);
      if (i > 0) expect(s.from).toBe(shots[i - 1]!.to);
    });
  });
  it('formats times and moves items', () => {
    expect(clock(65)).toBe('1:05');
    expect(clock(2)).toBe('0:02');
    expect(clock(2.6)).toBe('0:03');
    expect(moveShot([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moveShot([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
  });
});
