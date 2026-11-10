'use server';

import { z } from 'zod';
import { requireAdmin } from '@/core/session/guards';
import { data } from '@/data';
import { refuseForbidden } from '../admin-common/forbidden';
import type { ActionResult } from '../admin-common/types';

const answerSchema = z.object({ jobId: z.string().trim().min(1).max(100), verdict: z.enum(['approved', 'rejected']) });

/**
 * The admin's answer to the photographs of a person-swap job that waits. What the data layer says is passed on as it is: `done`, or
 * `already` when the job waits no longer (another admin answered, its owner gave up, its time ran out), in which case nothing changed.
 * Who may answer is the data layer's to say: its no is the 403 page. No refresh here: the page refreshes its line itself.
 */
export async function answerSwap(input: { jobId: string; verdict: 'approved' | 'rejected' }): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = answerSchema.safeParse(input);
  if (!parsed.success) return { status: 'failed' };
  try {
    const result = await data.admin.reviewSwap(admin.id, parsed.data.jobId, parsed.data.verdict);
    return result.outcome === 'already-done' ? { status: 'already', at: result.at } : { status: 'done', at: result.at, detail: null };
  } catch (error) {
    refuseForbidden(error);
    return { status: 'failed' };
  }
}
