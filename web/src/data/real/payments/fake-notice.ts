import { paymentConfig } from '@/core/payments/config';
import { paymentStore, paymentTransaction } from '../payments-store';
import { getStore, now } from '../../mock/store';
import { NotFoundError } from '../../ports';
import type { ProviderEvent } from '@/core/payments/state';
import { sign } from './signature';
import { paymentWebhook } from './webhook';
/** Offline provider simulator; caller must already authenticate the actor. Ownership is enforced again here. */
export async function fakeNotice(actorId:string,checkoutId:string,kind:ProviderEvent['kind']):Promise<void>{
  const config=paymentConfig(), user=getStore().users.find(u=>u.id===actorId);
  const c=getStore().checkouts.find(c=>c.id===checkoutId), r=paymentStore().records.find(r=>r.checkoutId===checkoutId);
  const refund=kind==='refunded'||kind==='refund-failed';
  // The simulator speaks for the fake provider only: outside fake mode, or on a checkout Dodo opened, it is refused before anything is written.
  if(config.mode!=='fake'||r?.provider)throw new Error('fake-payments-off');
  if(!user||user.blocked||!user.emailVerified||!c||!r||(refund?user.role!=='admin':c.userId!==actorId))throw new NotFoundError('checkout');
  if(refund&&!r.refundId)throw new Error('refund-not-sent');
  const event:ProviderEvent={eventId:crypto.randomUUID(),checkoutId,providerSessionId:r.sessionId,providerPaymentId:r.paymentId,kind,amountMinor:r.amountMinor,currency:'USD',occurredAt:now().toISOString(),...(refund?{providerRefundId:r.refundId}:{})};
  // Persist provider-side outcome first so reconciliation can recover a lost delivery.
  paymentTransaction(()=>{r.providerOccurredAt=event.occurredAt;if(refund)r.providerRefundStatus=kind as 'refunded'|'refund-failed';if(['pending','paid','declined','cancelled','expired'].includes(kind))r.providerStatus=kind as typeof r.providerStatus;});
  const raw=JSON.stringify(event), headers=new Headers({'webhook-id':event.eventId,'webhook-timestamp':String(Math.floor(Date.now()/1000))});
  headers.set('webhook-signature',sign(raw,headers,config.secret()));
  const response=await paymentWebhook(new Request(`${config.base}/api/payments/webhook`,{method:'POST',headers,body:raw}));
  if(!response.ok)throw new Error('fake-payment-delivery-failed');
}
