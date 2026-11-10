import { parsePeriod, type Period } from '@/core/period';
import { first } from '@/shared/lib/query';

export const JOB_STATUSES = ['all', 'queued', 'running', 'stopped', 'closed', 'done'] as const;
export type JobFilter = (typeof JOB_STATUSES)[number];
export { PERIODS as JOB_PERIODS, periodStart } from '@/core/period';
export type JobPeriod = Period;

export type JobsQuery = { status: JobFilter; q: string; period: JobPeriod; job: string };

/** `?status=`, `?q=`, `?period=` and `?job=` from the URL; an unknown status or period falls back to the default. */
export function parseJobsQuery(params: Record<string, string | string[] | undefined>): JobsQuery {
  const status = first(params.status);
  return {
    status: (JOB_STATUSES as readonly string[]).includes(status) ? (status as JobFilter) : 'all',
    q: first(params.q).trim().slice(0, 100),
    period: parsePeriod(params.period),
    job: first(params.job).trim().slice(0, 100),
  };
}

/** `/admin/jobs` with only the parts that are not the default. */
export function jobsHref(query: Partial<JobsQuery>): string {
  const params = new URLSearchParams();
  if (query.status && query.status !== 'all') params.set('status', query.status);
  if (query.period && query.period !== '30d') params.set('period', query.period);
  if (query.q) params.set('q', query.q);
  if (query.job) params.set('job', query.job);
  const text = params.toString();
  return text ? `/admin/jobs?${text}` : '/admin/jobs';
}
