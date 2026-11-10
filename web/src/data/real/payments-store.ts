import type { CheckoutStatus } from '../ports';
import type { PriceRefusal, ProviderEvent } from '@/core/payments/state';
import { getStore } from '../mock/store';
import { persistent, saveStore } from '../mock/persist';
export interface PaymentRecord {
  checkoutId: string; sessionId: string; paymentId: string; amountMinor:number; currency:string;
  status:CheckoutStatus; providerStatus:CheckoutStatus; providerOccurredAt?:string; expiresAt:string; key:string; purchaseId:string|null;
  refundId?:string; refundAttempt?:number; refundKeys?:string[]; providerRefundStatus?:'refunded'|'refund-failed'; flag?:string;
  /**
   * Why the last payment Dodo reported for this checkout was not credited; gone once one is. `binding`: the server's own read found a payment
   * that is not tied to this checkout. `gave-up`: Dodo could not be asked for days after the session ran out, so whether it was paid is not known.
   */
  refusal?:PriceRefusal|'no-account'|'binding'|'gave-up';
  /**
   * Absent: opened by the offline fake. A Dodo checkout has `sessionId` '' until Dodo answered the opening call (for good, when it never
   * answered) and `paymentId` '' until a verified notice or the server's own read names the payment.
   */
  provider?:'dodo'; checkoutUrl?:string;
  /** Refund ids of earlier attempts: their late notices settle nothing. `refundId` is undefined while a sent refund's id is not known. */
  pastRefundIds?:string[];
  /**
   * Of a sent refund that has no id. `exists`: Dodo answered the call with "this payment has a refund already". `conflict`: its list of that
   * payment's refunds then showed none that went through, so one of the two answers is wrong and nothing is given back on either.
   * `not-found`, of a failed one: Dodo listed no refund that could still pay out, so the credits came back.
   * `no-funds`, of a failed one: Dodo refused the call because its wallet could not cover the refund. Gone with the next attempt.
   */
  refundNote?:'exists'|'conflict'|'not-found'|'no-funds';
  /** A whole refund Dodo made that no refund of ours accounts for (made in its panel): the pack's credits stay held while it stands. */
  outsideRefundId?:string;
  /**
   * The refunds Dodo made that are not ours, each once with its amount: what went back so far. While they do not add up to all that was paid, nothing is frozen and the owner decides.
   * `amountMinor` is null while Dodo has not said how much the refund gave back: it counts for nothing, and the owner is told that it is not known.
   */
  outsideRefunds?:{id:string;amountMinor:number|null}[];
  /**
   * The disputes of this payment, each by its last known stage: when that stage happened, and whether it ended the dispute in our favour.
   * `id` is '' for a dispute nobody named. Dodo promises no order, and one payment may be disputed more than once.
   */
  disputes?:{id:string;at:string;won:boolean}[];
  /** What the purchase was when a dispute or an outside refund froze it: a freeze that ends gives exactly that back. */
  frozenFrom?:'paid'|'refund-failed';
  /**
   * Of a credited Dodo payment: when Dodo was last asked what went back of it (first, when it was credited). The sweep looks at the longest
   * unlooked first, also after a restart. Written whether Dodo answered or not: one that fails is asked again in its turn, not at once.
   */
  refundsReadAt?:string;
}
export interface Delivery { emailId:string; status:'queued'|'sent'|'failed'|'blocked-by-allowlist'; attempts:number; nextTryAt:number; providerId?:string }
export interface PaymentsState { records:PaymentRecord[]; events:{event:ProviderEvent;raw:string;processedAt:string}[]; deliveries:Delivery[]; attention:string[]; invoiceCounter:number;
  /**
   * Verified provider notices that changed nothing: a type we do not act on, or one refused by rule. The type and our reason only, never the body.
   * A refund or dispute of a payment that is not stored also keeps that payment's id, the refund's, its amount with the currency that is counted in, and whether Dodo called it a part: it applies if the payment is credited later.
   * A note of before keeps an amount without a currency: how much of the payment that was is not known.
   * A dispute's note keeps the dispute's own id and when its stage happened too.
   */
  unhandled?:{eventId:string;type:string;reason:string;receivedAt:string;paymentId?:string;refundId?:string;partial?:true;amountMinor?:number;currency?:string;disputeId?:string;occurredAt?:string}[] }
export function paymentStore(): PaymentsState {
  return getStore().paymentsState ??= {records:[],events:[],deliveries:[],attention:[],invoiceCounter:0};
}
/** Synchronous callbacks only: no interleaving and no side effects outside the snapshot before durable commit. */
let transactionDepth=0;
export function paymentTransaction<T>(work:()=>T): T {
  const store=getStore(), before=structuredClone(store);
  transactionDepth++;
  try {
    const result=work();
    if (result instanceof Promise) throw new Error('async-payment-transaction');
    if (persistent() && transactionDepth===1) saveStore(store);
    return result;
  } catch(error) {
    Object.assign(store,before);
    if (!before.paymentsState) store.paymentsState=undefined;
    throw error;
  } finally { transactionDepth--; }
}
