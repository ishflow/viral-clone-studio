import { notFound, redirect } from 'next/navigation';
import { safeNext } from '@/core/session/session';
import { data } from '@/data';
import type { Checkout, Purchase, User } from '@/data/ports';
import { loadDraft, type Draft } from './draft';

/** The purchase named in the URL, if it belongs to the user; otherwise 404. */
export async function loadPurchase(user: User, purchaseId: string | undefined): Promise<Purchase> {
  const purchase = (await data.payments.purchasesFor(user.id)).find((p) => p.id === purchaseId);
  if (!purchase) notFound();
  return purchase;
}

/**
 * What a result page shows: the purchase, the balance of now, a safe way back and the video waiting behind it.
 * A paid purchase belongs to the success page, any other one to the failed page: the wrong page sends on to the right one.
 */
export async function loadResult(
  user: User, search: { purchase?: string; returnTo?: string }, page: 'success' | 'failed',
): Promise<{ purchase: Purchase; balance: number; returnTo: string; draft: Draft | null }> {
  const returnTo = safeNext(search.returnTo);
  const purchase = await loadPurchase(user, search.purchase);
  const right = purchase.status === 'paid' ? 'success' : 'failed';
  if (right !== page) redirect(`/checkout/${right}?purchase=${purchase.id}&returnTo=${encodeURIComponent(returnTo)}`);
  const [balance, draft] = await Promise.all([data.ledger.balance(user.id), loadDraft(user.id, returnTo)]);
  return { purchase, balance, returnTo, draft };
}

/** What the return route shows: the checkout of the URL (the owner's only), the balance of now, a safe way back and the video waiting behind it. */
export async function loadReturn(
  user: User, search: { checkout?: string; returnTo?: string },
): Promise<{ checkout: Checkout; balance: number; returnTo: string; draft: Draft | null }> {
  const returnTo = safeNext(search.returnTo);
  const checkout = typeof search.checkout === 'string' ? await data.payments.getCheckout(search.checkout, user.id) : null;
  if (!checkout) notFound();
  const [balance, draft] = await Promise.all([data.ledger.balance(user.id), loadDraft(user.id, returnTo)]);
  return { checkout, balance, returnTo, draft };
}
