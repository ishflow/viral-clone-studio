// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { resetStore, getStore } from '../mock/store';
import { balanceOf, lotsOf, writeEntry } from '../mock/ledger';
import { paymentsGateway, receivePayment, sendRefund, sweepPayments } from './payments-gateway';
import { paymentStore, paymentTransaction } from './payments-store';
import type { ProviderEvent } from '@/core/payments/state';
let user:string;
beforeEach(()=>{ vi.unstubAllEnvs();vi.stubEnv('VC_PAYMENTS','fake');vi.stubEnv('VC_PAYMENTS_WEBHOOK_SECRET',randomBytes(32).toString('hex'));resetStore();user=getStore().users.find(u=>u.role==='customer')!.id; });
async function checkout(){return paymentsGateway.startCheckout(user,'pack-starter','/gallery','same-click');}
function event(id:string,kind:ProviderEvent['kind']='paid',eventId=crypto.randomUUID()):ProviderEvent {
 const r=paymentStore().records.find(r=>r.checkoutId===id)!;
 return {eventId,kind,checkoutId:id,providerSessionId:r.sessionId,providerPaymentId:r.paymentId,amountMinor:r.amountMinor,currency:'USD',occurredAt:new Date().toISOString()};
}
it('double click, webhook replay, state replay and return reload grant once and enqueue once',async()=>{
 const before=balanceOf(user), c=await checkout();expect(await checkout()).toEqual(c);
 expect((await paymentsGateway.getCheckout(c.checkoutId,user))?.status).toBe('pending');
 expect(await paymentsGateway.getCheckout(c.checkoutId,'other')).toBeNull();
 const e=event(c.checkoutId);receivePayment(e,'raw');receivePayment(e,'raw');receivePayment(event(c.checkoutId),'another');
 expect(balanceOf(user)).toBe(before+10);expect(paymentStore().deliveries).toHaveLength(1);
 expect((await paymentsGateway.getCheckout(c.checkoutId,user))?.status).toBe('paid');
 receivePayment(event(c.checkoutId,'declined'),'late');expect(balanceOf(user)).toBe(before+10);
});
it('rejects mismatched session and amount; late paid after expiry succeeds',async()=>{
 const c=await checkout(),before=balanceOf(user);expect(()=>receivePayment({...event(c.checkoutId),providerSessionId:'wrong'},'')).toThrow();
 receivePayment({...event(c.checkoutId),amountMinor:1},'');expect(balanceOf(user)).toBe(before);
 receivePayment(event(c.checkoutId,'expired'),'');receivePayment(event(c.checkoutId),'');expect(balanceOf(user)).toBe(before+10);
});
it('transaction rolls back credit, purchase, event and outbox together',async()=>{
 const c=await checkout(),before=structuredClone(getStore());
 expect(()=>paymentTransaction(()=>{receivePayment(event(c.checkoutId),'');throw new Error('crash');})).toThrow('crash');
 expect(getStore()).toEqual(before);
});
it('refund holds, removes only its lot, failed refund restores once, retry keys cannot duplicate',async()=>{
 const c=await checkout();receivePayment(event(c.checkoutId),'');
 const p=(await paymentsGateway.purchasesFor(user))[0]!;const before=balanceOf(user);
 await paymentsGateway.requestRefund(user,p.id);expect(balanceOf(user)).toBe(before-10);
 const admin=getStore().users.find(u=>u.role==='admin')!;
 await expect(sendRefund(user,p.id,'reason','key')).rejects.toThrow();
 await sendRefund(admin.id,p.id,'requested','first');expect(lotsOf(user).get(p.id)).toBe(0);
 const e={...event(c.checkoutId,'refund-failed'),providerRefundId:paymentStore().records[0]!.refundId};
 receivePayment(e,'');receivePayment({...e,eventId:crypto.randomUUID()},'');expect(balanceOf(user)).toBe(before);
 expect((await sendRefund(admin.id,p.id,'requested','first')).outcome).toBe('already-done');
 await sendRefund(admin.id,p.id,'retry','second');expect(lotsOf(user).get(p.id)).toBe(0);
 receivePayment({...event(c.checkoutId,'refunded'),providerRefundId:paymentStore().records[0]!.refundId},'');
 expect((await paymentsGateway.purchasesFor(user))[0]?.status).toBe('refunded');
});
it('a sent refund tells the customer once, with the pack, the amount and the credits taken out; a refused or repeated send tells nothing',async()=>{
 const c=await checkout();receivePayment(event(c.checkoutId),'');
 const p=(await paymentsGateway.purchasesFor(user))[0]!;await paymentsGateway.requestRefund(user,p.id);
 const admin=getStore().users.find(u=>u.role==='admin')!, owner=getStore().users.find(u=>u.id===user)!;
 const refundMails=()=>getStore().outbox.filter(m=>m.kind==='payment'&&m.data.refund==='sent');
 await expect(sendRefund(admin.id,p.id,'','k0')).rejects.toThrow();expect(refundMails()).toHaveLength(0);
 // The mail's own time is a second read of the clock. It stands still here: a millisecond passing between the two reads is not what this test is about.
 vi.useFakeTimers({toFake:['Date']});
 const sent=await sendRefund(admin.id,p.id,'requested','first').finally(()=>vi.useRealTimers());
 expect(refundMails()).toHaveLength(1);
 expect(refundMails()[0]).toMatchObject({to:owner.email,at:sent.at,data:{refund:'sent',purchaseId:p.id,packName:p.packName,credits:String(p.credits),amount:p.amount,date:sent.at}});
 expect((await sendRefund(admin.id,p.id,'requested','first')).outcome).toBe('already-done');await sendRefund(admin.id,p.id,'again','other-key');
 expect(refundMails()).toHaveLength(1);
 receivePayment({...event(c.checkoutId,'refund-failed'),providerRefundId:paymentStore().records[0]!.refundId},'');expect(refundMails()).toHaveLength(1);
 await sendRefund(admin.id,p.id,'retry','second');expect(refundMails()).toHaveLength(2);
});
it('lost webhook reconciles through same notify',async()=>{
 const c=await checkout();paymentStore().records[0]!.providerStatus='paid';await sweepPayments();
 expect((await paymentsGateway.getCheckout(c.checkoutId,user))?.status).toBe('paid');
});
it('a returned stopped-job charge restores the original refundable lot',async()=>{
 const c=await checkout();receivePayment(event(c.checkoutId),'');const p=(await paymentsGateway.purchasesFor(user))[0]!;
 writeEntry(user,'generation',-1,'job',{from:p.id});expect((await paymentsGateway.purchasesFor(user))[0]?.refundable).toEqual({ok:false,reason:'used'});
 writeEntry(user,'returned',1,'job',{backTo:[{lot:p.id,credits:1}]});expect((await paymentsGateway.purchasesFor(user))[0]?.refundable?.ok).toBe(true);
});
it('day 14 is eligible, day 15 is not; cancellation restores held credits without ledger churn',async()=>{
 const c=await checkout();receivePayment(event(c.checkoutId),'');const p=(await paymentsGateway.purchasesFor(user))[0]!;
 const paid=getStore().purchases.find(row=>row.id===p.id)!;const base=Date.now();
 paid.at=new Date(base-14*86400000).toISOString();vi.useFakeTimers();vi.setSystemTime(base);
 expect((await paymentsGateway.purchasesFor(user))[0]?.refundable?.ok).toBe(true);
 await paymentsGateway.requestRefund(user,p.id);await paymentsGateway.cancelRefund(user,p.id);
 vi.setSystemTime(base+86400000);expect((await paymentsGateway.purchasesFor(user))[0]?.refundable).toEqual({ok:false,reason:'too-old'});vi.useRealTimers();
});
it('reconcile repeat across clock changes is idempotent and dispute freeze cannot be customer-cancelled',async()=>{
 const c=await checkout();paymentStore().records[0]!.providerStatus='paid';await sweepPayments();
 vi.useFakeTimers();vi.setSystemTime(Date.now()+10000);await sweepPayments();vi.useRealTimers();
 expect(paymentStore().events).toHaveLength(1);
 receivePayment(event(c.checkoutId,'disputed'),'');const p=(await paymentsGateway.purchasesFor(user))[0]!;
 await expect(paymentsGateway.cancelRefund(user,p.id)).rejects.toThrow('dispute-needs-owner');
});
it('the browser action without a nonce reuses its unresolved owner-scoped checkout',async()=>{
 const first=await paymentsGateway.startCheckout(user,'pack-starter','/gallery');
 expect(await paymentsGateway.startCheckout(user,'pack-starter','/gallery')).toEqual(first);
 expect(paymentStore().records).toHaveLength(1);
 receivePayment(event(first.checkoutId,'cancelled'),'');
 expect((await paymentsGateway.startCheckout(user,'pack-starter','/gallery')).checkoutId).not.toBe(first.checkoutId);
});
it('a buyer cannot open checkouts without end: the 21st unpaid one of a day is refused and stores nothing; an open one asked again and another buyer are not refused',async()=>{
 const before=getStore().checkouts.length, first=await paymentsGateway.startCheckout(user,'pack-starter','/gallery?n=0');
 for(let i=1;i<20;i++)await paymentsGateway.startCheckout(user,'pack-starter',`/gallery?n=${i}`);
 await expect(paymentsGateway.startCheckout(user,'pack-starter','/gallery?n=20')).rejects.toThrow('too-many-checkouts');
 expect(getStore().checkouts).toHaveLength(before+20);expect(paymentStore().records).toHaveLength(20);
 expect(await paymentsGateway.startCheckout(user,'pack-starter','/gallery?n=0')).toEqual(first);
 const other=getStore().users.find(u=>u.role==='customer'&&u.id!==user&&!u.blocked)!.id;
 expect((await paymentsGateway.startCheckout(other,'pack-starter','/gallery')).checkoutId).toMatch(/^[0-9a-f-]{36}$/);
});
it('a checkout that ran out still counts for its day (it expires by itself after an hour), and a day after it was opened it does not',async()=>{
 vi.useFakeTimers({toFake:['Date']});
 try{
  vi.setSystemTime(new Date('2026-10-01T10:00:00Z'));
  for(let i=0;i<20;i++)await paymentsGateway.startCheckout(user,'pack-starter',`/gallery?n=${i}`);
  vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));await sweepPayments();
  expect(paymentStore().records.every(r=>r.status==='expired')).toBe(true);
  await expect(paymentsGateway.startCheckout(user,'pack-starter','/gallery?n=20')).rejects.toThrow('too-many-checkouts');
  vi.setSystemTime(new Date('2026-10-02T10:00:01Z'));
  expect((await paymentsGateway.startCheckout(user,'pack-starter','/gallery?n=20')).checkoutId).toMatch(/^[0-9a-f-]{36}$/);
 }finally{vi.useRealTimers();}
});
it('a buyer who pays is never counted: 25 paid checkouts in a day, and the next one opens',async()=>{
 for(let i=0;i<25;i++){const c=await paymentsGateway.startCheckout(user,'pack-starter',`/gallery?n=${i}`);receivePayment(event(c.checkoutId),'');}
 expect((await paymentsGateway.startCheckout(user,'pack-starter','/gallery')).checkoutId).toMatch(/^[0-9a-f-]{36}$/);
});
it('a payment of the offline fake has no tax, no second total and no provider invoice: the purchase, its invoice and the receipt mail hold exactly what they held before',async()=>{
 const c=await checkout();receivePayment(event(c.checkoutId),'');
 const p=getStore().purchases.find(p=>p.id===paymentStore().records.find(r=>r.checkoutId===c.checkoutId)!.purchaseId)!;
 expect(Object.keys(p).sort()).toEqual(['amount','amountCents','at','credits','id','invoiceId','packId','packName','refund','status','userId']);
 expect(Object.keys(getStore().invoices.find(i=>i.id===p.invoiceId)!).sort()).toEqual(['amount','credits','date','id','number','packName','purchaseId','userId']);
 expect(Object.keys(getStore().outbox.find(m=>m.data.purchaseId===p.id)!.data).sort()).toEqual(['amount','balance','credits','date','invoiceId','number','packName','purchaseId','returnTo']);
});
