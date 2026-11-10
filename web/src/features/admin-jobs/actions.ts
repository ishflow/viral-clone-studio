'use server';

import { z } from 'zod';
import { requireAdmin } from '@/core/session/guards';
import { data } from '@/data';
import { settle, type ActionResult } from '../admin-common/types';
import { reasonSchema } from '../admin-users/schema';

const idSchema = z.string().trim().min(1).max(100);
const retrySchema = z.object({ jobId: idSchema, reason: reasonSchema });
const settleSchema = z.object({ jobId: idSchema, reason: reasonSchema });
const returnSchema = z.object({ jobId: idSchema, reason: reasonSchema, key: idSchema });

/**
 * Runs a stopped job again from the stopped step, with the reason; the customer is not charged. A job that is not stopped answers
 * "already done". No refresh here: the dialog shows its result and refreshes the page when it closes.
 */
export async function retryJob(input: { jobId: string; reason: string }): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = retrySchema.safeParse(input);
  if (!parsed.success) return { status: 'failed' };
  return settle(() => data.admin.retryStoppedJob(admin.id, parsed.data.jobId, parsed.data.reason), () => null);
}

/**
 * R3: the admin looked at the provider's task list and found no task for the request that stopped the job with `submission-unknown`:
 * the request is settled as "never reached the provider" (who and why are kept) and the job can be retried. Nothing settles by itself.
 */
export async function settleUnknown(input: { jobId: string; reason: string }): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = settleSchema.safeParse(input);
  if (!parsed.success) return { status: 'failed' };
  const settleOnData = data.admin.settleUnknownRequest;
  if (!settleOnData) return { status: 'failed' };
  return settle(() => settleOnData.call(data.admin, admin.id, parsed.data.jobId, parsed.data.reason), () => null);
}

/** "Return credits": what the job was charged and not returned goes back to the user's balance, once (the key and the data layer both hold it). */
export async function returnCredits(input: { jobId: string; reason: string; key: string }): Promise<ActionResult<{ credits: number; balanceAfter: number }>> {
  const admin = await requireAdmin();
  const parsed = returnSchema.safeParse(input);
  if (!parsed.success) return { status: 'failed' };
  const { jobId, reason, key } = parsed.data;
  return settle(() => data.admin.returnJobCredits(admin.id, jobId, reason, key), (entry) => ({ credits: entry.change, balanceAfter: entry.balanceAfter }));
}
