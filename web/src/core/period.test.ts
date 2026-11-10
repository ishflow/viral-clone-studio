import { describe, expect, it } from 'vitest';
import { PERIODS, parsePeriod, periodStart } from './period';

describe('parsePeriod', () => {
  it('keeps a known period and falls back to 30 days', () => {
    expect(PERIODS.map((period) => parsePeriod(period))).toEqual(['today', '7d', '30d', 'all']);
    expect(parsePeriod('year')).toBe('30d');
    expect(parsePeriod(undefined)).toBe('30d');
    expect(parsePeriod(['7d', 'all'])).toBe('7d');
  });
});

describe('periodStart', () => {
  const now = new Date('2026-10-04T15:30:00Z');
  it('"today" starts at midnight of the current day in UTC (not 24 hours ago)', () => {
    expect(periodStart('today', now)).toBe(Date.UTC(2026, 9, 4));
    expect(periodStart('today', new Date('2026-10-04T00:00:00Z'))).toBe(Date.UTC(2026, 9, 4));
    expect(periodStart('today', new Date('2026-10-04T23:59:59Z'))).toBe(Date.UTC(2026, 9, 4));
  });
  it('7 and 30 days count back from now; "all" has no start', () => {
    expect(periodStart('7d', now)).toBe(now.getTime() - 7 * 86_400_000);
    expect(periodStart('30d', now)).toBe(now.getTime() - 30 * 86_400_000);
    expect(periodStart('all', now)).toBeNull();
  });
});
