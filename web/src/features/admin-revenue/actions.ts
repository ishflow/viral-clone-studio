'use server';

import { z } from 'zod';
import { requireAdmin } from '@/core/session/guards';
import { data } from '@/data';
import { paymentPipelineEnabled } from '@/core/payments/config';
import { creditsLeft, refundRefusal, refundUnconfirmed } from '@/data/real/payments-gateway';
import { taxOf } from '@/shared/lib/format';
import { settle, type ActionResult } from '../admin-common/types';
import { reasonSchema } from '../admin-users/schema';

const refundSchema = z.object({ purchaseId: z.string().trim().min(1).max(100), reason: reasonSchema, key: z.string().trim().min(1).max(100) });

/**
 * Sends the refund of a purchase with an open request (or again after a failed one): the purchase becomes "Refund sent" and the credits
 * of its pack are removed. No refresh here: the dialog shows its result and refreshes the page when it closes.
 * `refused`: the provider said no; the purchase is "Refund failed" and its credits are back. `why` is `no-funds` when it said no because its balance cannot cover the refund.
 * `confirmed` is false when the provider's answer never came: the refund stays sent, and whether money goes back is not known yet.
 * `amount` is the money that goes back: the whole payment, so the total where the provider added tax to the pack price.
 * `closed`: no money was sent, because the whole payment went back at the provider already; the purchase is "Refunded" at once.
 */
export async function refundPurchase(input: { purchaseId: string; reason: string; key: string }): Promise<ActionResult<{ amount: string | null; credits: number; balanceAfter: number; confirmed: boolean; closed: boolean }>> {
  const admin = await requireAdmin();
  const parsed = refundSchema.safeParse(input);
  if (!parsed.success) return { status: 'failed' };
  const { purchaseId, reason, key } = parsed.data;
  // The payment provider refused the refund: no money went back and the credits are in the balance again. That is not "nothing was changed".
  let refused = false;
  // What the refund takes out is what is left of the pack now: afterwards nothing of it is left to count.
  const removed = creditsLeft(purchaseId);
  const result = await settle(
    () => data.admin.refundPurchase(admin.id, purchaseId, reason, key).catch((error: unknown) => {
      refused = error instanceof Error && error.message === 'refund-refused';
      throw error;
    }),
    async (purchase) => ({ amount: taxOf(purchase)?.total ?? purchase.amount, credits: removed, balanceAfter: await data.ledger.balance(purchase.userId), confirmed: !(paymentPipelineEnabled() && refundUnconfirmed(purchase.id)),
      closed: paymentPipelineEnabled() && purchase.status === 'refunded' }),
  );
  if (!refused) return result;
  const why = paymentPipelineEnabled() ? refundRefusal(purchaseId) : null;
  return why ? { status: 'refused', why } : { status: 'refused' };
}
