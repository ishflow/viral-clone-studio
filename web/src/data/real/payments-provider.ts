import type { ProviderEvent } from '@/core/payments/state';
import type { PaymentRecord } from './payments-store';
/**
 * A provider call may cross the network. The gate writes its command durably first, calls, then writes the answer;
 * a call that never answers leaves the command unresolved, and it is not sent again.
 */
export interface PaymentProvider {
  createCheckout(input:{checkoutId:string;packId:string;email:string;returnUrl:string;cancelUrl:string}): Promise<{sessionId:string;url:string}>;
  refund(input:{paymentId:string;reason:string;checkoutId:string;idempotencyKey:string}): Promise<{refundId:string}>;
}
/** Offline adapter: it answers at once, and its outcome is whatever the fake provider page wrote on the record. */
export class FakeProvider implements PaymentProvider {
  page(checkoutId:string) { return `/checkout/mock/${checkoutId}`; }
  async createCheckout({checkoutId}:{checkoutId:string}) { return {sessionId:`fake:${checkoutId}`,url:this.page(checkoutId)}; }
  getPayment(record:PaymentRecord): ProviderEvent|null {
    if(record.providerStatus==='open' && !record.providerRefundStatus) return null;
    return {eventId:`reconcile:${record.sessionId}:${record.providerRefundStatus??record.providerStatus}:${record.refundId??''}`,kind:record.providerRefundStatus??record.providerStatus as Exclude<typeof record.providerStatus,'open'>,checkoutId:record.checkoutId,
      providerSessionId:record.sessionId,providerPaymentId:record.paymentId,amountMinor:record.amountMinor,currency:record.currency,occurredAt:record.providerOccurredAt??record.expiresAt,...(record.providerRefundStatus?{providerRefundId:record.refundId}:{})};
  }
  async refund({paymentId,idempotencyKey}:{paymentId:string;idempotencyKey:string}) { return {refundId:`fake-refund:${paymentId}:${idempotencyKey}`}; }
}
