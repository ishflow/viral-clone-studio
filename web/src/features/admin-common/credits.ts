import type { Job } from '@/data/ports';

/**
 * Is our video provider out of credits: the newest job stopped with `provider-credits` is newer than the newest job that finished
 * (a finished job proves a paid request went through since). Read from the jobs the admin pages already load.
 */
export function providerOutOfCredits(jobs: Pick<Job, 'status' | 'stoppedDetail' | 'stoppedAt' | 'finishedAt'>[]): boolean {
  const time = (iso: string | null) => (iso ? Date.parse(iso) : Number.NEGATIVE_INFINITY);
  const stopped = Math.max(Number.NEGATIVE_INFINITY, ...jobs.filter((job) => job.stoppedDetail === 'provider-credits').map((job) => time(job.stoppedAt)));
  const finished = Math.max(Number.NEGATIVE_INFINITY, ...jobs.filter((job) => job.status === 'done').map((job) => time(job.finishedAt)));
  return Number.isFinite(stopped) && stopped > finished;
}
