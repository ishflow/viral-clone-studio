import { z } from 'zod';
import { applyEvent, priceRefusal, refundTransition } from '@/core/payments/state';
import type { ProviderEvent, PaymentKind, PaidFacts } from '@/core/payments/state';
import { paymentConfig } from '@/core/payments/config';
import { dodoAddress } from '@/core/payments/dodo-address';
import type { PaymentConfig } from '@/core/payments/config';
import type { Checkout, PaymentGateway, Purchase, AdminResult } from '../ports';
import { NotFoundError, RULES } from '../ports';
import { MAX_OPEN_CHECKOUTS, payments, toPurchase } from '../mock/payments';
import { findUser, getStore, now } from '../mock/store';
import type { PurchaseRecord } from '../mock/store';
import { PACKS, money } from '../mock/demo-values';
import { balanceOf, lotsOf, writeEntry } from '../mock/ledger';
import { keepEmail } from '../mock/mailer';
import { invoiceNumber } from '../mock/invoices';
import { paymentStore, paymentTransaction } from './payments-store';
import type { PaymentRecord } from './payments-store';
import { FakeProvider } from './payments-provider';
import type { PaymentProvider } from './payments-provider';
import { DodoError, DodoProvider, NO_WALLET_FUNDS } from './payments/dodo-provider';
import { receiveDodoWebhook } from './payments/dodo-events';
import type { DodoAbout, DodoSession } from './payments/dodo-events';
import type { DodoPayment } from './payments/dodo-provider';
import type { EmailTransport } from './payments-outbox';
import { drainOutbox } from './payments-outbox';
const fake=new FakeProvider();
/** A Dodo adapter is made per use: it holds nothing but the settings of that moment. */
const providerOf=(config:PaymentConfig):PaymentProvider=>config.mode==='test'?new DodoProvider(config.dodo):fake;
/** A checkout belongs to the provider that opened it: the other mode can neither pay, reuse nor refund it. */
const mine=(r:PaymentRecord,config:PaymentConfig)=>(r.provider==='dodo')===(config.mode==='test');
/** Refused by rule, not by a failure: nothing was written, and the same notice sent again would be refused again. */
export class PaymentRefusal extends Error {}
/** The marks that freeze a pack, the heavier the higher: a record shows one mark, and a lesser one never takes the place of these. */
const WEIGHT:Partial<Record<string,number>>={disputed:2,'refund-review':1};
/** For the owner to look at. */
function review(r:PaymentRecord,flag:string,marker:string):void {
  if((WEIGHT[flag]??0)>=(WEIGHT[r.flag??'']??0))r.flag=flag;
  if(!paymentStore().attention.includes(marker))paymentStore().attention.push(marker);
}
/** Checkouts whose opening call is on its way in this process: the same click asked again waits for the same answer. */
const opening=new Map<string,Promise<{checkoutId:string;url:string}>>();
const id=z.string().min(1).max(200);
export const eventSchema=z.object({eventId:id,checkoutId:id,providerSessionId:id,providerPaymentId:id,providerRefundId:z.string().min(1).max(500).optional(),providerDisputeId:id.optional(),
  kind:z.enum(['pending','paid','declined','cancelled','expired','refunded','refund-failed','disputed','dispute-won']),amountMinor:z.number().int().nonnegative().safe(),currency:z.literal('USD'),occurredAt:z.iso.datetime()}).strict();
/** What the gate itself takes: any currency (a wrong one is marked, not thrown), and no ids on our own expiry of a checkout nobody opened or paid. */
const gateSchema=eventSchema.extend({providerSessionId:z.string().max(200),providerPaymentId:z.string().max(200),currency:z.string().regex(/^[A-Z]{3}$/)});
function recordOf(checkoutId:string) {const r=paymentStore().records.find(r=>r.checkoutId===checkoutId);if(!r)throw new NotFoundError('checkout');return r;}
function checkoutOf(r:PaymentRecord):Checkout {
  const c=getStore().checkouts.find(c=>c.id===r.checkoutId)!;
  const pack=PACKS.find(p=>p.id===c.packId)!;
  return {id:c.id,userId:c.userId,pack:{...pack},returnTo:c.returnTo,status:r.status,purchaseId:r.purchaseId,startedAt:c.startedAt,reference:r.paymentId||null,
    delayed:(r.status==='open'||r.status==='pending')&&now().getTime()-Date.parse(c.startedAt)>RULES.checkoutWaitSeconds*1000};
}
function eventOf(r:PaymentRecord,kind:PaymentKind):ProviderEvent {return {eventId:crypto.randomUUID(),checkoutId:r.checkoutId,providerSessionId:r.sessionId,providerPaymentId:r.paymentId,kind,amountMinor:r.amountMinor,currency:r.currency,occurredAt:now().toISOString()};}
/** A dispute, or a whole refund at Dodo that no refund of ours accounts for: while it stands none of the pack's credits may be spent, whatever becomes of our own refund. */
const frozen=(r:PaymentRecord)=>r.flag==='disputed'||r.outsideRefundId!==undefined;
/** Holds what is left of a pack whose money is with us, through the held-lot contract of a refund request. */
function freeze(r:PaymentRecord,p:PurchaseRecord|undefined):void {if(p&&(p.status==='paid'||p.status==='refund-failed')){r.frozenFrom=p.status;p.status='refund-requested';}}
/** Once nothing freezes the pack any more it is what it was before; a request of the customer's own was never a freeze and stays. */
function thaw(r:PaymentRecord,p:PurchaseRecord|undefined):void {
  if(frozen(r))return;
  if(p&&r.frozenFrom&&p.status==='refund-requested')p.status=r.frozenFrom;
  delete r.frozenFrom;
}
/** All the buyer paid at Dodo: the pack price and the tax Dodo added to it. A refund is the whole one only when it gives back this much. */
const paidTotal=(r:PaymentRecord,p:PurchaseRecord|undefined)=>p?.totalCents??r.amountMinor;
/** A refund that went through at Dodo, and its amount where one is known. */
interface MoneyBack { id:string; amountMinor?:number }
/** What is known to have gone back in refunds that are not ours, without the one named: a refund whose amount is not known counts for nothing. */
const outsideSum=(r:PaymentRecord,but?:string)=>(r.outsideRefunds??[]).reduce((sum,f)=>f.id===but?sum:sum+(f.amountMinor??0),0);
/** Money that moved at Dodo and that no refund of ours accounts for (made in the Dodo panel): nothing is settled, the owner must look. `back` is null when none went back for good. */
function outsideRefund(r:PaymentRecord,p:PurchaseRecord|undefined,back:MoneyBack|null):void {
  // Old news: a refund that was counted before the pack was closed ("refunded"), told again by a notice that comes late. Nothing is left to look at.
  if(back&&p?.status==='refunded'&&r.outsideRefunds?.some(f=>f.id===back.id))return;
  review(r,'refund-review',`refund-review:${r.checkoutId}`);
  if(!back)return;
  // Each refund is kept once. One whose amount is not known is kept without it, and gets it when Dodo names it.
  const known=r.outsideRefunds??=[], told=known.find(f=>f.id===back.id);
  if(!told)known.push({id:back.id,amountMinor:back.amountMinor??null});
  else if(told.amountMinor===null&&back.amountMinor!==undefined)told.amountMinor=back.amountMinor;
  // The amounts decide, whatever Dodo calls the refund: one that gives back all that was paid, alone or with the parts before it, is the whole payment.
  // Less than that is a part, and so is a refund of unknown amount: it freezes nothing and takes no credit; the owner decides.
  if(back.amountMinor===undefined||known.reduce((sum,f)=>sum+(f.amountMinor??0),0)<paidTotal(r,p))return;
  // The whole payment went back and no refund of ours took the credits out: like a dispute, the pack is frozen until the owner has looked.
  r.outsideRefundId=back.id;freeze(r,p);
}
/** A stage of a dispute. Each dispute of the payment is known by its last stage, and the pack is free only when none of them stands. */
function dispute(r:PaymentRecord,p:PurchaseRecord|undefined,won:boolean,disputeId:string,at:string):void {
  const known=r.disputes??=[], last=known.find(d=>d.id===disputeId);
  // Old news: a stage that happened before the last one known of the same dispute changes nothing, whenever it is delivered.
  if(last&&Date.parse(at)<Date.parse(last.at))return;
  if(last)Object.assign(last,{at,won});else known.push({id:disputeId,at,won});
  if(won){
    // Another dispute of this payment still stands: the end of this one frees nothing.
    if(known.some(d=>!d.won))return;
    // The money stays with us. An outside refund that was hidden under the dispute's mark still holds the pack, under its own.
    if(r.flag==='disputed'){if(r.outsideRefundId===undefined)delete r.flag;else r.flag='refund-review';}
    thaw(r,p);return;
  }
  r.flag='disputed';
  if(!paymentStore().attention.includes(`disputed:${r.checkoutId}`))paymentStore().attention.push(`disputed:${r.checkoutId}`);
  // Freeze only the unspent part of this pack, using the existing held-lot contract.
  freeze(r,p);
}
/** What a refund gives back: the whole payment, so the total that was charged where the provider added tax to the pack price. */
const refundAmount=(p:PurchaseRecord)=>p.taxCents&&p.totalCents!==undefined?money(p.totalCents):p.amount??'';
/** The provider's answer to a refund that was sent: it settles once. */
function settleRefund(r:PaymentRecord,p:PurchaseRecord,kind:'refunded'|'refund-failed',at:string):void {
  const next=refundTransition(p.status,kind);
  if(next===p.status)return;
  p.status=next;if(p.refund)p.refund.settledAt=at;
  // The refund that settles is the outside one itself: nothing is left for the owner to look at.
  if(next==='refunded'&&r.outsideRefundId!==undefined&&r.refundId===r.outsideRefundId&&r.flag==='refund-review')delete r.flag;
  // Its result is known now: the note that it was not is taken off the owner's list.
  if(next==='refunded'){const attention=paymentStore().attention;attention.splice(0,attention.length,...attention.filter(a=>a!==`refund-unknown:${p.id}`));}
  if(next==='refunded'){const user=findUser(p.userId);if(user)keepEmail('payment',user.email,{refund:'true',purchaseId:p.id,packName:p.packName,credits:String(p.credits),amount:refundAmount(p),date:at});}
  // Our refund failed while the money is gone or disputed all the same: frozen first, so the credits come back held, not spendable.
  if(next==='refund-failed'&&frozen(r))freeze(r,p);
  if(next==='refund-failed')writeEntry(p.userId,'returned',p.credits,p.packName,{by:{kind:'system'},purchaseId:p.id,backTo:[{lot:p.id,credits:p.credits}]});
}
/**
 * The one place that writes credits. Only a verified webhook or the server's own read of the provider calls it: nothing from the browser does.
 * `facts` is what a real provider itself reported about a paid payment; without them a real payment is never credited.
 * `partial`: the provider itself called the refund a part of the payment. `amountUnknown`: it told of the refund without its amount.
 */
export function receivePayment(input:ProviderEvent,raw:string,facts?:PaidFacts,partial=false,amountUnknown=false):Checkout {
  const config=paymentConfig(), event=gateSchema.parse(input);
  return paymentTransaction(()=>{
    const state=paymentStore(), r=recordOf(event.checkoutId), dodo=r.provider==='dodo', named=event.providerPaymentId;
    if(!mine(r,config))throw new PaymentRefusal('payment-provider-mismatch');
    const payment=event.kind!=='refunded'&&event.kind!=='refund-failed'&&event.kind!=='disputed'&&event.kind!=='dispute-won';
    // The session ties an event to our checkout, and nothing is paid without a session and a payment id. The payment id must be the stored one,
    // except in a Dodo payment event: Dodo names the payment only when someone pays, and a new attempt after a refused card gets a new id.
    if(r.sessionId!==event.providerSessionId||(event.kind==='paid'&&!(named&&r.sessionId))||(!(dodo&&payment)&&(!named||r.paymentId!==named)))throw new PaymentRefusal('payment-binding-mismatch');
    const old=state.events.find(e=>e.event.eventId===event.eventId);
    if(old){if(JSON.stringify(old.event)!==JSON.stringify(event))throw new PaymentRefusal('event-id-conflict');return checkoutOf(r);}
    const store=getStore(), c=store.checkouts.find(c=>c.id===r.checkoutId)!;
    if(event.kind==='refunded'||event.kind==='refund-failed'){
      const p=store.purchases.find(p=>p.id===r.purchaseId), earlier=r.pastRefundIds?.includes(event.providerRefundId??'');
      // A refund call that never answered left the sent refund without its id: Dodo's notice of a refund that succeeded names it, unless it is an earlier attempt's.
      // A failure is not taken as ours: it may be another refund's, and giving the credits back for it would leave the buyer with both once ours succeeds.
      // What went back, where the refund succeeded. It is taken for the refund that was sent from here only when its amount is all the buyer paid
      // and Dodo did not call it a part.
      // A sum in another currency than the payment's says nothing of how much of the payment went back: the amount is then not known.
      const amount=!amountUnknown&&event.currency===r.currency?event.amountMinor:undefined;
      const back=event.kind==='refunded'?{id:event.providerRefundId??'',amountMinor:amount}:null;
      const whole=back!==null&&!partial&&amount!==undefined&&amount>=paidTotal(r,p), sent=r.refundId, was=p?.status;
      if(dodo&&whole&&p?.status==='refund-sent'&&r.refundId===undefined&&event.providerRefundId&&!earlier)r.refundId=event.providerRefundId;
      if(p&&r.refundId&&event.providerRefundId===r.refundId){
        // Our own refund, by one rule whoever tells it (its notice or the server's own read of it): it is "refunded" when what it gave back, with
        // the parts known to have gone back outside, is all the buyer paid. Less than that settles nothing, and neither does a refund Dodo calls
        // a part while it names the whole sum, one whose amount is not known, or a failure it calls a part: the owner must look, and the buyer is told nothing.
        const paid=paidTotal(r,p), parts=outsideSum(r,r.refundId);
        const waits=dodo&&event.kind==='refunded'?amount===undefined||amount+parts<paid||(partial&&amount>=paid):partial;
        if(waits)review(r,'refund-review',`refund-review:${r.checkoutId}`);else settleRefund(r,p,event.kind,event.occurredAt);
        // Our refund is now "refunded", and with it what waited for the owner about it. The mark stays where the whole payment went back in another
        // refund too, and where the refund is ours only by Dodo's telling (its id never came) while other refunds of the payment are known beside it.
        const others=(r.outsideRefunds??[]).some(f=>f.id!==r.refundId);
        if(dodo&&was!=='refunded'&&p.status==='refunded'&&r.outsideRefundId===undefined&&r.flag==='refund-review'&&(sent!==undefined||!others))delete r.flag;
      }
      else if(!dodo)throw new PaymentRefusal('refund-binding-mismatch');
      else if(!earlier)outsideRefund(r,p,back);
    }else if(event.kind==='disputed'||event.kind==='dispute-won'){
      dispute(r,store.purchases.find(p=>p.id===r.purchaseId),event.kind==='dispute-won',event.providerDisputeId??'',event.occurredAt);
    }else if(dodo&&event.kind==='paid'&&r.status==='paid'){
      // Credited once, bound for good. Another payment that succeeded on the same session took the buyer's money twice.
      if(r.paymentId!==named)review(r,'second-payment',`second-payment:${r.checkoutId}`);
    }else{
      const kind=event.kind as PaymentKind;
      // A paid notice of an account that is gone has nobody to credit: failing would only make Dodo deliver it for a day, so it is marked like a broken price rule.
      const refusal=dodo&&kind==='paid'?priceRefusal({amountMinor:r.amountMinor,currency:r.currency,productId:config.mode==='test'?config.dodo.products.get(c.packId)??'':''},event,facts)??(findUser(c.userId)?null:'no-account'):null;
      const result=applyEvent({status:r.status,amountMinor:r.amountMinor,currency:r.currency},{...event,kind});
      if(refusal){review(r,'payment-review',`payment-review:${refusal}:${r.checkoutId}`);r.refusal=refusal;}
      else if(result.mismatch){r.flag='amount-mismatch';state.attention.push(`amount-mismatch:${r.checkoutId}`);}
      else {
        // Bound where first seen; replaced only by the attempt that is credited.
        if(dodo&&named&&(!r.paymentId||result.grant))r.paymentId=named;
        if(result.grant&&r.flag==='payment-review')delete r.flag;
        if(result.grant)delete r.refusal;
        r.status=result.status;
        c.state=r.status==='pending'||r.status==='cancelled'||r.status==='expired'?r.status:null;
        if(result.grant){
          const user=findUser(c.userId);if(!user)throw new NotFoundError('user');
          const pack=PACKS.find(p=>p.id===c.packId)!;
          let p=store.purchases.find(p=>p.id===r.purchaseId);
          const invoiceId=crypto.randomUUID(), at=event.occurredAt;
          // Dodo adds the buyer's tax on top of the pack price: what it reported is kept beside the price, and the buyer is told the total only where there is a tax.
          const tax=dodo?facts?.taxMinor??null:null, charged=tax===null?{}:{taxCents:tax,totalCents:r.amountMinor+tax};
          // Dodo is the seller, so the invoice the buyer downloads is Dodo's own: its address is kept only when it is Dodo's own https address.
          const invoiceUrl=dodo?dodoAddress(facts?.invoiceUrl):null;
          const values={userId:user.id,packId:pack.id,packName:pack.name,credits:pack.credits,amount:money(r.amountMinor),amountCents:r.amountMinor,at,status:'paid' as const,invoiceId,refund:null,...charged,...(invoiceUrl?{invoiceUrl}:{})};
          if(p)Object.assign(p,values);else {p={id:crypto.randomUUID(),...values};store.purchases.push(p);}
          r.purchaseId=c.purchaseId=p.id;
          // What went back of a payment before it was credited is told by the notices kept for it or by the read that credits it: the sweep's own look comes later.
          if(dodo)r.refundsReadAt=now().toISOString();
          writeEntry(user.id,'purchase',pack.credits,pack.name,{by:{kind:'system'},purchaseId:p.id});
          // A refund or a dispute of this very payment was kept before the payment was known: it applies now, to the credits just written.
          for(const kept of dodo?state.unhandled??[]:[])if(kept.reason==='unknown-payment'&&kept.paymentId===named){
            if(kept.type.startsWith('dispute.'))dispute(r,p,kept.type==='dispute.won',kept.disputeId??'',kept.occurredAt??kept.receivedAt);
            // A sum in another currency than the payment's, or one whose currency was not kept, says nothing of how much of the payment went back.
            else outsideRefund(r,p,kept.type==='refund.succeeded'?{id:kept.refundId??'',amountMinor:kept.currency===r.currency?kept.amountMinor:undefined}:null);
          }
          state.invoiceCounter=Math.max(state.invoiceCounter,store.invoices.length)+1;
          const number=invoiceNumber(state.invoiceCounter);
          store.invoices.push({id:invoiceId,number,userId:user.id,purchaseId:p.id,date:at,packName:pack.name,credits:pack.credits,amount:money(r.amountMinor),...charged});
          const mail=keepEmail('payment',user.email,{purchaseId:p.id,invoiceId,packName:pack.name,credits:String(pack.credits),balance:String(balanceOf(user.id)),returnTo:c.returnTo,amount:money(r.amountMinor),date:at,number,
            ...(tax?{tax:money(tax),total:money(r.amountMinor+tax)}:{}),...(invoiceUrl?{invoiceUrl}:{})});
          state.deliveries.push({emailId:mail.id,status:'queued',attempts:0,nextTryAt:0});
        }else if(r.status==='declined'&&!r.purchaseId){
          const pack=PACKS.find(p=>p.id===c.packId)!;
          const p={id:crypto.randomUUID(),userId:c.userId,packId:pack.id,packName:pack.name,credits:pack.credits,amount:money(r.amountMinor),amountCents:r.amountMinor,at:event.occurredAt,status:'not-completed' as const,invoiceId:null,refund:null};
          store.purchases.push(p);r.purchaseId=c.purchaseId=p.id;
        }
      }
    }
    state.events.push({event,raw,processedAt:now().toISOString()});return checkoutOf(r);
  });
}
/** The marks the owner must look at, by purchase: shown next to the purchase in the admin's list. */
export type PaymentMark='disputed'|'refund-review'|'refund-outside'|'refund-conflict'|'refund-overdue'|'refund-unknown'|'refund-not-found'|'refund-no-funds'|'second-payment';
/** A refund that was sent and has no id of the provider's: the call was not answered, so whether money goes back is not known yet. */
const unconfirmed=(r:PaymentRecord,p:PurchaseRecord|undefined)=>p?.status==='refund-sent'&&r.refundId===undefined;
export function refundUnconfirmed(purchaseId:string):boolean {
  const r=paymentStore().records.find(r=>r.purchaseId===purchaseId);
  return !!r&&unconfirmed(r,getStore().purchases.find(p=>p.id===purchaseId));
}
/** One mark a purchase: what freezes the pack first, then what is open about a refund that was sent, then the rest. */
function markOf(r:PaymentRecord,p:PurchaseRecord|undefined):PaymentMark|null {
  if(r.flag==='disputed')return r.flag;
  // The whole payment is known to be back at Dodo: the admin's refund closes it here. Any other refund that is not ours is settled at Dodo.
  if(r.flag==='refund-review')return r.outsideRefundId===undefined?r.flag:'refund-outside';
  if(p?.status==='refund-sent'&&r.refundNote==='conflict')return 'refund-conflict';
  if(overdue(r,p,now().getTime()))return 'refund-overdue';
  if(unconfirmed(r,p))return 'refund-unknown';
  if(p?.status==='refund-failed'&&r.refundNote==='not-found')return 'refund-not-found';
  if(p?.status==='refund-failed'&&r.refundNote==='no-funds')return 'refund-no-funds';
  return r.flag==='second-payment'?r.flag:null;
}
/** Why Dodo refused the refund that failed last, where it named a reason the owner can act on: its wallet could not cover the refund. */
export function refundRefusal(purchaseId:string):'no-funds'|null {
  const r=paymentStore().records.find(r=>r.purchaseId===purchaseId);
  return r&&markOf(r,getStore().purchases.find(p=>p.id===purchaseId))==='refund-no-funds'?'no-funds':null;
}
export function paymentMarks():Map<string,PaymentMark> {
  const marks=new Map<string,PaymentMark>();
  for(const r of paymentStore().records){
    const mark=r.purchaseId?markOf(r,getStore().purchases.find(p=>p.id===r.purchaseId)):null;
    if(mark)marks.set(r.purchaseId!,mark);
  }
  return marks;
}
/** A payment Dodo reported that was not credited: the price rule refused it, or its account is gone. Before the owner until the checkout is credited. */
export interface UncreditedPayment { checkoutId:string; userId:string; packName:string; amount:string; at:string; reason:NonNullable<PaymentRecord['refusal']> }
export function uncreditedPayments():UncreditedPayment[] {
  return paymentStore().records.flatMap(r=>{
    const c=getStore().checkouts.find(c=>c.id===r.checkoutId), pack=PACKS.find(p=>p.id===c?.packId);
    return r.refusal&&c&&pack?[{checkoutId:r.checkoutId,userId:c.userId,packName:pack.name,amount:money(r.amountMinor),at:c.startedAt,reason:r.refusal}]:[];
  });
}
const sessionOf=(r:PaymentRecord|undefined):DodoSession|undefined=>r&&r.provider==='dodo'&&r.sessionId?{checkoutId:r.checkoutId,sessionId:r.sessionId,...(r.paymentId?{paymentId:r.paymentId}:{})}:undefined;
/**
 * A delivery to the webhook in test mode. `unverified`: the signature was refused, nothing was read. `retry`: it names a payment that is not
 * stored yet, so Dodo must deliver it again. `done`: applied, or kept without effect; a refusal by rule is `done` too, because Dodo would
 * otherwise repeat for a day what can never be accepted. The kept note holds the event's type and our reason, never its body; a refund or a
 * dispute of a payment that is not stored also keeps the ids it names.
 */
export function receiveDodoNotice(raw:string,headers:Headers):'done'|'unverified'|'retry' {
  const config=paymentConfig();if(config.mode!=='test')throw new Error('payment-provider-mismatch');
  const records=()=>paymentStore().records;
  const notice=receiveDodoWebhook(raw,headers,config.secret(),{byCheckoutId:id=>sessionOf(records().find(r=>r.checkoutId===id)),byPaymentId:id=>sessionOf(records().find(r=>r.paymentId===id))});
  if(notice.outcome==='unverified')return 'unverified';
  const eventId=headers.get('webhook-id')??'';
  const keep=(type:string,reason:string,about?:DodoAbout)=>paymentTransaction(()=>{
    const kept=paymentStore().unhandled??=[];if(kept.some(n=>n.eventId===eventId))return;
    kept.push({eventId,type,reason,receivedAt:now().toISOString(),...(about?{paymentId:about.paymentId,...(about.refundId?{refundId:about.refundId}:{}),...(about.partialRefund?{partial:true as const}:{}),...(about.amountMinor!==undefined?{amountMinor:about.amountMinor}:{}),...(about.currency?{currency:about.currency}:{}),
      ...(about.disputeId?{disputeId:about.disputeId}:{}),...(about.occurredAt?{occurredAt:about.occurredAt}:{})}:{})});
  });
  if(notice.outcome==='ignored'){keep(notice.dodoType,'ignored');return 'done';}
  if(notice.outcome==='rejected'){keep(notice.about?.dodoType??'',notice.reason,notice.about);return notice.retry?'retry':'done';}
  try{receivePayment(notice.event,`dodo:${notice.dodoType}`,notice.payment&&{taxMinor:notice.payment.taxReported?notice.payment.taxMinor:null,cart:notice.payment.cart,invoiceUrl:notice.payment.invoiceUrl},notice.partialRefund,notice.amountUnknown);}
  catch(error){if(!(error instanceof PaymentRefusal))throw error;keep(notice.dodoType,error.message);}
  return 'done';
}
export const paymentsGateway:PaymentGateway={
  ...payments,
  async startCheckout(userId,packId,returnTo,idempotencyKey){
    const config=paymentConfig();
    const user=findUser(userId);if(!user || user.blocked)throw new NotFoundError('user');
    const pack=PACKS.find(p=>p.id===packId);if(!pack||pack.priceCents===null)throw new NotFoundError('pack');
    if(!/^\/(?!\/)/.test(returnTo)||/[\\\r\n]/.test(returnTo))throw new Error('invalid-return-path');
    /** The page of a checkout that was opened. Null when its opening call never answered: that one is never asked again. */
    const pageOf=(r:PaymentRecord)=>opening.get(r.checkoutId)??(r.sessionId?Promise.resolve({checkoutId:r.checkoutId,url:r.checkoutUrl??fake.page(r.checkoutId)}):null);
    // Existing UI passes no nonce: reuse the owner's matching unresolved session, so double POSTs cannot open two checkouts.
    const active = !idempotencyKey ? paymentStore().records.find(r => {
      const c=getStore().checkouts.find(c=>c.id===r.checkoutId);
      return c?.userId===userId && c.packId===packId && c.returnTo===returnTo && (r.status==='open'||r.status==='pending') && Date.parse(r.expiresAt)>now().getTime() && mine(r,config) && pageOf(r)!==null;
    }) : undefined;
    if(active)return pageOf(active)!;
    const nonce=idempotencyKey??crypto.randomUUID();if(!nonce.trim()||nonce.length>200)throw new Error('invalid-idempotency-key');
    const key=JSON.stringify([userId,nonce]), checkoutId=crypto.randomUUID();
    // First the command, durably: a checkout with no session yet. Then the provider is called, then its answer is written.
    const existing=paymentTransaction(()=>{
      const existing=paymentStore().records.find(r=>r.key===key);
      if(existing){const c=getStore().checkouts.find(c=>c.id===existing.checkoutId)!;if(c.packId!==packId||c.returnTo!==returnTo||!mine(existing,config))throw new Error('checkout-key-conflict');return existing;}
      // The mock gateway's limit, here over every checkout of the day that has no purchase: one left alone expires by itself after an hour, so "still open" alone would let a loop store twenty more every hour.
      const since=now().getTime()-86400000;
      if(getStore().checkouts.filter(c=>c.userId===userId&&c.purchaseId===null&&Date.parse(c.startedAt)>since).length>=MAX_OPEN_CHECKOUTS)throw new Error('too-many-checkouts');
      // Dodo names the payment only when someone pays, and keeps its session for a day; the fake knows both at once.
      const at=now().toISOString(), dodo=config.mode==='test', paymentId=dodo?'':`fake-payment:${checkoutId}`;
      getStore().checkouts.push({id:checkoutId,userId,packId,returnTo,purchaseId:null,state:'pending',startedAt:at,pendingSince:at,reference:paymentId});
      paymentStore().records.push({checkoutId,sessionId:'',paymentId,amountMinor:pack.priceCents!,currency:'USD',status:'pending',providerStatus:'open',providerOccurredAt:at,expiresAt:new Date(now().getTime()+(dodo?86400000:3600000)).toISOString(),key,purchaseId:null,...(dodo?{provider:'dodo' as const}:{})});
      return null;
    });
    if(existing){const page=pageOf(existing);if(!page)throw new Error('checkout-not-opened');return page;}
    const back=`${config.base}/checkout/return?checkout=${checkoutId}&returnTo=${encodeURIComponent(returnTo)}`;
    const call=providerOf(config).createCheckout({checkoutId,packId,email:user.email,returnUrl:back,cancelUrl:back}).then(session=>{
      paymentTransaction(()=>{const r=recordOf(checkoutId);r.sessionId=session.sessionId;r.checkoutUrl=session.url;});
      return {checkoutId,url:session.url};
    },error=>{
      // Whether the provider opened it is not known. The checkout stays without a session, so no notice can ever pay it, and it runs out by itself.
      paymentTransaction(()=>{paymentStore().attention.push(`checkout-not-opened:${checkoutId}:${error instanceof DodoError?error.message:'unknown'}`);});
      throw new Error('payment-provider-unavailable');
    }).finally(()=>opening.delete(checkoutId));
    opening.set(checkoutId,call);
    return call;
  },
  async getCheckout(checkoutId,viewerId){paymentConfig();const r=paymentStore().records.find(r=>r.checkoutId===checkoutId),c=getStore().checkouts.find(c=>c.id===checkoutId&&c.userId===viewerId);return r&&c?checkoutOf(r):null;},
  async complete(){throw new Error('signed-payment-notice-required');},
  async notify(checkoutId,event){if(event==='paid'||event==='declined')throw new Error('signed-payment-notice-required');return receivePayment(eventOf(recordOf(checkoutId),event),'local-control');},
  async requestRefund(userId,purchaseId){paymentConfig();return paymentTransaction(()=>{const p=getStore().purchases.find(p=>p.id===purchaseId&&p.userId===userId);if(!p)throw new NotFoundError('purchase');if(p.status==='refund-requested')return toPurchase(p);if(!toPurchase(p).refundable?.ok)throw new Error('not-refundable');p.status='refund-requested';p.refund={requestedAt:now().toISOString(),sentAt:null,settledAt:null,by:{kind:'customer'}};return toPurchase(p);});},
  async cancelRefund(userId,purchaseId){paymentConfig();return paymentTransaction(()=>{const p=getStore().purchases.find(p=>p.id===purchaseId&&p.userId===userId);if(!p)throw new NotFoundError('purchase');const flag=paymentStore().records.find(r=>r.purchaseId===p.id)?.flag;if(flag==='disputed')throw new Error('dispute-needs-owner');if(flag==='refund-review')throw new Error('refund-needs-owner');if(p.status==='refund-requested'){p.status='paid';p.refund=null;}return toPurchase(p);});},
  async refundSettled(){throw new Error('signed-refund-notice-required');},
};
export async function sendRefund(adminId:string,purchaseId:string,reason:string,key:string):Promise<AdminResult<Purchase>>{
  const admin=findUser(adminId);if(!admin||admin.role!=='admin'||admin.blocked||!admin.emailVerified)throw new Error('admin-required');
  const config=paymentConfig();if(!reason.trim()||reason.length>1000||!key.trim()||key.length>200)throw new Error('invalid-refund-input');
  // First the command, durably: the refund is sent (its credits are out) and has no id yet. Then the provider is called, then its answer is written.
  const sent=paymentTransaction(()=>{
    const p=getStore().purchases.find(p=>p.id===purchaseId);if(!p)throw new NotFoundError('purchase');
    const r=paymentStore().records.find(r=>r.purchaseId===p.id);if(!r||!r.paymentId)throw new Error('provider-payment-required');
    if(!mine(r,config))throw new Error('payment-provider-mismatch');
    if(r.flag==='disputed')throw new Error('dispute-needs-owner');
    if(r.refundKeys?.includes(key)||p.status==='refund-sent'||p.status==='refunded')return {result:{outcome:'already-done' as const,at:p.refund?.sentAt??p.at,value:toPurchase(p)}};
    if(p.status!=='refund-requested'&&p.status!=='refund-failed')throw new Error('not-requested');
    // Where Dodo itself reported the whole payment refunded, that money is back with the buyer already: nothing is sent, what is left of the pack
    // leaves, and the purchase is closed with that refund. It is the only way on for a pack some of whose credits were spent.
    const left=lotsOf(p.userId).get(p.id)??0, closing=r.outsideRefundId!==undefined;
    if(left!==p.credits&&!closing)throw new Error('credits-used');
    const attempt=(r.refundAttempt??0)+1;
    if(r.refundId)(r.pastRefundIds??=[]).push(r.refundId);
    r.refundAttempt=attempt;r.refundId=undefined;r.providerRefundStatus=undefined;r.refundNote=undefined;(r.refundKeys??=[]).push(key);
    const at=now().toISOString(),by={kind:'admin' as const,id:admin.id,name:admin.name};
    p.status='refund-sent';p.refund={requestedAt:p.refund?.requestedAt??at,sentAt:at,settledAt:null,by};
    if(left>0)writeEntry(p.userId,'refund',-left,p.packName,{by,reason:reason.trim(),purchaseId:p.id,from:p.id});
    getStore().adminActions.push({at,by,action:'refund',target:p.id,reason:reason.trim()});
    if(closing){r.refundId=r.outsideRefundId;settleRefund(r,p,'refunded',at);return {result:{outcome:'done' as const,at,value:toPurchase(p)}};}
    return {result:{outcome:'done' as const,at,value:toPurchase(p)},command:{paymentId:r.paymentId,reason:reason.trim(),checkoutId:r.checkoutId,idempotencyKey:`refund:${p.id}:${attempt}`}};
  });
  if(!sent.command)return sent.result;
  const {checkoutId}=sent.command;
  try{
    const {refundId}=await providerOf(config).refund(sent.command);
    paymentTransaction(()=>{
      // A notice that came first may have named the refund already; then the two must agree.
      const r=recordOf(checkoutId);if(r.refundId===undefined)r.refundId=refundId;else if(r.refundId!==refundId)review(r,'refund-review',`refund-review:${checkoutId}`);
      // The buyer is told "sent" only now that the provider took the refund: a refused one, or one whose answer never came, tells nothing.
      const p=getStore().purchases.find(p=>p.id===purchaseId)!, owner=findUser(p.userId);
      if(owner&&p.status==='refund-sent')keepEmail('payment',owner.email,{refund:'sent',purchaseId:p.id,packName:p.packName,credits:String(p.credits),amount:refundAmount(p),date:sent.result.at});
    });
  }catch(error){
    // Known to have made no refund (Dodo names the refusal so, or nothing was sent): it settles as a failed one (the credits come back, the admin can send again).
    // Every other failure, a refusal Dodo does not name so included, may mean money is going back: giving the credits back too would pay twice.
    const refused=error instanceof DodoError&&(error.kind==='no-refund'||error.kind==='invalid-request');
    const exists=error instanceof DodoError&&error.kind==='refund-exists';
    const closed=paymentTransaction(()=>{
      const r=recordOf(checkoutId), p=getStore().purchases.find(p=>p.id===purchaseId)!, attention=paymentStore().attention;
      // "Refunded already", of a payment whose whole refund Dodo itself reported: that refund is this one, and the frozen pack is closed with it.
      // So is a refusal that made no refund: the money is back all the same, and failing here would send the admin round to the same refusal for ever.
      if((exists||refused)&&r.outsideRefundId&&p.status==='refund-sent'&&r.refundId===undefined){r.refundId=r.outsideRefundId;settleRefund(r,p,'refunded',now().toISOString());return true;}
      else if(!refused){
        // No answer: it stays sent, is never sent again, and Dodo's notice or a later read settles it.
        attention.push(`refund-unknown:${purchaseId}`);
        if(exists)r.refundNote='exists';
      }
      else if(p.status==='refund-sent'&&r.refundId===undefined){
        settleRefund(r,p,'refund-failed',now().toISOString());attention.push(`refund-refused:${purchaseId}:${error.message}`);
        // The one refusal the owner can do something about: the list says so until the refund is sent again.
        if(error.code===NO_WALLET_FUNDS)r.refundNote='no-funds';
      }
      return false;
    });
    if(refused&&!closed)throw new Error('refund-refused');
    // Closed with a refund that was told while Dodo was asked: the answer says "refunded", not "sent".
    if(closed)return {...sent.result,value:toPurchase(getStore().purchases.find(p=>p.id===purchaseId)!)};
  }
  return sent.result;
}
/** What went back at Dodo in refunds that are not ours, in cents, while that is not known to be the whole payment (0 once it is): the admin's list shows it, and nothing here acts on it. */
export function partRefunded(purchaseId:string):number {
  const r=paymentStore().records.find(r=>r.purchaseId===purchaseId);
  return r&&r.outsideRefundId===undefined?(r.outsideRefunds??[]).reduce((sum,f)=>sum+(f.amountMinor??0),0):0;
}
/** A refund that is not ours went through at Dodo and how much it gave back is not known, while the whole payment is not known to be back: the admin's list says so, and nothing here acts on it. */
export function refundAmountUnknown(purchaseId:string):boolean {
  const r=paymentStore().records.find(r=>r.purchaseId===purchaseId);
  return !!r&&r.outsideRefundId===undefined&&(r.outsideRefunds??[]).some(f=>f.amountMinor===null);
}
/** A purchase paid through Dodo: its refund is money back only once Dodo itself said it went through. */
export function paidAtDodo(purchaseId:string):boolean {
  return paymentStore().records.some(r=>r.purchaseId===purchaseId&&r.provider==='dodo');
}
/** What is left of a purchase's pack: the credits a refund sent from the admin's list takes out (all of the pack, unless some of it were spent). */
export function creditsLeft(purchaseId:string):number {
  const p=getStore().purchases.find(p=>p.id===purchaseId);
  return p?Math.max(0,lotsOf(p.userId).get(p.id)??0):0;
}
/** One tour asks Dodo about at most this many records, one request each, never a second time. */
export const SWEEP_ASKS=10;
/** The second look at credited payments has this many requests of its own in every tour, also when the others took all of `SWEEP_ASKS`: nobody's open checkouts keep it from running. */
const LOOK_ASKS=2;
/** Our end of a session is written before Dodo opens it, so Dodo's own ends a little later: an ended session is closed only on an answer read this long after ours. */
const CLOSE_AFTER_MS=600000;
/** A checkout Dodo could not be asked about for this long after its session ran out is given up: it goes before the owner, uncredited. */
const GIVE_UP_MS=3*86400000;
/** A sent refund that is not settled this long after it was sent is asked about once more and then left alone: it goes before the owner, and no credit moves. */
const REFUND_GIVE_UP_MS=3*86400000;
/** Of Dodo's refunds only: the fake provider says how a refund ended when someone makes it say so, however long that takes. */
const overdue=(r:PaymentRecord,p:PurchaseRecord|undefined,t:number)=>r.provider==='dodo'&&p?.status==='refund-sent'&&!!p.refund?.sentAt&&t-Date.parse(p.refund.sentAt)>REFUND_GIVE_UP_MS;
/** "Dodo lists no refund of ours" is believed only this long after the refund was sent: a call that timed out may still be on its way in. */
const REFUND_QUIET_MS=3600000;
/** A credited payment is looked at again at most this often, and for this long after it was made: money that went back at Dodo without a notice reaching us. */
const LOOK_EVERY_MS=3600000, LOOK_FOR_MS=90*86400000;
/** The return page asks Dodo about one checkout at most this often, however often it is reloaded. */
const PAGE_ASK_MS=5000;
/** All the pages of one account together make Dodo be asked at most this often, however many checkouts it keeps open. */
const ACCOUNT_ASKS=20, ACCOUNT_ASKS_MS=60000;
/** `unpaid`: Dodo's session has no payment. `settled`: a payment's outcome was read and handed to the gate. The rest decide nothing yet. */
type Read='unpaid'|'settled'|'named'|'waiting'|'unknown';
// Notes of this process only; none of them decides a credit, and losing them on a restart costs one more question.
const notes=new Map<string,{at:number;said:Read}>(); // when Dodo was last asked about a checkout (or `refund:` + checkout), and what it said
const named=new Map<string,string>(); // the payment a session named, to be read by the next question
const closed=new Set<string>(); // checkouts whose session ran out and that Dodo answered for good afterwards
const pageAsks=new Map<string,number[]>(); // when an account's pages last made Dodo be asked
const short=new Set<string>(); // checkouts whose sent refund Dodo said went through, and that did not settle here: the rest may have gone back beside it
let sweeping=false;
function note(marker:string):void {paymentTransaction(()=>{if(!paymentStore().attention.includes(marker))paymentStore().attention.push(marker);});}
/** A checkout that may have been paid and was not credited, for a reason only the server's own read knows: noted, and on the owner's list until it is credited. */
function uncredited(checkoutId:string,marker:string,refusal:'binding'|'gave-up'):void {
  paymentTransaction(()=>{note(marker);const r=recordOf(checkoutId);if(r.status!=='paid')r.refusal=refusal;});
}
const KINDS:Partial<Record<string,PaymentKind>>={succeeded:'paid',failed:'declined',cancelled:'cancelled',processing:'pending'};
/**
 * What a payment's own list of refunds says, without those in `skip`. `whole` names a refund when all of the money went back: in one refund,
 * or in parts that add up to it. `part`: some of it did, or a refund went through that Dodo gives no amount for (how much is not known, so it
 * is never taken for the whole). `open`: a refund may still pay out.
 */
function moneyBack(payment:DodoPayment,skip:readonly string[]=[]):{whole:string|null;part:boolean;open:boolean;none:boolean;back:DodoPayment['refunds']} {
  const listed=payment.refunds.filter(f=>!skip.includes(f.refundId)), back=listed.filter(f=>f.status==='succeeded');
  const all=back.length>0&&back.reduce((sum,f)=>sum+(f.amount??0),0)>=payment.totalAmount;
  return {whole:all?back.at(-1)!.refundId:null,part:back.length>0&&!all,back,open:listed.some(f=>f.status==='pending'||f.status==='review'),none:listed.every(f=>f.status==='failed')};
}
/** Refunds of Dodo's list that went through and are not the whole payment: each goes before the owner with its amount, as its notice would have. */
function partsBack(r:PaymentRecord,back:DodoPayment['refunds']):void {
  const p=getStore().purchases.find(p=>p.id===r.purchaseId);
  for(const f of back)outsideRefund(r,p,{id:f.refundId,amountMinor:f.amount??undefined});
}
/**
 * The address of Dodo's invoice, brought after the credit by a read that was made for another reason: written once where the purchase has none,
 * never replaced, and never asked for by itself. The answer must be about the very payment that was credited.
 */
function keepInvoice(r:PaymentRecord,payment:DodoPayment):void {
  const p=getStore().purchases.find(p=>p.id===r.purchaseId), invoiceUrl=dodoAddress(payment.invoiceUrl);
  if(p&&!p.invoiceUrl&&invoiceUrl&&r.status==='paid'&&r.paymentId===payment.paymentId&&payment.checkoutId===r.checkoutId)p.invoiceUrl=invoiceUrl;
}
/**
 * Asks Dodo about one unpaid checkout, with at most `requests` requests and no retry, and hands what it read to `receivePayment`: the same
 * rules as a webhook (our session, our checkout id, the price rule) decide, and the same single place writes the credit.
 * A failed or unreadable answer changes nothing.
 */
async function readPayment(checkoutId:string,config:PaymentConfig&{mode:'test'},requests:number):Promise<Read> {
  const r=recordOf(checkoutId), provider=new DodoProvider(config.dodo);
  const done=(said:Read)=>{notes.set(checkoutId,{at:now().getTime(),said});return said;};
  done('unknown');
  try{
    let paymentId=named.get(checkoutId);
    if(!paymentId){
      const session=await provider.getCheckout(r.sessionId);requests--;
      if(!session.paymentId)return done('unpaid');
      named.set(checkoutId,paymentId=session.paymentId);
    }
    if(requests<1)return done('named');
    const payment=await provider.getPayment(paymentId), kind=KINDS[payment.status??''];
    // Only a payment that may still succeed is read again; after any other answer the session is asked anew (a later attempt has a new id).
    if(kind!=='pending')named.delete(checkoutId);
    if(!kind)return done('waiting');
    // Dodo's answer must itself name our checkout; its session is checked by the gate, like a webhook's.
    if(payment.checkoutId!==checkoutId){uncredited(checkoutId,`reconcile-refused:checkout-mismatch:${checkoutId}`,'binding');return done('unknown');}
    const facts={taxMinor:payment.tax,cart:payment.products};
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([payment.paymentId,payment.status,payment.totalAmount,payment.currency,payment.sessionId,facts])));
    // The same answer read again is the same event, applied once; a changed answer is a new one.
    const event={eventId:`read:${[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('')}`,checkoutId,providerSessionId:payment.sessionId??'',providerPaymentId:payment.paymentId,kind,
      amountMinor:payment.totalAmount-(payment.tax??0),currency:payment.currency,occurredAt:payment.createdAt};
    try{paymentTransaction(()=>{
      receivePayment(event,'dodo-read:payment',{...facts,invoiceUrl:payment.invoiceUrl});
      const credited=recordOf(checkoutId);
      if(kind!=='paid'||credited.status!=='paid'||credited.paymentId!==payment.paymentId)return;
      keepInvoice(credited,payment);
      // Money of this payment that went back before it was credited here, in the Dodo panel: its notice has come and gone, so the list is all that tells.
      // The whole of it freezes the pack through the gate, as that notice would have; a part, or a refund still in work, goes before the owner.
      const {whole,part,open,back}=moneyBack(payment);
      if(whole)receivePayment({...event,eventId:`read:refunded-before:${whole}`,kind:'refunded',providerRefundId:whole,amountMinor:payment.totalAmount},'dodo-read:payment');
      else if(part)partsBack(credited,back);
      else if(open)review(credited,'refund-review',`refund-review:${checkoutId}`);
    });}
    catch(error){if(!(error instanceof PaymentRefusal))throw error;uncredited(checkoutId,`reconcile-refused:${error.message}:${checkoutId}`,'binding');return done('unknown');}
    return done(kind==='pending'?'waiting':'settled');
  }catch(error){if(!(error instanceof DodoError))throw error;return done('unknown');}
}
/**
 * Hands what a read said of one refund to the gate, as its notice would have: `amountMinor` null is a refund Dodo names no amount for.
 * `listed`: read from the payment's own list, not from the refund itself. The two tell of one refund in their own words (the list gives no time
 * of its own), so each is an event of its own; the gate settles a refund once whoever tells it.
 */
function tellRefund(checkoutId:string,kind:'refunded'|'refund-failed',refundId:string,paymentId:string,amountMinor:number|null,currency:string,at:string,partial=false,listed=false):void {
  // The same answer read again while nothing else became known is the same event, applied once. A changed answer is a new one, and so is the same
  // answer once another part is known to have gone back outside: a refund that waited for the owner is then looked at again.
  const now_=recordOf(checkoutId), said=[refundId,kind,amountMinor??'unknown',currency,partial?'part':'all',outsideSum(now_,now_.refundId)].join(':');
  try{receivePayment({eventId:`read:${listed?'listed':'refund'}:${said}`,checkoutId,providerSessionId:now_.sessionId,providerPaymentId:paymentId,providerRefundId:refundId,kind,amountMinor:amountMinor??0,currency,occurredAt:at},'dodo-read:refund',undefined,partial,amountMinor===null);}
  // Dodo's answer about our refund is not tied to this payment: nothing settles, and the owner sees it on the purchase.
  catch(error){if(!(error instanceof PaymentRefusal))throw error;paymentTransaction(()=>review(recordOf(checkoutId),'refund-review',`reconcile-refused:${error.message}:${checkoutId}`));}
}
/** Whether the sweep looks at a credited payment again: it is Dodo's, its money is not known to be back whole, and Dodo has something to tell that no other read asks for. */
function looksAgain(r:PaymentRecord,p:PurchaseRecord|undefined,t:number):boolean {
  if(r.provider!=='dodo'||r.status!=='paid'||!r.paymentId||!p||r.outsideRefundId!==undefined||t-Date.parse(p.at)>LOOK_FOR_MS)return false;
  // A refund that was sent is asked about by its own read. Only one Dodo said went through while it did not settle here (it gave back less than
  // was paid) needs the payment's list too: what is missing may have gone back beside it.
  return p.status==='paid'||p.status==='refund-requested'||p.status==='refund-failed'||(p.status==='refund-sent'&&short.has(r.checkoutId));
}
/**
 * Looks at one credited payment again, with one request: money that went back at Dodo (in its panel, or in a refund whose notice never reached
 * us). Every refund of the payment's own list that went through is handed to the gate as its notice would have been, so the notice's one rule
 * decides: a part is put before the owner and freezes nothing, parts that add up to all that was paid freeze the pack, a refund of unknown
 * amount is only marked, and our own refund is "refunded" once it and the parts are all that was paid. A refund told twice is one refund.
 * A failed or unreadable answer changes nothing but the time of the look.
 * False: the answer has nothing to act on (Dodo failed, or it names no refund that went through and no invoice the purchase lacks), so only the
 * time of the look is left to write. The tour writes that for all such looks at once: the whole record is not copied and saved for each.
 */
async function readRefunds(checkoutId:string,config:PaymentConfig&{mode:'test'}):Promise<boolean> {
  let payment:DodoPayment|null=null;
  try{payment=await new DodoProvider(config.dodo).getPayment(recordOf(checkoutId).paymentId);}catch(error){if(!(error instanceof DodoError))throw error;}
  const lacksInvoice=()=>!getStore().purchases.find(p=>p.id===recordOf(checkoutId).purchaseId)?.invoiceUrl;
  if(!payment||!(payment.refunds.some(f=>f.status==='succeeded')||(payment.invoiceUrl&&lacksInvoice())))return false;
  paymentTransaction(()=>{
    const r=recordOf(checkoutId), p=getStore().purchases.find(p=>p.id===r.purchaseId);
    r.refundsReadAt=now().toISOString();
    // Dodo's answer must itself name our checkout and the payment that was credited, and nothing may have settled while it was on its way.
    if(!payment||payment.checkoutId!==checkoutId||payment.paymentId!==r.paymentId||!looksAgain(r,p,now().getTime()))return;
    keepInvoice(r,payment);
    const ours=r.refundId, back=payment.refunds.filter(f=>f.status==='succeeded'&&!r.pastRefundIds?.includes(f.refundId));
    // The refunds that are not ours first: ours is measured with the parts that are known to have gone back beside it.
    for(const f of [...back.filter(f=>f.refundId!==ours),...back.filter(f=>f.refundId===ours)])
      tellRefund(checkoutId,'refunded',f.refundId,payment.paymentId,f.amount,payment.currency,(f.refundId===ours?p?.refund?.sentAt:null)??payment.createdAt,f.partial,true);
  });
  return true;
}
/**
 * Asks Dodo about one refund that was sent and is not settled, with one request. With its id: the refund itself. Without (the call never
 * answered, or Dodo said the payment has a refund already): the payment's own list of refunds, minus those of earlier attempts.
 */
async function readRefund(checkoutId:string,config:PaymentConfig&{mode:'test'}):Promise<void> {
  const r=recordOf(checkoutId), provider=new DodoProvider(config.dodo), attempt=r.refundAttempt;
  const sentAt=getStore().purchases.find(p=>p.id===r.purchaseId)?.refund?.sentAt;
  notes.set(`refund:${checkoutId}`,{at:now().getTime(),said:'unknown'});
  const apply=(kind:'refunded'|'refund-failed',refundId:string,paymentId:string,amountMinor:number,currency:string,at:string,partial=false)=>tellRefund(checkoutId,kind,refundId,paymentId,amountMinor,currency,at,partial);
  try{
    if(r.refundId){
      const refund=await provider.getRefund(r.refundId);
      if(refund.status==='succeeded'||refund.status==='failed')apply(refund.status==='succeeded'?'refunded':'refund-failed',refund.refundId,refund.paymentId,refund.amount??0,refund.currency??r.currency,refund.createdAt,refund.partial);
      if(refund.status==='succeeded'&&getStore().purchases.find(p=>p.id===r.purchaseId)?.status==='refund-sent')short.add(checkoutId);else short.delete(checkoutId);
      return;
    }
    const payment=await provider.getPayment(r.paymentId), {whole,part,none,back}=moneyBack(payment,r.pastRefundIds);
    paymentTransaction(()=>keepInvoice(recordOf(checkoutId),payment));
    if(whole)apply('refunded',whole,payment.paymentId,payment.totalAmount,payment.currency,payment.createdAt);
    // Money went back. A part of it is not the whole refund the gate knows: the owner must look.
    else if(part)paymentTransaction(()=>partsBack(recordOf(checkoutId),back));
    else if(none&&sentAt&&now().getTime()-Date.parse(sentAt)>REFUND_QUIET_MS)paymentTransaction(()=>{
      const now_=recordOf(checkoutId), p=getStore().purchases.find(p=>p.id===now_.purchaseId), attention=paymentStore().attention;
      if(p?.status!=='refund-sent'||now_.refundId!==undefined||now_.refundAttempt!==attempt)return;
      // Dodo answered the call with "this payment has a refund already" and now lists none that went through: one of the two is wrong.
      // Nothing comes back on a guess; the owner must look, and a refund Dodo lists or reports later still settles this one.
      if(now_.refundNote==='exists'||now_.refundNote==='conflict'){now_.refundNote='conflict';if(!attention.includes(`refund-conflict:${p.id}`))attention.push(`refund-conflict:${p.id}`);return;}
      // Dodo knows no refund of this attempt that could still pay out: ours never arrived or failed. The credits come back once, and the admin may send again.
      settleRefund(now_,p,'refund-failed',now().toISOString());now_.refundNote='not-found';attention.push(`refund-not-found:${p.id}`);
    });
  }catch(error){if(!(error instanceof DodoError))throw error;}
}
/** Our own end of a checkout nobody paid in time. */
function expire(r:PaymentRecord):void {
  if(r.status==='open'||r.status==='pending')receivePayment({...eventOf(r,'expired'),eventId:`expire:${r.checkoutId}`},'expiry');
}
/**
 * The minute's tour. The fake's outcome is read from its record. Dodo is asked about its unpaid checkouts and unsettled refunds: at most
 * `SWEEP_ASKS` records a tour, the longest unasked first, one request each; an answer that fails leaves the record for the next tour.
 * What is left of those requests, and never less than `LOOK_ASKS`, goes to a second look at payments that were credited (`readRefunds`): the
 * safety net under Dodo's notices. A tour so makes at most `SWEEP_ASKS + LOOK_ASKS` requests.
 */
export async function sweepPayments(transport?:EmailTransport){const config=paymentConfig();
  const asks:{key:string;run:()=>Promise<void>}[]=[];
  for(const r of [...paymentStore().records]){
    if(!mine(r,config))continue;
    const event=r.provider?null:fake.getPayment(r);if(event)receivePayment(event,'reconcile');
    const p=getStore().purchases.find(p=>p.id===r.purchaseId), t=now().getTime(), ended=Date.parse(r.expiresAt)<t, id=r.checkoutId;
    if(config.mode==='test'&&r.sessionId&&r.status!=='paid'&&r.status!=='expired'&&!closed.has(id)){
      // A Dodo session can be paid until it runs out, also after a refused card: it is asked until Dodo answers for good after its end.
      if(t-Date.parse(r.expiresAt)>GIVE_UP_MS){if(r.status==='open'||r.status==='pending')uncredited(id,`reconcile-gave-up:${id}`,'gave-up');expire(r);closed.add(id);}
      else asks.push({key:id,run:async()=>{const said=await readPayment(id,config,1);if(t-Date.parse(r.expiresAt)>CLOSE_AFTER_MS&&(said==='unpaid'||said==='settled')){expire(recordOf(id));closed.add(id);}}});
    }else if(ended)expire(r);
    // An overdue refund is asked about once more by this process (the site may have been down all the while), and then only Dodo's notice settles it.
    const late=overdue(r,p,t), asked=late&&(notes.get(`refund:${id}`)?.at??0)>Date.parse(p!.refund!.sentAt!)+REFUND_GIVE_UP_MS;
    if(config.mode==='test'&&p?.status==='refund-sent'&&r.paymentId&&!asked)asks.push({key:`refund:${id}`,run:()=>readRefund(id,config)});
    if(late)note(`stale-refund:${p!.id}`);
  }
  // One tour at a time: a tour that waits for Dodo is not joined by the next minute's.
  if(!sweeping){
    sweeping=true;
    try{
      const first=asks.sort((a,b)=>(notes.get(a.key)?.at??0)-(notes.get(b.key)?.at??0)).slice(0,SWEEP_ASKS);
      for(const ask of first)await ask.run();
      // The second look at credited payments takes what the tour has left and at least its own share, the longest unlooked first.
      if(config.mode==='test'){
        const t=now().getTime(), looked=(r:PaymentRecord)=>Date.parse(r.refundsReadAt??'')||0;
        const due=paymentStore().records.filter(r=>t-looked(r)>=LOOK_EVERY_MS&&looksAgain(r,getStore().purchases.find(p=>p.id===r.purchaseId),t));
        // Looks that found nothing to act on leave only their time to write: one write for all of them.
        const quiet:string[]=[];
        for(const r of due.sort((a,b)=>looked(a)-looked(b)).slice(0,Math.max(LOOK_ASKS,SWEEP_ASKS-first.length)))if(!await readRefunds(r.checkoutId,config))quiet.push(r.checkoutId);
        if(quiet.length)paymentTransaction(()=>{for(const id of quiet)recordOf(id).refundsReadAt=now().toISOString();});
      }
    }
    finally{sweeping=false;}
  }
  await drainOutbox(transport);
}

/**
 * One owner-scoped recovery lookup (the return page, "Check again"), using exactly the webhook state machine. `unpaid`: Dodo itself says
 * nobody paid this checkout. Nothing of the request but the checkout's id is used, and Dodo is asked at most once every few seconds
 * about one checkout and at most twenty times a minute for one account.
 */
export async function reconcilePayment(checkoutId:string,viewerId:string):Promise<'unpaid'|null> {
  const config=paymentConfig(), c=getStore().checkouts.find(c=>c.id===checkoutId&&c.userId===viewerId);if(!c)throw new NotFoundError('checkout');
  const r=recordOf(c.id);
  if(!mine(r,config))return null;
  if(config.mode!=='test'){const event=fake.getPayment(r);if(event)receivePayment(event,'manual-reconcile');return null;}
  if(!r.sessionId||r.status==='paid'||r.status==='expired')return null;
  const last=notes.get(c.id), t=now().getTime();
  if(last&&t-last.at<PAGE_ASK_MS)return last.said==='unpaid'?'unpaid':null;
  // A look that may not ask says nothing: the page shows what is stored, and the webhook and the sweep go on as before.
  const recent=(pageAsks.get(viewerId)??[]).filter(at=>t-at<ACCOUNT_ASKS_MS);
  if(recent.length>=ACCOUNT_ASKS)return null;
  pageAsks.set(viewerId,[...recent,t]);
  return await readPayment(c.id,config,2)==='unpaid'?'unpaid':null;
}
/** For tests: forgets what this process noted about its questions to Dodo. */
export function forgetReconciliation():void {notes.clear();named.clear();closed.clear();pageAsks.clear();short.clear();sweeping=false;}
