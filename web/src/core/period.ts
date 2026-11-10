/** The periods of the admin panel's filters. */
export const PERIODS = ['today', '7d', '30d', 'all'] as const;
export type Period = (typeof PERIODS)[number];

const DAY_MS = 86_400_000;

/** `?period=` from the URL; an unknown or missing value is the default, 30 days. */
export function parsePeriod(raw: string | string[] | undefined): Period {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return PERIODS.find((period) => period === value) ?? '30d';
}

/**
 * Start of the period as a time, or null for "all time".
 * "Today" is the current calendar day in UTC (from 00:00 UTC), everywhere in the panel; 7 and 30 days count back from `now`.
 */
export function periodStart(period: Period, now: Date): number | null {
  if (period === 'all') return null;
  if (period === 'today') return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return now.getTime() - (period === '7d' ? 7 : 30) * DAY_MS;
}
