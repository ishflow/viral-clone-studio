import { redirect } from 'next/navigation';
import { requireUser } from '@/core/session/guards';
import { data } from '@/data';
import { paymentPipelineEnabled } from '@/core/payments/config';
import { ConfirmingView, DelayedView, PollRefresh, StoppedCheckoutView, loadReturn } from '@/features/checkout';
import { pageTitle } from '@/core/i18n/page-title';

type Search = { checkout?: string; c?: string; left?: string; returnTo?: string };

export const generateMetadata = () => pageTitle('checkout');

/**
 * The one address the payment provider (or the fake page) sends the buyer back to: `?checkout=<id>&returnTo=`. The page follows the stored
 * checkout, never the address: paid and declined go on to their result pages, the rest are drawn here.
 * With the payment pipeline the server first asks the provider itself about the signed-in buyer's own checkout, so the page does not wait
 * for a webhook. Whatever else the provider adds to the address (`payment_id`, `status`, `email`) is never read: it can neither write a
 * credit nor show anything. Reloading is safe: a payment is credited once, and the provider is asked at most once every few seconds.
 */
export default async function CheckoutReturnPage({ searchParams }: { searchParams: Promise<Search> }) {
  const input = await searchParams;
  const search = { ...input, checkout: input.checkout ?? input.c };
  const user = await requireUser(`/checkout/return?checkout=${encodeURIComponent(search.checkout ?? '')}`);
  let unpaid = false;
  if (paymentPipelineEnabled() && typeof search.checkout === 'string' && (await data.payments.getCheckout(search.checkout, user.id))) {
    const { reconcilePayment } = await import('@/data/real/payments-gateway');
    unpaid = (await reconcilePayment(search.checkout, user.id)) === 'unpaid';
  }
  const { checkout, returnTo, draft } = await loadReturn(user, search);
  const back = encodeURIComponent(returnTo);
  // The provider itself says nobody paid this checkout (the buyer came back without paying). It can still be paid until it runs out, so the page keeps looking.
  if (unpaid && (checkout.status === 'pending' || checkout.status === 'open')) return <><PollRefresh /><StoppedCheckoutView status="cancelled" returnTo={returnTo} draft={draft} /></>;
  if (input.left === '1' && checkout.status !== 'paid') return <StoppedCheckoutView status="cancelled" returnTo={returnTo} draft={draft} />;
  switch (checkout.status) {
    case 'paid':
      return redirect(`/checkout/success?purchase=${checkout.purchaseId}&returnTo=${back}`);
    case 'declined':
      return redirect(`/checkout/failed?purchase=${checkout.purchaseId}&returnTo=${back}`);
    case 'cancelled':
    case 'expired':
      return <StoppedCheckoutView status={checkout.status} returnTo={returnTo} draft={draft} />;
    case 'pending':
      if (checkout.delayed) return <DelayedView checkout={checkout} returnTo={returnTo} draft={draft} />;
      return <ConfirmingView checkout={checkout} returnTo={returnTo} draft={draft} />;
    default: // open follows the same server clock as pending
      if (checkout.delayed) return <DelayedView checkout={checkout} returnTo={returnTo} draft={draft} />;
      return <ConfirmingView checkout={checkout} returnTo={returnTo} draft={draft} />;
  }
}
