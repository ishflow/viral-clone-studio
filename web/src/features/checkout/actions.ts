'use server';

import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/core/session/guards';
import { refreshShell } from '@/core/session/refresh';
import { safeNext } from '@/core/session/session';
import { data } from '@/data';
import { NotFoundError } from '@/data/ports';
import { paymentPipelineEnabled } from '@/core/payments/config';
import { isPaidMode, ownerTestConfig } from '@/core/paid-mode';

/** No real path of this site is longer; a longer one is dropped (it would be stored with the checkout). */
const MAX_RETURN_TO = 2000;

/**
 * "Buy" on the pricing page and "Try again" after a payment that was not completed: opens a checkout and sends the buyer to the
 * (fake) provider page. A form action, so a POST: loading or prefetching an address never opens a checkout.
 * Both arguments come from the browser. An unknown pack goes back to pricing; a `returnTo` that is not a path of this site is dropped.
 */
export async function startCheckout(packId: string, returnTo?: string): Promise<void> {
  const back = typeof returnTo === 'string' && returnTo.length <= MAX_RETURN_TO && safeNext(returnTo) === returnTo ? returnTo : undefined;
  const user = await requireUser(back ? `/pricing?returnTo=${encodeURIComponent(back)}` : '/pricing');
  let provider: string;
  try {
    provider = (await data.payments.startCheckout(user.id, typeof packId === 'string' ? packId : '', safeNext(back))).url;
  } catch (error) {
    if (error instanceof Error && error.message === 'too-many-checkouts') redirect('/pricing?notice=too-many-checkouts');
    // The provider did not open its payment page (it failed, or never answered): nothing was charged, and the buyer is told so on the pricing page.
    if (error instanceof Error && (error.message === 'payment-provider-unavailable' || error.message === 'checkout-not-opened'))
      redirect(`/pricing?notice=payment-unavailable${back ? `&returnTo=${encodeURIComponent(back)}` : ''}`);
    if (error instanceof NotFoundError) redirect('/pricing');
    throw error;
  }
  redirect(provider);
}

const SETTLE_OUTCOMES = ['paid', 'declined', 'pending', 'cancelled', 'expired'] as const;
type SettleOutcome = (typeof SETTLE_OUTCOMES)[number];

/**
 * The fake provider page's buttons: Pay, Decline, Pending, Cancel, Expire. Only the owner can settle a checkout; the first final outcome stays.
 * Every outcome ends on the one return route, which shows the page that fits the stored checkout.
 * Paid mode: there is no fake provider, so nothing is settled here and `data.payments.complete` is not called (the answer is the pricing page).
 */
export async function settleCheckout(form: FormData): Promise<void> {
  if (isPaidMode() && !ownerTestConfig(process.env)) redirect('/pricing');
  const checkoutId = String(form.get('checkoutId') ?? '');
  const user = await requireUser(safeNext(`/checkout/mock/${encodeURIComponent(checkoutId)}`));
  const checkout = await data.payments.getCheckout(checkoutId, user.id);
  if (!checkout) notFound();
  const asked = String(form.get('outcome') ?? '');
  const outcome: SettleOutcome = (SETTLE_OUTCOMES as readonly string[]).includes(asked) ? (asked as SettleOutcome) : 'declined';
  try {
    if (paymentPipelineEnabled()) {
      const { fakeNotice } = await import('@/data/real/payments/fake-notice');
      await fakeNotice(user.id, checkout.id, outcome);
    } else if (outcome === 'paid' || outcome === 'declined') await data.payments.complete(checkout.id, outcome);
    else await data.payments.notify(checkout.id, outcome);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    // `checkout-closed`: a cancelled or expired checkout takes no payment any more. The return page shows what stands.
    if (!(error instanceof Error && error.message === 'checkout-closed')) throw error;
  }
  refreshShell();
  redirect(`/checkout/return?checkout=${encodeURIComponent(checkout.id)}&returnTo=${encodeURIComponent(safeNext(checkout.returnTo))}`);
}

/** Check again is a POST and only recovers the signed-in owner's checkout. */
export async function checkPayment(form: FormData): Promise<void> {
  const user = await requireUser();
  const checkoutId = String(form.get('checkoutId') ?? '');
  const checkout = await data.payments.getCheckout(checkoutId, user.id);
  if (!checkout) notFound();
  if (paymentPipelineEnabled()) {
    const { reconcilePayment } = await import('@/data/real/payments-gateway');
    await reconcilePayment(checkoutId, user.id);
  }
  refreshShell();
  redirect(`/checkout/return?checkout=${encodeURIComponent(checkoutId)}&returnTo=${encodeURIComponent(safeNext(checkout.returnTo))}`);
}
