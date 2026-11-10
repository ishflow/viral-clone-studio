'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/core/session/guards';
import { requeueDelivery } from '@/data/real/payments-outbox';

/** "Send again" on the delivery page: a failed or blocked email goes back in the queue. Admin only; the next sweep sends it. */
export async function sendEmailAgain(emailId: string): Promise<{ status: 'queued' | 'unchanged' }> {
  await requireAdmin();
  const queued = requeueDelivery(String(emailId));
  revalidatePath('/admin/emails');
  return { status: queued ? 'queued' : 'unchanged' };
}
