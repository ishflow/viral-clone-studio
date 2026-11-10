import type { JobRecord } from '../mock/store';
import { getStore, now } from '../mock/store';
import { RULES } from '../ports';

const DAY = 86_400_000;
/** Same calendar-month deadline as the job view; invalid persisted dates fail closed. */
export function jobMediaKept(job: JobRecord): boolean {
  if (job.deletedAt || job.closedAt || job.status === 'closed') return false;
  if (!getStore().users.some(user => user.id === job.userId)) return false;
  if (job.status === 'stopped') return job.stoppedAt !== null && Date.parse(job.stoppedAt) + RULES.stoppedKeptDays * DAY > now().getTime();
  if (job.finishedAt === null) return true; // an unfinished run may have delivered an individual variant
  const expires = new Date(job.finishedAt);
  expires.setUTCMonth(expires.getUTCMonth() + RULES.videosKeptMonths);
  return expires.getTime() > now().getTime();
}
/**
 * Does `/media` still serve the videos of this job: a person swap's for `RULES.swapVideosKeptDays` only (as the job view says).
 * Its files are deleted then (`swapVideoDue`), never moved aside: the retirement asks `jobMediaKept`, which does not know this deadline.
 */
export function jobVideoServed(job: JobRecord): boolean {
  if (!jobMediaKept(job)) return false;
  return !job.swap || job.finishedAt === null || Date.parse(job.finishedAt) + RULES.swapVideosKeptDays * DAY > now().getTime();
}
export function jobImagesKept(job: JobRecord): boolean {
  if (!jobMediaKept(job)) return false;
  const ended = job.finishedAt ?? job.stoppedAt;
  return ended === null || Date.parse(ended) + RULES.imagesKeptDays * DAY > now().getTime();
}
