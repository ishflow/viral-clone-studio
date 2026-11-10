import type { CheckoutStatus, PurchaseStatus } from '@/data/ports';
export type PaymentKind = Exclude<CheckoutStatus, 'open'>;
export interface ProviderEvent {
  eventId: string; checkoutId: string; providerSessionId: string; providerPaymentId: string;
  providerRefundId?: string; providerDisputeId?: string; kind: PaymentKind | 'refunded' | 'refund-failed' | 'disputed' | 'dispute-won';
  amountMinor: number; currency: string; occurredAt: string;
}
export function applyEvent(checkout: {status: CheckoutStatus; amountMinor: number; currency: string}, event: {kind: PaymentKind; amountMinor: number; currency: string}) {
  const mismatch = event.kind === 'paid' && (event.amountMinor !== checkout.amountMinor || event.currency !== checkout.currency);
  if (mismatch) return {status:checkout.status,grant:false,mismatch:true};
  if (checkout.status === 'paid' || checkout.status === event.kind) return {status:checkout.status,grant:false,mismatch:false};
  if (event.kind === 'paid') return {status:'paid' as const,grant:true,mismatch:false};
  const status = checkout.status === 'open' || checkout.status === 'pending' ? event.kind : checkout.status;
  return {status,grant:false,mismatch:false};
}
export function refundTransition(status: PurchaseStatus, kind: 'refunded'|'refund-failed'): PurchaseStatus {
  return status === 'refund-sent' ? kind : status;
}
/** What a real provider itself reported about a paid payment, beyond the event. `taxMinor` is null when it reported no tax at all; `invoiceUrl` is the address of its own invoice, when it gave one. */
export interface PaidFacts { taxMinor: number | null; cart: {productId: string; quantity: number}[]; invoiceUrl?: string | null }
export type PriceRefusal = 'facts-missing' | 'currency' | 'tax-unknown' | 'cart' | 'amount';
/**
 * The price rule of a real payment, checked before a credit is written: the pack's currency, a tax the provider reported, a cart of
 * exactly one of the pack's own product, and an amount before tax equal to the pack price. Null when the payment may be credited.
 */
export function priceRefusal(pack: {amountMinor: number; currency: string; productId: string}, paid: {amountMinor: number; currency: string}, facts: PaidFacts | undefined): PriceRefusal | null {
  if (!facts) return 'facts-missing';
  if (paid.currency !== pack.currency) return 'currency';
  if (facts.taxMinor === null) return 'tax-unknown';
  if (facts.cart.length !== 1 || facts.cart[0]!.productId !== pack.productId || facts.cart[0]!.quantity !== 1) return 'cart';
  return paid.amountMinor === pack.amountMinor ? null : 'amount';
}
