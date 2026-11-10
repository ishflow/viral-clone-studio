import { parsePeriod as parseOne, type Period } from '@/core/period';
import { first } from '@/shared/lib/query';

export const TEMPLATE_FILTERS = ['all', 'published', 'waiting', 'hidden', 'private'] as const;
export type TemplateFilter = (typeof TEMPLATE_FILTERS)[number];
export const SOURCE_FILTERS = ['all', 'topads', 'shorts'] as const;
export type SourceFilter = (typeof SOURCE_FILTERS)[number];
export { PERIODS as SCAN_PERIODS, periodStart } from '@/core/period';
export type ScanPeriod = Period;

const pick = <T extends string>(options: readonly T[], value: string, fallback: T): T => ((options as readonly string[]).includes(value) ? (value as T) : fallback);

/** `?status=` and `?q=`; an unknown status falls back to "all". */
export function parseListQuery(params: Record<string, string | string[] | undefined>): { status: TemplateFilter; q: string } {
  return { status: pick(TEMPLATE_FILTERS, first(params.status), 'all'), q: first(params.q).trim().slice(0, 100) };
}
export function listHref({ status, q }: { status: TemplateFilter; q: string }): string {
  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);
  if (q) params.set('q', q);
  const text = params.toString();
  return text ? `/admin/templates?${text}` : '/admin/templates';
}

/** `?source=` of the inbox candidates. */
export function parseSource(params: Record<string, string | string[] | undefined>): SourceFilter {
  return pick(SOURCE_FILTERS, first(params.source), 'all');
}
export const inboxHref = (source: SourceFilter): string => (source === 'all' ? '/admin/templates/inbox' : `/admin/templates/inbox?source=${source}`);

/** `?period=` of the scan history; default 30 days. */
export function parsePeriod(params: Record<string, string | string[] | undefined>): ScanPeriod {
  return parseOne(params.period);
}
export const scansHref = (period: ScanPeriod): string => (period === '30d' ? '/admin/templates/scans' : `/admin/templates/scans?period=${period}`);

/**
 * "Scans run N times a day: …" line. `next` is the first time later than `now`; when none is left today, the first time tomorrow.
 * Times are `HH:MM`, sorted here.
 */
export function scanSchedule(times: string[], now: Date): { times: string[]; next: string; tomorrow: boolean } {
  const sorted = [...times].sort();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const today = sorted.find((time) => toMinutes(time) > minutes);
  return { times: sorted, next: today ?? sorted[0] ?? '', tomorrow: today === undefined && sorted.length > 0 };
}
