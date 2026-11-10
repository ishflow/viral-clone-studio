import type { JobStatus, PurchaseStatus } from '@/data/ports';
import type { StatusKind } from '@/shared/ui';

/** The look of a purchase status in every admin table. */
export const PURCHASE_KIND: Record<PurchaseStatus, StatusKind> = {
  paid: 'done', 'not-completed': 'stopped', 'refund-requested': 'waiting', 'refund-sent': 'waiting', refunded: 'waiting', 'refund-failed': 'stopped',
};
/** The look of a job status. */
export const JOB_KIND: Record<JobStatus, StatusKind> = { queued: 'queued', running: 'running', done: 'done', stopped: 'stopped', closed: 'closed' };
