import type { Job } from '@/data/ports';

/**
 * Does the job wait in a line: held by the site until a slot is free (`queued`), or handed to the engine, which has not begun it
 * (`running` with its `engineQueue`)? Both are the same "In queue" to the customer.
 */
export const waitsInLine = (job: Job): boolean => job.status === 'queued' || (job.status === 'running' && Boolean(job.engineQueue));
