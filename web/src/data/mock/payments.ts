import { NotFoundError, RULES } from '../ports';
import type { Checkout, CheckoutStatus, Id, PaymentGateway, Purchase } from '../ports';
import { JOB_COST, PACKS, SWAP_COST, money } from './demo-values';
import { invoiceNumber } from './invoices';
import { balanceOf, lotsOf, writeEntry } from './ledger';
import { keepEmail } from './mailer';
import { findUser, getStore, newestFirst, now } from './store';
import type { CheckoutRecord, PurchaseRecord } from './store';

const DAY_MS = 86_400_000;
/**
 * Unfinished checkouts one buyer can open in a day: opening one stores a record, so a loop must not be able to open them without end.
 * One left unfinished counts for a day only: nothing ever closes it, and a buyer who walked away now and then must still be able to buy.
 */
export const MAX_OPEN_CHECKOUTS = 20;
/** Purchases whose money is still with us: they count as sold, and their buyer as paying. */
export const SOLD: readonly Purchase['status'][] = ['paid', 'refund-requested', 'refund-failed'];

/**
 * Can this paid pack be refunded now (contract §1.5, §8.1): none of its credits used (its lot is whole: credits that came back from
 * a stopped job count as unused, K23), and bought less than `RULES.refundDays` ago.
 */
function refundableOf(purchase: PurchaseRecord): Purchase['refundable'] {
  if (purchase.status !== 'paid') return null;
  if ((lotsOf(purchase.userId).get(purchase.id) ?? 0) < purchase.credits) return { ok: false, reason: 'used' };
  const until = new Date(Date.parse(purchase.at) + RULES.refundDays * DAY_MS).toISOString();
  return Date.parse(until) >= now().getTime() ? { ok: true, until } : { ok: false, reason: 'too-old' };
}

/** The port's purchase: the record and whether it can be refunded now. */
export function toPurchase(purchase: PurchaseRecord): Purchase {
  return structuredClone({ ...purchase, refundable: refundableOf(purchase) });
}

function mustFindPurchase(id: Id, ownerId?: Id): PurchaseRecord {
  const purchase = getStore().purchases.find((item) => item.id === id && (ownerId === undefined || item.userId === ownerId));
  if (!purchase) throw new NotFoundError('purchase');
  return purchase;
}

function toCheckout(record: CheckoutRecord): Checkout | null {
  const pack = PACKS.find((item) => item.id === record.packId);
  if (!pack) return null;
  const purchase = getStore().purchases.find((item) => item.id === record.purchaseId);
  const status: CheckoutStatus = purchase ? (purchase.status === 'not-completed' ? 'declined' : 'paid') : record.state ?? 'open';
  const waited = record.pendingSince ? now().getTime() - Date.parse(record.pendingSince) : 0;
  return {
    id: record.id, userId: record.userId, pack: { ...pack }, returnTo: record.returnTo, status, purchaseId: record.purchaseId,
    startedAt: record.startedAt, reference: record.reference, delayed: status === 'pending' && waited > RULES.checkoutWaitSeconds * 1000,
  };
}

function mustFindCheckout(id: Id): CheckoutRecord {
  const checkout = getStore().checkouts.find((item) => item.id === id);
  if (!checkout) throw new NotFoundError('checkout');
  return checkout;
}

export const payments: PaymentGateway = {
  async packs() {
    return PACKS.map((pack) => ({ ...pack }));
  },

  /** `swap`: the rates `SwapRunner.estimate` charges by (`SWAP_COST`), only while person swap is switched on: off, the site sells none and shows none. */
  async rates() {
    const swapOn = getStore().limits.personSwap === true;
    return { perVideo: structuredClone(JOB_COST), ownTemplate: RULES.ownTemplateCredits, ...(swapOn && { swap: { ...SWAP_COST } }) };
  },

  /** Spends nothing. The address is the mock provider page; it carries `returnTo`, the way back into the site. */
  async startCheckout(userId, packId, returnTo) {
    if (!findUser(userId)) throw new NotFoundError('user');
    if (!PACKS.some((pack) => pack.id === packId)) throw new NotFoundError('pack');
    const since = now().getTime() - DAY_MS;
    const open = getStore().checkouts.filter((item) => item.userId === userId && item.purchaseId === null && item.state === null && Date.parse(item.startedAt) > since);
    if (open.length >= MAX_OPEN_CHECKOUTS) throw new Error('too-many-checkouts');
    const checkoutId = crypto.randomUUID();
    getStore().checkouts.push({
      id: checkoutId, userId, packId, returnTo, purchaseId: null, state: null, startedAt: now().toISOString(), pendingSince: null,
      reference: `PAY-${checkoutId.slice(0, 8).toUpperCase()}`,
    });
    return { checkoutId, url: `/checkout/mock/${checkoutId}?returnTo=${encodeURIComponent(returnTo)}` };
  },

  /** Only the user who started the checkout can read it. Anyone else, an admin too, gets null. */
  async getCheckout(checkoutId, viewerId) {
    const record = getStore().checkouts.find((item) => item.id === checkoutId && item.userId === viewerId);
    return record ? toCheckout(record) : null;
  },

  /**
   * The first outcome of a checkout stays: every later call returns the same purchase and changes nothing.
   * A checkout that was cancelled or expired has no purchase: Error('checkout-closed').
   */
  async complete(checkoutId, outcome) {
    const store = getStore();
    const checkout = mustFindCheckout(checkoutId);
    const settled = store.purchases.find((purchase) => purchase.id === checkout.purchaseId);
    if (settled) return toPurchase(settled);
    if (checkout.state === 'cancelled' || checkout.state === 'expired') throw new Error('checkout-closed');

    const user = findUser(checkout.userId);
    if (!user) throw new NotFoundError('user');
    const pack = PACKS.find((item) => item.id === checkout.packId);
    if (!pack) throw new NotFoundError('pack');

    const at = now().toISOString();
    const invoiceId = outcome === 'paid' ? crypto.randomUUID() : null;
    const amount = pack.priceCents === null ? null : money(pack.priceCents);
    const purchase: PurchaseRecord = {
      id: crypto.randomUUID(), userId: user.id, packId: pack.id, packName: pack.name, credits: pack.credits, amount, amountCents: pack.priceCents,
      at, status: invoiceId ? 'paid' : 'not-completed', invoiceId, refund: null,
    };
    store.purchases.push(purchase);
    if (invoiceId) {
      writeEntry(user.id, 'purchase', pack.credits, pack.name, { purchaseId: purchase.id });
      store.invoices.push({
        id: invoiceId, number: invoiceNumber(store.invoices.length + 1), userId: user.id, purchaseId: purchase.id,
        date: at, packName: pack.name, credits: pack.credits, amount,
      });
      keepEmail('payment', user.email, {
        purchaseId: purchase.id, invoiceId, packName: pack.name, credits: String(pack.credits), balance: String(balanceOf(user.id)),
        returnTo: checkout.returnTo,
      });
    }
    checkout.purchaseId = purchase.id;
    checkout.state = null;
    return toPurchase(purchase);
  },

  async notify(checkoutId, event) {
    if (event === 'paid' || event === 'declined') {
      await payments.complete(checkoutId, event);
      return toCheckout(mustFindCheckout(checkoutId))!;
    }
    const checkout = mustFindCheckout(checkoutId);
    const final = checkout.purchaseId !== null || checkout.state === 'cancelled' || checkout.state === 'expired';
    if (!final && event === 'pending' && checkout.state === null) {
      checkout.state = 'pending';
      checkout.pendingSince = now().toISOString();
    }
    if (!final && event !== 'pending') checkout.state = event;
    const answer = toCheckout(checkout);
    if (!answer) throw new NotFoundError('pack');
    return answer;
  },

  /** Newest first. */
  async purchasesFor(userId) {
    const own = getStore().purchases.filter((purchase) => purchase.userId === userId);
    return newestFirst(own, (purchase) => purchase.at).map(toPurchase);
  },

  async requestRefund(userId, purchaseId) {
    const purchase = mustFindPurchase(purchaseId, userId);
    if (purchase.status === 'refund-requested') return toPurchase(purchase);
    if (!refundableOf(purchase)?.ok) throw new Error('not-refundable');
    purchase.status = 'refund-requested';
    purchase.refund = { requestedAt: now().toISOString(), sentAt: null, settledAt: null, by: { kind: 'customer' } };
    return toPurchase(purchase);
  },

  async cancelRefund(userId, purchaseId) {
    const purchase = mustFindPurchase(purchaseId, userId);
    if (purchase.status !== 'refund-requested') return toPurchase(purchase);
    purchase.status = 'paid';
    purchase.refund = null;
    return toPurchase(purchase);
  },

  /** A failed refund gives the pack's credits back (`returned`, into the pack). An answer for a refund that is not sent changes nothing. */
  async refundSettled(purchaseId, outcome) {
    const purchase = mustFindPurchase(purchaseId);
    if (purchase.status !== 'refund-sent' || !purchase.refund) return toPurchase(purchase);
    purchase.refund.settledAt = now().toISOString();
    purchase.status = outcome === 'refunded' ? 'refunded' : 'refund-failed';
    if (outcome === 'failed') {
      writeEntry(purchase.userId, 'returned', purchase.credits, purchase.packName, {
        purchaseId: purchase.id, backTo: [{ lot: purchase.id, credits: purchase.credits }],
      });
    }
    return toPurchase(purchase);
  },
};
