// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getStore, resetStore } from '../mock/store';
import { balanceOf } from '../mock/ledger';
import { forgetReconciliation, partRefunded, paymentMarks, refundAmountUnknown, paymentsGateway, receivePayment, reconcilePayment, refundUnconfirmed, sendRefund, sweepPayments, SWEEP_ASKS, uncreditedPayments } from './payments-gateway';
import { paymentStore } from './payments-store';
import { paymentWebhook } from './payments/webhook';
import { signDodoWebhook } from './payments/dodo-test-helpers';

/** Everything here is made up. Dodo is the three tables below: what a session, a payment and a refund read back as. */
const KEY='made-up-dodo-test-key-0123456789', SECRET='whsec_'+randomBytes(32).toString('base64'), PRODUCT='pdt_madeupstarter';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
type Row=Record<string,unknown>;
let calls:string[], sessions:Record<string,Row>, payments:Record<string,Row>, refunds:Record<string,Row>, user:string, admin:string, gate:Promise<void>|null, down:(()=>Response)|null;
beforeEach(()=>{
  vi.unstubAllEnvs();
  for(const [name,value] of Object.entries({VC_PAYMENTS:'test',DODO_API_KEY_TEST:KEY,DODO_WEBHOOK_SECRET_TEST:SECRET,PUBLIC_BASE_URL:'http://127.0.0.1:3400',
    DODO_PRODUCT_PACK_STARTER:PRODUCT,DODO_PRODUCT_PACK_STANDARD:'pdt_madeupstandard',DODO_PRODUCT_PACK_STUDIO:'pdt_madeupstudio'}))vi.stubEnv(name,value);
  resetStore();forgetReconciliation();calls=[];sessions={};payments={};refunds={};gate=null;down=null;
  user=getStore().users.find(u=>u.role==='customer')!.id;admin=getStore().users.find(u=>u.role==='admin')!.id;
  vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>{
    const path=new URL(url).pathname, [,table,id]=path.split('/');
    calls.push(`${init.method} ${path}`);
    if(init.method==='POST'&&path==='/checkouts')return down?down():json({session_id:`cks_${calls.length}`,checkout_url:`https://test.checkout.dodopayments.com/session/cks_${calls.length}`});
    if(init.method==='POST'&&path==='/refunds')return down?down():json({refund_id:`ref_${calls.length}`,payment_id:JSON.parse(String(init.body)).payment_id,status:'pending',created_at:'2026-10-07T05:00:00Z'});
    if(gate)await gate;
    if(down)return down();
    const row=table==='checkouts'?sessions[id!]??{id,payment_id:null,payment_status:null}:table==='payments'?payments[id!]:refunds[id!];
    return row?json(row):json({code:'NOT_FOUND'},404);
  });
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});

const open=(returnTo='/gallery')=>paymentsGateway.startCheckout(user,'pack-starter',returnTo);
const record=(checkoutId:string)=>paymentStore().records.find(r=>r.checkoutId===checkoutId)!;
const reads=()=>calls.filter(call=>call.startsWith('GET'));
/** Dodo's own record of a starter pack ($19 + $3.61 tax) paid on the checkout's session. */
function pay(checkoutId:string,over:Row={},paymentId='pay_A'):void {
  const sessionId=record(checkoutId).sessionId;
  payments[paymentId]={payment_id:paymentId,status:'succeeded',total_amount:2261,tax:361,currency:'USD',metadata:{checkout_id:checkoutId},checkout_session_id:sessionId,
    product_cart:[{product_id:PRODUCT,quantity:1}],refunds:[],created_at:'2026-10-07T04:00:00Z',...over};
  sessions[sessionId]={id:sessionId,payment_id:paymentId,payment_status:payments[paymentId]!.status};
}
async function deliver(type:string,data:object,id=`msg_${Math.random()}`){
  const raw=JSON.stringify({business_id:'bus_madeup',type,timestamp:new Date().toISOString(),data}), seconds=Math.floor(Date.now()/1000);
  const headers=new Headers({'webhook-id':id,'webhook-timestamp':String(seconds),'webhook-signature':signDodoWebhook(raw,id,seconds,SECRET)});
  return (await paymentWebhook(new Request('https://site.example/api/payments/webhook',{method:'POST',headers,body:raw}))).status;
}
const notice=(checkoutId:string,paymentId='pay_A')=>({payload_type:'Payment',...payments[paymentId]});
const credited=()=>getStore().purchases.filter(p=>p.userId===user&&p.status==='paid'&&p.amountCents===1900).length;
const later=(ms:number)=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(Date.now()+ms);};

it('the return page\'s read and the sweep hand Dodo\'s answer to the same gate as the webhook: one credit, however often and in whatever order they come',async()=>{
  const before=balanceOf(user), c=await open();
  expect(await reconcilePayment(c.checkoutId,user)).toBe('unpaid');expect(balanceOf(user)).toBe(before);
  pay(c.checkoutId);later(6000);
  expect(await reconcilePayment(c.checkoutId,user)).toBeNull();
  expect(balanceOf(user)).toBe(before+10);expect(record(c.checkoutId)).toMatchObject({status:'paid',paymentId:'pay_A'});
  expect(paymentStore().events.map(e=>e.raw)).toEqual(['dodo-read:payment']);
  for(let n=0;n<3;n++){later(6000);await reconcilePayment(c.checkoutId,user);await sweepPayments();await deliver('payment.succeeded',notice(c.checkoutId));}
  expect(balanceOf(user)).toBe(before+10);expect(credited()).toBe(1);expect(paymentStore().deliveries).toHaveLength(1);
  // Once paid, Dodo is not asked about it again.
  expect(reads()).toEqual(['GET /checkouts/cks_1','GET /checkouts/cks_1','GET /payments/pay_A']);
});
it('a webhook, the return page and the sweep that arrive together for one payment write its credits once',async()=>{
  const before=balanceOf(user), c=await open();pay(c.checkoutId);
  let release=()=>{};gate=new Promise(resolve=>{release=resolve;});
  const together=[reconcilePayment(c.checkoutId,user),sweepPayments(),deliver('payment.succeeded',notice(c.checkoutId)),sweepPayments(),reconcilePayment(c.checkoutId,user)];
  release();await Promise.all(together);
  gate=null;later(6000);await Promise.all([sweepPayments(),reconcilePayment(c.checkoutId,user),deliver('payment.succeeded',notice(c.checkoutId))]);
  expect(balanceOf(user)).toBe(before+10);expect(credited()).toBe(1);expect(paymentStore().deliveries).toHaveLength(1);
  expect(getStore().ledger.filter(e=>e.userId===user&&e.type==='purchase'&&e.change===10)).toHaveLength(1);
});
it('the sweep alone credits a payment whose webhook never came: it asks the session in one tour and the payment in the next, one request each',async()=>{
  const before=balanceOf(user), c=await open();pay(c.checkoutId);
  await sweepPayments();expect(reads()).toEqual(['GET /checkouts/cks_1']);expect(balanceOf(user)).toBe(before);
  await sweepPayments();expect(reads()).toEqual(['GET /checkouts/cks_1','GET /payments/pay_A']);
  expect(balanceOf(user)).toBe(before+10);expect(record(c.checkoutId).status).toBe('paid');
  await sweepPayments();await sweepPayments();expect(reads()).toHaveLength(2);
});
it.each<[string,Row,string]>([
  ['in another currency',{currency:'EUR'},'payment-review:currency:'],['of nothing',{total_amount:0,tax:0},'payment-review:amount:'],['below the price',{total_amount:2260},'payment-review:amount:'],
  ['without a reported tax',{tax:null,total_amount:1900},'payment-review:tax-unknown:'],['of another product',{product_cart:[{product_id:'pdt_madeupstudio',quantity:1}]},'payment-review:cart:'],
  ['on another session',{checkout_session_id:'cks_of_someone_else'},'reconcile-refused:payment-binding-mismatch:'],['on no session',{checkout_session_id:null},'reconcile-refused:payment-binding-mismatch:'],
  ['that names another checkout',{metadata:{checkout_id:'another-checkout'}},'reconcile-refused:checkout-mismatch:'],['that names no checkout',{metadata:{}},'reconcile-refused:checkout-mismatch:'],
])('a payment %s is read exactly as strictly as its webhook: no credit, and the owner is told',async(_name,over,marker)=>{
  const before=balanceOf(user), c=await open();pay(c.checkoutId,over);
  await reconcilePayment(c.checkoutId,user);await sweepPayments();await sweepPayments();
  expect(balanceOf(user)).toBe(before);expect(record(c.checkoutId)).toMatchObject({status:'pending',purchaseId:null});
  expect(paymentStore().attention).toEqual([marker+c.checkoutId]);
  // The same payment read correctly later is credited once.
  pay(c.checkoutId);await sweepPayments();await sweepPayments();
  expect(balanceOf(user)).toBe(before+10);expect(credited()).toBe(1);
});
it('a payment with more tax than money, or one Dodo answers about under another id, is no answer at all: nothing changes and nothing is credited',async()=>{
  const before=balanceOf(user), c=await open();
  for(const over of [{tax:5000},{payment_id:'pay_other'},{status:'paid-in-full'},{total_amount:-1}]){
    pay(c.checkoutId,over);forgetReconciliation();
    const untouched=JSON.stringify(getStore());
    await reconcilePayment(c.checkoutId,user);
    expect(JSON.stringify(getStore()),JSON.stringify(over)).toBe(untouched);
  }
  expect(balanceOf(user)).toBe(before);
});
it('one checkout\'s read never credits another: each record is paid only by the payment of its own session',async()=>{
  const before=balanceOf(user), mine=await open(), other=await open('/other');
  pay(other.checkoutId);
  // Dodo (or someone in between) answers the question about my session with the other checkout's payment.
  sessions[record(mine.checkoutId).sessionId]={id:record(mine.checkoutId).sessionId,payment_id:'pay_A',payment_status:'succeeded'};
  await reconcilePayment(mine.checkoutId,user);
  expect(balanceOf(user)).toBe(before);expect(record(mine.checkoutId).status).toBe('pending');expect(record(other.checkoutId).status).toBe('pending');
  await expect(reconcilePayment(mine.checkoutId,admin)).rejects.toThrow('not-found');
  await expect(reconcilePayment('no-such-checkout',user)).rejects.toThrow('not-found');
});
it('a refused card, a cancelled payment and one still in work are read as what they are; the attempt that pays afterwards is found by asking the session again',async()=>{
  const before=balanceOf(user), c=await open();
  pay(c.checkoutId,{status:'processing'});await reconcilePayment(c.checkoutId,user);
  expect(record(c.checkoutId)).toMatchObject({status:'pending',paymentId:'pay_A'});
  pay(c.checkoutId,{status:'failed'});await sweepPayments();
  expect(record(c.checkoutId)).toMatchObject({status:'declined',paymentId:'pay_A'});
  pay(c.checkoutId,{status:'requires_customer_action'},'pay_B');await sweepPayments();await sweepPayments();
  expect(record(c.checkoutId)).toMatchObject({status:'declined',paymentId:'pay_A'});
  pay(c.checkoutId,{},'pay_C');await sweepPayments();await sweepPayments();
  expect(record(c.checkoutId)).toMatchObject({status:'paid',paymentId:'pay_C'});expect(balanceOf(user)).toBe(before+10);
});
it('when Dodo fails or does not answer, the record stays as it is, nothing is tried twice, and the next tour asks again',async()=>{
  const before=balanceOf(user), c=await open();pay(c.checkoutId);
  const untouched=JSON.stringify(paymentStore());
  for(const failure of [()=>json({code:'INTERNAL'},500),()=>new Response('<html>'),()=>json({},404),()=>{throw Object.assign(new Error('made-up-timeout'),{name:'TimeoutError'});},()=>{throw new TypeError('fetch failed');}]){
    down=failure;calls=[];
    await sweepPayments();
    expect(reads()).toEqual(['GET /checkouts/cks_1']);expect(JSON.stringify(paymentStore())).toBe(untouched);
  }
  down=null;await sweepPayments();await sweepPayments();
  expect(balanceOf(user)).toBe(before+10);
});
it('a tour asks about at most ten records, one request each, the longest unasked first; a tour that still waits for Dodo is not joined by the next',async()=>{
  const ids:string[]=[];for(let n=0;n<SWEEP_ASKS+3;n++)ids.push((await open(`/gallery?n=${n}`)).checkoutId);
  calls=[];await sweepPayments();
  expect(reads()).toEqual(ids.slice(0,SWEEP_ASKS).map(id=>`GET /checkouts/${record(id).sessionId}`));
  calls=[];await sweepPayments();
  expect(reads()).toEqual([...ids.slice(SWEEP_ASKS),...ids.slice(0,SWEEP_ASKS-3)].map(id=>`GET /checkouts/${record(id).sessionId}`));
  let release=()=>{};gate=new Promise(resolve=>{release=resolve;});calls=[];
  const slow=sweepPayments();await sweepPayments();await sweepPayments();
  release();await slow;
  expect(reads()).toHaveLength(SWEEP_ASKS);
});
it('only unresolved checkouts are asked about: not a paid one, and not one whose opening call never answered (it has no session to ask for)',async()=>{
  const paid=await open();pay(paid.checkoutId);await reconcilePayment(paid.checkoutId,user);
  down=()=>json({},500);await open('/never-opened').catch(()=>undefined);down=null;
  expect(paymentStore().records.map(r=>[r.status,r.sessionId])).toEqual([['paid','cks_1'],['pending','']]);
  calls=[];await sweepPayments();await sweepPayments();
  expect(reads()).toEqual([]);
});
it('a session that ran out is asked once more and then closed: unpaid it expires quietly, paid at the last minute it is credited',async()=>{
  const before=balanceOf(user), left=await open('/left'), late=await open('/late');
  later(25*3600000);pay(late.checkoutId);
  await sweepPayments();await sweepPayments();
  expect(record(left.checkoutId).status).toBe('expired');expect(record(late.checkoutId).status).toBe('paid');expect(balanceOf(user)).toBe(before+10);
  calls=[];await sweepPayments();await sweepPayments();expect(reads()).toEqual([]);
  expect(paymentStore().attention).toEqual([]);
});
it('a payment still in work when its session runs out is not closed: it is read again until Dodo says how it ended',async()=>{
  const before=balanceOf(user), c=await open();
  later(25*3600000);pay(c.checkoutId,{status:'processing'});
  for(let n=0;n<3;n++)await sweepPayments();
  expect(record(c.checkoutId).status).toBe('pending');
  pay(c.checkoutId);await sweepPayments();
  expect(record(c.checkoutId).status).toBe('paid');expect(balanceOf(user)).toBe(before+10);
});
it('while a question to Dodo is on its way, a second look at the same checkout says nothing: "nobody paid" is only ever Dodo\'s own answer',async()=>{
  const c=await open();pay(c.checkoutId);
  let release=()=>{};gate=new Promise(resolve=>{release=resolve;});
  const first=reconcilePayment(c.checkoutId,user);
  expect(await reconcilePayment(c.checkoutId,user)).toBeNull();
  release();expect(await first).toBeNull();
  expect(record(c.checkoutId).status).toBe('paid');
});
it('a checkout Dodo could not be asked about is not asked for ever: three days after its session ran out it expires uncredited and goes before the owner',async()=>{
  const before=balanceOf(user), c=await open();pay(c.checkoutId);
  down=()=>json({},503);
  later(25*3600000);await sweepPayments();
  expect(record(c.checkoutId).status).toBe('pending');expect(reads()).toHaveLength(1);
  later(3*86400000);calls=[];await sweepPayments();await sweepPayments();
  expect(reads()).toEqual([]);expect(record(c.checkoutId).status).toBe('expired');expect(balanceOf(user)).toBe(before);
  expect(paymentStore().attention).toEqual([`reconcile-gave-up:${c.checkoutId}`]);
  expect(uncreditedPayments()).toMatchObject([{checkoutId:c.checkoutId,userId:user,packName:'Starter',reason:'gave-up'}]);
});
it('in fake mode the sweep never asks Dodo, also not about checkouts Dodo opened; live mode is refused',async()=>{
  const c=await open();pay(c.checkoutId);
  vi.stubEnv('VC_PAYMENTS','fake');vi.stubEnv('VC_PAYMENTS_WEBHOOK_SECRET',randomBytes(32).toString('hex'));
  calls=[];await sweepPayments();await sweepPayments();expect(await reconcilePayment(c.checkoutId,user)).toBeNull();
  expect(calls).toEqual([]);expect(record(c.checkoutId).status).toBe('pending');
  vi.stubEnv('VC_PAYMENTS','live');
  await expect(sweepPayments()).rejects.toThrow();await expect(reconcilePayment(c.checkoutId,user)).rejects.toThrow();
  expect(calls).toEqual([]);
});
const fakeMode=()=>{vi.stubEnv('VC_PAYMENTS','fake');vi.stubEnv('VC_PAYMENTS_WEBHOOK_SECRET',randomBytes(32).toString('hex'));};
/** In fake mode: a starter pack the fake provider was paid for, whose refund was asked for and sent. */
async function fakeRefundSent(){
  fakeMode();
  const c=await open(), r=record(c.checkoutId);
  receivePayment({eventId:'made-up-paid',checkoutId:c.checkoutId,providerSessionId:r.sessionId,providerPaymentId:r.paymentId,kind:'paid',amountMinor:1900,currency:'USD',occurredAt:new Date().toISOString()},'made-up');
  const p=getStore().purchases.find(row=>row.userId===user&&row.status==='paid'&&row.amountCents===1900)!;
  await paymentsGateway.requestRefund(user,p.id);
  const held=balanceOf(user);
  await sendRefund(admin,p.id,'asked','first');
  return {c,p,held};
}
it('in fake mode a refund that was sent is never asked about at Dodo, whatever its id looks like: tour after tour makes no request and reaches no Dodo adapter, and the refund stays sent',async()=>{
  const {c,p,held}=await fakeRefundSent();
  // The fake's own ids could never be sent to Dodo. It is the mode that keeps the tour away, so the refund is given an id Dodo's adapter would take.
  record(c.checkoutId).refundId='ref_madeup_like_one_of_dodos';
  for(let n=0;n<3;n++)await sweepPayments();
  expect(calls).toEqual([]);expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refund-sent');expect(balanceOf(user)).toBe(held);
});
it('in fake mode a refund that was sent days ago is not put before the owner as overdue: the fake provider says how a refund ended only when someone makes it, so the admin\'s list carries no "three days" warning and no note of it is kept',async()=>{
  const {p,held}=await fakeRefundSent();
  later(4*86400000);
  for(let n=0;n<2;n++)await sweepPayments();
  expect(paymentMarks().get(p.id)).toBeUndefined();expect(paymentStore().attention.filter(note=>note.startsWith('stale-refund'))).toEqual([]);
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refund-sent');expect(balanceOf(user)).toBe(held);expect(calls).toEqual([]);
});
it('in fake mode "Check again" and the return page read the fake provider\'s own record and never Dodo: a payment whose notice was lost is credited from it once, and an unpaid checkout is never said to be unpaid by Dodo',async()=>{
  fakeMode();
  const before=balanceOf(user), c=await open();
  expect(await reconcilePayment(c.checkoutId,user)).toBeNull();expect(balanceOf(user)).toBe(before);
  // The fake provider's page wrote "paid" on its record, and the notice of it never arrived.
  Object.assign(record(c.checkoutId),{providerStatus:'paid',providerOccurredAt:new Date().toISOString()});
  for(let n=0;n<2;n++)expect(await reconcilePayment(c.checkoutId,user)).toBeNull();
  expect(balanceOf(user)).toBe(before+10);expect(credited()).toBe(1);expect(paymentStore().events.map(e=>e.raw)).toEqual(['manual-reconcile']);
  expect(calls).toEqual([]);
});
it('the return page may be reloaded as fast as one likes: Dodo is asked about a checkout at most once in five seconds',async()=>{
  const c=await open();
  for(let n=0;n<20;n++)expect(await reconcilePayment(c.checkoutId,user)).toBe('unpaid');
  expect(reads()).toHaveLength(1);
  later(6000);await reconcilePayment(c.checkoutId,user);expect(reads()).toHaveLength(2);
});

/** A paid starter pack whose refund was asked for and sent, with Dodo's answer to the refund call as given. */
async function refundSent(answer:(()=>Response)|null){
  const c=await open();pay(c.checkoutId);await reconcilePayment(c.checkoutId,user);
  const p=getStore().purchases.find(row=>row.userId===user&&row.status==='paid'&&row.amountCents===1900)!;
  await paymentsGateway.requestRefund(user,p.id);
  const held=balanceOf(user);
  down=answer;await sendRefund(admin,p.id,'asked','first');down=null;calls=[];
  return {c,p,held,status:()=>getStore().purchases.find(row=>row.id===p.id)!.status};
}
const timeout=():never=>{throw Object.assign(new Error('made-up-timeout'),{name:'TimeoutError'});};
it.each([['succeeded','refunded',0],['failed','refund-failed',10]] as const)('a sent refund whose notice never came is settled by reading it: %s at Dodo is %s here, once',async(status,settled,back)=>{
  const {c,held,status:now}=await refundSent(null), refundId=record(c.checkoutId).refundId!;
  refunds[refundId]={refund_id:refundId,payment_id:'pay_A',status:'pending',amount:2261,currency:'USD',created_at:'2026-10-07T05:00:00Z'};
  await sweepPayments();expect(now()).toBe('refund-sent');
  refunds[refundId]!.status=status;
  for(let n=0;n<3;n++)await sweepPayments();
  expect(now()).toBe(settled);expect(balanceOf(user)).toBe(held+back);
  expect(reads()).toEqual([`GET /refunds/${refundId}`,`GET /refunds/${refundId}`]);
});
const toldRefunded=(purchaseId:string)=>getStore().outbox.filter(m=>m.kind==='payment'&&m.data.refund==='true'&&m.data.purchaseId===purchaseId).length;
/** Dodo's word on the refund that was sent from here, as its notice and as the answer to a read of it. */
const ours=(checkoutId:string,over:Row)=>({refund_id:record(checkoutId).refundId!,payment_id:'pay_A',status:'succeeded',amount:2261,currency:'USD',...over});
const noticeOf=(checkoutId:string,over:Row)=>deliver('refund.succeeded',{payload_type:'Refund',...ours(checkoutId,over),metadata:{checkout_id:checkoutId}});
const readOf=(checkoutId:string,over:Row)=>{refunds[record(checkoutId).refundId!]={...ours(checkoutId,over),created_at:'2026-10-07T05:00:00Z'};};
it.each<[string,boolean,Row]>([['its notice says so, and then the read',true,{amount:1761,is_partial:true}],['only the read says so',false,{amount:1761,is_partial:true}],['Dodo does not call it a part',true,{amount:1761,is_partial:false}],
  ['only the read says so, and Dodo does not call it a part',false,{amount:1761}],['Dodo calls it a part and names the whole sum, in a read',false,{is_partial:true}],['the read names no amount at all',false,{amount:null}],
  ['its notice names a sum in another currency',true,{amount:190000,currency:'INR'}],['the read names a sum in another currency',false,{amount:190000,currency:'INR'}]])
('a refund sent from here that did not give back all the buyer paid is not "refunded", whoever tells it (%s): the notice and the read decide alike, it waits for the owner and the buyer is told nothing',async(_name,noticed,over)=>{
  const {c,p,held,status}=await refundSent(null);
  readOf(c.checkoutId,over);
  if(noticed)expect(await noticeOf(c.checkoutId,over)).toBe(200);
  for(let n=0;n<2;n++)await sweepPayments();
  expect(status()).toBe('refund-sent');expect(balanceOf(user)).toBe(held);expect(toldRefunded(p.id)).toBe(0);
  expect(paymentMarks().get(p.id)).toBe('refund-review');expect(paymentStore().attention).toEqual([`refund-review:${c.checkoutId}`]);
});
it.each([['its notice',true],['the read',false]])('a refund sent from here for what was left after a part went back in the Dodo panel settles: with the part that is known it is all the buyer paid, so %s makes it "refunded" once, though Dodo calls each a part',async(_name,noticed)=>{
  const {c,p,held,status}=await refundSent(null);
  await deliver('refund.succeeded',{payload_type:'Refund',refund_id:'ref_part',payment_id:'pay_A',status:'succeeded',amount:500,currency:'USD',is_partial:true,metadata:{}});
  expect(status()).toBe('refund-sent');
  readOf(c.checkoutId,{amount:1761,is_partial:true});
  // Each alone settles it, and the other one coming afterwards changes nothing more.
  if(noticed)await noticeOf(c.checkoutId,{amount:1761,is_partial:true});else await sweepPayments();
  expect(status()).toBe('refunded');expect(toldRefunded(p.id)).toBe(1);
  await sweepPayments();await noticeOf(c.checkoutId,{amount:1761,is_partial:true});
  expect(status()).toBe('refunded');expect(balanceOf(user)).toBe(held);expect(toldRefunded(p.id)).toBe(1);expect(returned(p.id)).toBe(0);
});
it('a refund sent from here that waits because the read of it named no amount is looked at again when a later read names it: read with all the buyer paid it is "refunded" once, no read is refused as a changed event, and the same answer read again is not kept twice',async()=>{
  const {c,p,held,status}=await refundSent(null);
  readOf(c.checkoutId,{amount:null});
  for(let n=0;n<2;n++)await sweepPayments();
  expect(status()).toBe('refund-sent');expect(paymentMarks().get(p.id)).toBe('refund-review');expect(paymentStore().events.filter(e=>e.raw==='dodo-read:refund')).toHaveLength(1);
  readOf(c.checkoutId,{});
  for(let n=0;n<2;n++)await sweepPayments();
  expect(status()).toBe('refunded');expect(toldRefunded(p.id)).toBe(1);expect(balanceOf(user)).toBe(held);expect(returned(p.id)).toBe(0);
  expect(paymentStore().attention).toEqual([`refund-review:${c.checkoutId}`]);expect(paymentStore().events.filter(e=>e.raw==='dodo-read:refund')).toHaveLength(2);
});
it.each([['only the read',false],['its notice and the read',true]])('a refund sent from here for what was left, told by %s before the part that went back in the Dodo panel was known, waits; once that part is told the next read looks at the refund again, and it is "refunded" once',async(_name,noticed)=>{
  const {c,p,held,status}=await refundSent(null);
  readOf(c.checkoutId,{amount:1761,is_partial:true});
  if(noticed)await noticeOf(c.checkoutId,{amount:1761,is_partial:true});
  await sweepPayments();
  expect(status()).toBe('refund-sent');expect(toldRefunded(p.id)).toBe(0);
  await deliver('refund.succeeded',{payload_type:'Refund',refund_id:'ref_part',payment_id:'pay_A',status:'succeeded',amount:500,currency:'USD',is_partial:true,metadata:{}});
  expect(status()).toBe('refund-sent');
  for(let n=0;n<2;n++)await sweepPayments();
  expect(status()).toBe('refunded');expect(toldRefunded(p.id)).toBe(1);expect(balanceOf(user)).toBe(held);expect(returned(p.id)).toBe(0);
});
const panelPart=()=>deliver('refund.succeeded',{payload_type:'Refund',refund_id:'ref_part',payment_id:'pay_A',status:'succeeded',amount:500,currency:'USD',is_partial:true,metadata:{}});
it.each<[string,(()=>Response)|null,(checkoutId:string)=>Promise<unknown>]>([
  ['a part went back in the Dodo panel before it',null,async id=>{await panelPart();await noticeOf(id,{amount:1761,is_partial:true});}],
  ['a read of it named no amount before its notice named all of it',null,async id=>{readOf(id,{amount:null});await sweepPayments();await noticeOf(id,{});}],
  ['its call never answered and Dodo listed it without an amount before it listed it with all of it',timeout,async()=>{
    payments.pay_A!.refunds=[{refund_id:'ref_ours',status:'succeeded'}];await sweepPayments();
    payments.pay_A!.refunds=[{refund_id:'ref_ours',status:'succeeded',amount:2261}];await sweepPayments();}],
])('once a refund sent from here is "refunded" nothing of it is left before the owner (%s): the mark that waited on the purchase is gone with it',async(_name,answer,tell)=>{
  const {c,p,status}=await refundSent(answer);
  await tell(c.checkoutId);
  expect(status()).toBe('refunded');expect(toldRefunded(p.id)).toBe(1);
  expect(record(c.checkoutId).flag).toBeUndefined();expect(paymentMarks().has(p.id)).toBe(false);
});
it('a refund sent from here that is "refunded" while the whole payment also went back in another refund at Dodo stays before the owner: two refunds of one payment are not settled by themselves',async()=>{
  const {c,p,status}=await refundSent(null);
  await deliver('refund.succeeded',{payload_type:'Refund',refund_id:'ref_panel',payment_id:'pay_A',status:'succeeded',amount:2261,currency:'USD',metadata:{}});
  expect(status()).toBe('refund-sent');
  await noticeOf(c.checkoutId,{});
  expect(status()).toBe('refunded');expect(record(c.checkoutId)).toMatchObject({flag:'refund-review',outsideRefundId:'ref_panel'});expect(paymentMarks().has(p.id)).toBe(true);
});
it('a failure that is not Dodo\'s is not swallowed while a sent refund is read either: the tour fails aloud, nothing is half settled, and the next tour settles the refund once',async()=>{
  const {c,p,held,status}=await refundSent(null), refundId=record(c.checkoutId).refundId!;
  refunds[refundId]={refund_id:refundId,payment_id:'pay_A',status:'failed',amount:2261,currency:'USD',created_at:'2026-10-07T05:00:00Z'};
  vi.spyOn(globalThis,'structuredClone').mockImplementationOnce(()=>{throw new Error('made-up-storage-failure');});
  await expect(sweepPayments()).rejects.toThrow('made-up-storage-failure');
  vi.restoreAllMocks();
  expect(reads()).toEqual([`GET /refunds/${refundId}`]);expect(status()).toBe('refund-sent');expect(balanceOf(user)).toBe(held);
  for(let n=0;n<2;n++)await sweepPayments();
  expect(status()).toBe('refund-failed');expect(balanceOf(user)).toBe(held+10);
  expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='returned')).toHaveLength(1);
});
it('a refund Dodo answers about under another payment settles nothing',async()=>{
  const {c,p,held,status}=await refundSent(null), refundId=record(c.checkoutId).refundId!;
  refunds[refundId]={refund_id:refundId,payment_id:'pay_other',status:'failed',created_at:'2026-10-07T05:00:00Z'};
  await sweepPayments();
  expect(status()).toBe('refund-sent');expect(balanceOf(user)).toBe(held);
  // The owner sees it on the purchase, not only in a note nobody reads.
  expect(paymentMarks().get(p.id)).toBe('refund-review');expect(paymentStore().attention).toEqual([`reconcile-refused:payment-binding-mismatch:${c.checkoutId}`]);
});
it.each<[string,()=>Response]>([['never answered',timeout],['was answered "this payment has a refund already"',()=>json({code:'PAYMENT_ALREADY_REFUNDED'},422)]])
('a refund whose call %s is settled from the payment\'s own list of refunds: the buyer gets the money or the credits, never both',async(_name,answer)=>{
  const {c,held,status}=await refundSent(answer);
  expect(record(c.checkoutId).refundId).toBeUndefined();
  payments.pay_A!.refunds=[{refund_id:'ref_at_dodo',status:'pending',amount:2261}];
  later(2*3600000);await sweepPayments();
  expect(status()).toBe('refund-sent');expect(balanceOf(user)).toBe(held);
  payments.pay_A!.refunds=[{refund_id:'ref_at_dodo',status:'succeeded',amount:2261}];
  for(let n=0;n<3;n++)await sweepPayments();
  expect(status()).toBe('refunded');expect(record(c.checkoutId).refundId).toBe('ref_at_dodo');expect(balanceOf(user)).toBe(held);
  expect(reads()).toEqual(['GET /payments/pay_A','GET /payments/pay_A']);
});
it('a refund Dodo never received gives the credits back once, but only an hour after it was sent: a call that timed out may still arrive',async()=>{
  const {p,held,status}=await refundSent(timeout);
  await sweepPayments();later(3500000);await sweepPayments();
  expect(status()).toBe('refund-sent');expect(balanceOf(user)).toBe(held);
  later(200000);for(let n=0;n<3;n++)await sweepPayments();
  expect(status()).toBe('refund-failed');expect(balanceOf(user)).toBe(held+10);
  expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='returned')).toHaveLength(1);
  expect(paymentStore().attention).toContain(`refund-not-found:${p.id}`);
  // The admin may send it again, and the new refund is read like any other.
  await sendRefund(admin,p.id,'again','second');expect(status()).toBe('refund-sent');expect(balanceOf(user)).toBe(held);
});
it.each<[string,()=>Response]>([['a wrong key',()=>json({code:'UNAUTHORIZED'},401)],['too many requests',()=>json({},429)],['a refusal it does not name as "no refund"',()=>json({code:'NOTHING_TO_REFUND'},409)],['a failure of its own',()=>json({code:'REFUND_WINDOW_EXPIRED'},500)]])
('a refund Dodo answered with %s does not hang for ever: the payment\'s own list of refunds is read, and an empty one gives the credits back once and lets the admin send again',async(_name,answer)=>{
  const {c,p,held,status}=await refundSent(answer);
  expect(status()).toBe('refund-sent');expect(record(c.checkoutId).refundId).toBeUndefined();expect(paymentStore().attention).toContain(`refund-unknown:${p.id}`);
  // Nothing is given back on a guess: not before Dodo was read, and not while it cannot be read.
  later(2*3600000);down=()=>json({},503);await sweepPayments();
  expect(status()).toBe('refund-sent');expect(balanceOf(user)).toBe(held);
  down=null;for(let n=0;n<3;n++)await sweepPayments();
  expect(status()).toBe('refund-failed');expect(balanceOf(user)).toBe(held+10);
  expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='returned')).toHaveLength(1);
  later(4*86400000);await sweepPayments();
  expect(paymentStore().attention.filter(mark=>mark.startsWith('stale-refund'))).toEqual([]);
  expect((await sendRefund(admin,p.id,'again','second')).outcome).toBe('done');expect(status()).toBe('refund-sent');expect(balanceOf(user)).toBe(held);
});
it('"Dodo has no such refund" is applied only to the attempt that was asked about: a new attempt sent meanwhile stays sent',async()=>{
  const {c,held,status}=await refundSent(timeout);
  later(2*3600000);
  let release=()=>{};gate=new Promise(resolve=>{release=resolve;});
  const tour=sweepPayments();
  // While Dodo is being asked, the first attempt fails and the admin sends a second one.
  await Promise.resolve();record(c.checkoutId).refundAttempt=2;
  release();await tour;
  expect(status()).toBe('refund-sent');expect(balanceOf(user)).toBe(held);
});
it('a part of the money that went back is not the whole refund: nothing settles, the credits stay out and the owner is told',async()=>{
  const {c,held,status}=await refundSent(timeout);
  payments.pay_A!.refunds=[{refund_id:'ref_part',status:'succeeded',amount:500}];
  later(2*3600000);await sweepPayments();
  expect(status()).toBe('refund-sent');expect(balanceOf(user)).toBe(held);expect(record(c.checkoutId).flag).toBe('refund-review');
});
it('a refund of an earlier attempt is not taken for the one that is out now',async()=>{
  const {c,p,held,status}=await refundSent(null), first=record(c.checkoutId).refundId!;
  refunds[first]={refund_id:first,payment_id:'pay_A',status:'failed',created_at:'2026-10-07T05:00:00Z'};
  await sweepPayments();expect(status()).toBe('refund-failed');
  down=timeout;await sendRefund(admin,p.id,'again','second');down=null;
  payments.pay_A!.refunds=[{refund_id:first,status:'succeeded',amount:2261}];
  later(1800000);await sweepPayments();
  expect(status()).toBe('refund-sent');expect(balanceOf(user)).toBe(held);
  later(3600000);await sweepPayments();
  expect(status()).toBe('refund-failed');expect(balanceOf(user)).toBe(held+10);
});
it('a pack frozen by a panel refund is closed by the admin\'s refund itself, with no call to Dodo that could go unanswered: nothing waits for the next read, the panel refund is the refund, and the mark is gone',async()=>{
  const c=await open();pay(c.checkoutId);await reconcilePayment(c.checkoutId,user);
  const p=getStore().purchases.find(row=>row.userId===user&&row.status==='paid'&&row.amountCents===1900)!, balance=balanceOf(user);
  await deliver('refund.succeeded',{payload_type:'Refund',refund_id:'ref_panel',payment_id:'pay_A',status:'succeeded',amount:2261,currency:'USD',metadata:{}});
  expect(p.status).toBe('refund-requested');expect(record(c.checkoutId).flag).toBe('refund-review');expect(balanceOf(user)).toBe(balance-10);
  down=timeout;await sendRefund(admin,p.id,'refunded in the panel','first');down=null;
  expect(p.status).toBe('refunded');expect(calls.filter(call=>call==='POST /refunds')).toHaveLength(0);
  payments.pay_A!.refunds=[{refund_id:'ref_panel',status:'succeeded',amount:2261}];
  await sweepPayments();
  expect(p.status).toBe('refunded');expect(balanceOf(user)).toBe(balance-10);
  expect(record(c.checkoutId)).toMatchObject({refundId:'ref_panel'});expect(record(c.checkoutId).flag).toBeUndefined();
});
it('a panel refund whose notice came before its payment was known is not lost when the sweep credits that payment: the credits are written frozen',async()=>{
  const before=balanceOf(user), c=await open();pay(c.checkoutId);
  // Not stored yet: Dodo is asked to deliver it again, and the note of it is kept.
  expect(await deliver('refund.succeeded',{payload_type:'Refund',refund_id:'ref_panel',payment_id:'pay_A',status:'succeeded',amount:2261,currency:'USD',metadata:{}},'msg_early')).toBe(503);
  await sweepPayments();await sweepPayments();
  const p=getStore().purchases.find(row=>row.userId===user&&row.amountCents===1900)!;
  expect(p.status).toBe('refund-requested');expect(balanceOf(user)).toBe(before);
  expect(record(c.checkoutId)).toMatchObject({status:'paid',flag:'refund-review',outsideRefundId:'ref_panel'});
  await expect(paymentsGateway.cancelRefund(user,p.id)).rejects.toThrow('refund-needs-owner');
  // The same notice delivered again finds the payment and changes nothing more.
  expect(await deliver('refund.succeeded',{payload_type:'Refund',refund_id:'ref_panel',payment_id:'pay_A',status:'succeeded',amount:2261,currency:'USD',metadata:{}},'msg_early')).toBe(200);
  expect(p.status).toBe('refund-requested');expect(balanceOf(user)).toBe(before);expect(paymentStore().attention).toEqual([`refund-review:${c.checkoutId}`]);
});
it('a read never credits without Dodo\'s own facts: the port still takes nothing from a caller',async()=>{
  const before=balanceOf(user), c=await open();
  receivePayment({eventId:'read:forged',checkoutId:c.checkoutId,providerSessionId:'cks_1',providerPaymentId:'pay_A',kind:'paid',amountMinor:1900,currency:'USD',occurredAt:new Date().toISOString()},'dodo-read:payment');
  expect(balanceOf(user)).toBe(before);
});
const starter=()=>getStore().purchases.find(row=>row.userId===user&&row.amountCents===1900)!;
it.each<[string,Row[]]>([['in one refund',[{refund_id:'ref_panel',status:'succeeded',amount:2261}]],
  ['in parts that add up to it',[{refund_id:'ref_part',status:'succeeded',amount:1000},{refund_id:'ref_failed',status:'failed',amount:2261},{refund_id:'ref_panel',status:'succeeded',amount:1261}]]])
('a payment that is read for the first time when all of its money already went back %s is credited frozen and marked, as its refund notice would have done: no credit is left to spend',async(_name,refunds)=>{
  const before=balanceOf(user), c=await open();pay(c.checkoutId,{refunds});
  await reconcilePayment(c.checkoutId,user);
  const p=starter();
  expect(p.status).toBe('refund-requested');expect(balanceOf(user)).toBe(before);
  expect(record(c.checkoutId)).toMatchObject({status:'paid',flag:'refund-review',outsideRefundId:'ref_panel'});
  expect(paymentStore().attention).toEqual([`refund-review:${c.checkoutId}`]);
  await expect(paymentsGateway.cancelRefund(user,p.id)).rejects.toThrow('refund-needs-owner');
  // The way out is the one of any pack a panel refund froze: the admin's refund, which the next read finds in Dodo's list.
  down=timeout;await sendRefund(admin,p.id,'refunded in the panel','first');down=null;
  later(60000);await sweepPayments();
  expect(starter().status).toBe('refunded');expect(balanceOf(user)).toBe(before);expect(record(c.checkoutId).flag).toBeUndefined();
});
it.each<[string,Row]>([['in a refund Dodo gives no amount for',{refund_id:'ref_panel',status:'succeeded'}],['in a refund Dodo gives null for its amount',{refund_id:'ref_panel',status:'succeeded',amount:null}],
  ['in a refund Dodo lists in another currency than the payment\'s',{refund_id:'ref_panel',status:'succeeded',amount:190000,currency:'INR'}]])
('a payment that is read for the first time when money of it went back %s keeps its credits: how much went back is not known, so it is not taken for the whole payment, nothing is frozen, no amount is written for it, and it goes before the owner as a refund of unknown amount',async(_name,listed)=>{
  const before=balanceOf(user), c=await open();pay(c.checkoutId,{refunds:[listed]});
  await reconcilePayment(c.checkoutId,user);
  const p=starter();
  expect(p.status).toBe('paid');expect(balanceOf(user)).toBe(before+10);
  expect(record(c.checkoutId)).toMatchObject({status:'paid',flag:'refund-review',outsideRefunds:[{id:'ref_panel',amountMinor:null}]});expect(record(c.checkoutId).outsideRefundId).toBeUndefined();
  expect(paymentMarks().get(p.id)).toBe('refund-review');expect(partRefunded(p.id)).toBe(0);expect(refundAmountUnknown(p.id)).toBe(true);
  expect(paymentStore().attention).toEqual([`refund-review:${c.checkoutId}`]);
  // With credits spent nothing closes it from here: the admin's refund is refused, and what is left stays.
  getStore().ledger.push({...getStore().ledger.find(e=>e.relatedPurchaseId===p.id&&e.type==='purchase')!,id:'spent-one',type:'generation',change:-1,from:[{lot:p.id,credits:1}]} as never);
  starter().status='refund-requested';
  await expect(sendRefund(admin,p.id,'asked','first')).rejects.toThrow('credits-used');
  starter().status='paid';
  // The same refund told again with its amount is known from then on: all that was paid, so the pack is frozen like any whole refund.
  await deliver('refund.succeeded',{payload_type:'Refund',refund_id:'ref_panel',payment_id:'pay_A',status:'succeeded',amount:2261,currency:'USD',metadata:{}});
  expect(record(c.checkoutId)).toMatchObject({outsideRefundId:'ref_panel',outsideRefunds:[{id:'ref_panel',amountMinor:2261}]});
  expect(starter().status).toBe('refund-requested');expect(refundAmountUnknown(p.id)).toBe(false);expect(paymentMarks().get(p.id)).toBe('refund-outside');
});
it('a sent refund whose id is not known is not settled by a refund Dodo lists without an amount: it is not known to be the whole payment, so the refund stays sent, its credits stay out, the buyer is told nothing and the owner sees it',async()=>{
  const {c,p,held,status}=await refundSent(timeout);
  payments.pay_A!.refunds=[{refund_id:'ref_at_dodo',status:'succeeded'}];
  later(2*3600000);for(let n=0;n<2;n++)await sweepPayments();
  expect(status()).toBe('refund-sent');expect(balanceOf(user)).toBe(held);expect(returned(p.id)).toBe(0);expect(toldRefunded(p.id)).toBe(0);
  expect(record(c.checkoutId).refundId).toBeUndefined();expect(paymentMarks().get(p.id)).toBe('refund-review');expect(refundAmountUnknown(p.id)).toBe(true);
});
it.each<[string,Row[],string|undefined]>([['a part of the money went back',[{refund_id:'ref_part',status:'succeeded',amount:500}],'refund-review'],['a refund is still in work',[{refund_id:'ref_open',status:'pending',amount:2261}],'refund-review'],
  ['a refund is with Dodo for review',[{refund_id:'ref_open',status:'review',amount:2261}],'refund-review'],['its only refund failed',[{refund_id:'ref_failed',status:'failed',amount:2261}],undefined]])
('a payment that is read for the first time when %s keeps its credits, because the money is still with us; what may still move goes before the owner',async(_name,refunds,flag)=>{
  const before=balanceOf(user), c=await open();pay(c.checkoutId,{refunds});
  await sweepPayments();await sweepPayments();
  expect(starter().status).toBe('paid');expect(balanceOf(user)).toBe(before+10);
  expect(record(c.checkoutId).flag).toBe(flag);expect(record(c.checkoutId).outsideRefundId).toBeUndefined();
  expect(paymentStore().attention).toEqual(flag?[`refund-review:${c.checkoutId}`]:[]);
});
it('a payment the price rule refuses is not credited for having been refunded: nothing is written, frozen or otherwise',async()=>{
  const before=balanceOf(user), c=await open();pay(c.checkoutId,{currency:'EUR',refunds:[{refund_id:'ref_panel',status:'succeeded',amount:2261}]});
  await reconcilePayment(c.checkoutId,user);
  expect(balanceOf(user)).toBe(before);expect(record(c.checkoutId)).toMatchObject({status:'pending',purchaseId:null});expect(record(c.checkoutId).outsideRefundId).toBeUndefined();
  expect(paymentStore().attention).toEqual([`payment-review:currency:${c.checkoutId}`]);
});
const returned=(purchaseId:string)=>getStore().ledger.filter(e=>e.relatedPurchaseId===purchaseId&&e.type==='returned').length;
it.each([['EXISTING_REFUND_REQUEST_PROCESSING',409],['PAYMENT_ALREADY_REFUNDED',422]])('a refund Dodo answered with %s is not given back when the payment\'s list then shows no refund that went through: one of the two answers is wrong, so the credits stay out and the purchase goes before the owner',async(code,http)=>{
  const {p,held,status}=await refundSent(()=>json({code},http));
  later(3500000);await sweepPayments();
  expect(paymentMarks().get(p.id)).toBe('refund-unknown');
  later(200000);for(let n=0;n<3;n++)await sweepPayments();
  payments.pay_A!.refunds=[{refund_id:'ref_other',status:'failed',amount:2261}];later(60000);await sweepPayments();
  expect(status()).toBe('refund-sent');expect(balanceOf(user)).toBe(held);expect(returned(p.id)).toBe(0);
  expect(paymentStore().attention.filter(mark=>mark.startsWith('refund-conflict'))).toEqual([`refund-conflict:${p.id}`]);
  expect(paymentMarks().get(p.id)).toBe('refund-conflict');
  // The refund Dodo spoke of is listed after all: it is the refund, and nothing is left to look at.
  payments.pay_A!.refunds=[{refund_id:'ref_at_dodo',status:'succeeded',amount:2261}];later(60000);await sweepPayments();
  expect(status()).toBe('refunded');expect(balanceOf(user)).toBe(held);expect(paymentMarks().get(p.id)).toBeUndefined();
});
it('a refund Dodo never received gives the credits back, and a whole refund made in the Dodo panel afterwards freezes them like any other pack',async()=>{
  const {c,p,held,status}=await refundSent(timeout);
  later(2*3600000);await sweepPayments();
  expect(status()).toBe('refund-failed');expect(balanceOf(user)).toBe(held+10);
  await deliver('refund.succeeded',{payload_type:'Refund',refund_id:'ref_panel',payment_id:'pay_A',status:'succeeded',amount:2261,currency:'USD',metadata:{}});
  expect(status()).toBe('refund-requested');expect(balanceOf(user)).toBe(held);
  expect(record(c.checkoutId)).toMatchObject({flag:'refund-review',outsideRefundId:'ref_panel',frozenFrom:'refund-failed'});
  await expect(paymentsGateway.cancelRefund(user,p.id)).rejects.toThrow('refund-needs-owner');
});
it.each<[string,boolean,Row[]|null,string]>([['Dodo keeps for review',false,null,'refund-overdue'],['Dodo answers about under another payment',false,null,'refund-review'],
  ['only a part of the money went back for',true,[{refund_id:'ref_part',status:'succeeded',amount:500}],'refund-review'],['Dodo still lists as in work',true,[{refund_id:'ref_open',status:'pending',amount:2261}],'refund-overdue']])
('a sent refund that %s is not asked about for ever: three days after it was sent it is asked once more, then left alone and put before the owner, and no credit moves',async(name,lost,listed,mark)=>{
  const {c,p,held,status}=await refundSent(lost?timeout:null), refundId=record(c.checkoutId).refundId;
  if(refundId)refunds[refundId]={refund_id:refundId,...(name.includes('another')?{payment_id:'pay_other',status:'failed'}:{payment_id:'pay_A',status:'review'}),amount:2261,currency:'USD',created_at:'2026-10-07T05:00:00Z'};
  if(listed)payments.pay_A!.refunds=listed;
  later(3*86400000-60000);await sweepPayments();
  expect(reads()).toHaveLength(1);expect(paymentMarks().get(p.id)).not.toBe('refund-overdue');
  later(120000);calls=[];for(let n=0;n<4;n++){await sweepPayments();later(60000);}
  expect(reads()).toEqual([refundId?`GET /refunds/${refundId}`:'GET /payments/pay_A']);
  expect(status()).toBe('refund-sent');expect(balanceOf(user)).toBe(held);expect(returned(p.id)).toBe(0);
  expect(paymentMarks().get(p.id)).toBe(mark);expect(paymentStore().attention.filter(note=>note.startsWith('stale-refund'))).toEqual([`stale-refund:${p.id}`]);
  // What Dodo reports later still settles it.
  await deliver('refund.succeeded',{payload_type:'Refund',refund_id:refundId??'ref_open',payment_id:'pay_A',status:'succeeded',amount:2261,currency:'USD',metadata:{checkout_id:c.checkoutId}});
  expect(status()).toBe('refunded');expect(balanceOf(user)).toBe(held);expect(paymentMarks().get(p.id)).not.toBe('refund-overdue');
});
it('a refund that settles in time is never put before the owner as overdue, however long ago it was',async()=>{
  const {c,p,status}=await refundSent(null), refundId=record(c.checkoutId).refundId!;
  refunds[refundId]={refund_id:refundId,payment_id:'pay_A',status:'succeeded',amount:2261,currency:'USD',created_at:'2026-10-07T05:00:00Z'};
  await sweepPayments();later(30*86400000);await sweepPayments();
  expect(status()).toBe('refunded');expect(paymentMarks().get(p.id)).toBeUndefined();expect(paymentStore().attention).toEqual([]);
});
it('parts of the money that add up to the whole payment are the whole refund: the sent refund settles as refunded and its credits stay out',async()=>{
  const {c,p,held,status}=await refundSent(timeout);
  payments.pay_A!.refunds=[{refund_id:'ref_part',status:'succeeded',amount:1000}];
  later(2*3600000);await sweepPayments();
  expect(status()).toBe('refund-sent');
  payments.pay_A!.refunds=[{refund_id:'ref_part',status:'succeeded',amount:1000},{refund_id:'ref_rest',status:'succeeded',amount:1261}];
  later(60000);await sweepPayments();
  expect(status()).toBe('refunded');expect(balanceOf(user)).toBe(held);expect(returned(p.id)).toBe(0);
  // The parts were not the refund sent from here: the owner's mark stays.
  expect(record(c.checkoutId).flag).toBe('refund-review');
});
it('a session is not closed the second ours runs out: Dodo\'s own day ends a little later, so a checkout paid in between is still read and credited, and an unpaid one is closed only after that',async()=>{
  const before=balanceOf(user), left=await open('/left'), late=await open('/late');
  later(86400000+5000);await sweepPayments();
  expect([record(left.checkoutId).status,record(late.checkoutId).status]).toEqual(['pending','pending']);
  pay(late.checkoutId);later(60000);await sweepPayments();await sweepPayments();
  expect(record(late.checkoutId).status).toBe('paid');expect(balanceOf(user)).toBe(before+10);expect(record(left.checkoutId).status).toBe('pending');
  later(600000);await sweepPayments();
  expect(record(left.checkoutId).status).toBe('expired');
  calls=[];await sweepPayments();await sweepPayments();expect(reads()).toEqual([]);
});
it('one account cannot make the site question Dodo without end by keeping many checkouts open: all of its pages together cause at most twenty questions a minute, another account and the sweep are not held back by it',async()=>{
  const ids:string[]=[];for(let n=0;n<13;n++)ids.push((await open(`/gallery?n=${n}`)).checkoutId);
  const other=(await paymentsGateway.startCheckout(admin,'pack-starter','/gallery')).checkoutId;
  const look=async()=>{calls=[];const said:(string|null)[]=[];for(const id of ids)said.push(await reconcilePayment(id,user));return said;};
  expect(await look()).toEqual(ids.map(()=>'unpaid'));expect(reads()).toHaveLength(13);
  later(6000);
  // Seven more make twenty; a look that asks nothing says nothing, never "nobody paid" on its own.
  expect(await look()).toEqual(ids.map((_,n)=>n<7?'unpaid':null));expect(reads()).toHaveLength(7);
  later(6000);expect(await look()).toEqual(ids.map(()=>null));expect(reads()).toEqual([]);
  expect(await reconcilePayment(other,admin)).toBe('unpaid');expect(reads()).toHaveLength(1);
  calls=[];await sweepPayments();expect(reads()).toHaveLength(SWEEP_ASKS);
  // A minute after the first questions the account may look again, and a payment made meanwhile is found.
  pay(ids[0]!);later(60000);
  expect(await reconcilePayment(ids[0]!,user)).toBeNull();expect(record(ids[0]!).status).toBe('paid');
});
it.each<[string,Row]>([['on another session',{checkout_session_id:'cks_of_someone_else'}],['that names another checkout',{metadata:{checkout_id:'another-checkout'}}]])
('a checkout whose read finds a payment %s is on the owner\'s list of payments that were not credited, until it is credited after all',async(_name,over)=>{
  const c=await open();pay(c.checkoutId,over);
  await reconcilePayment(c.checkoutId,user);
  expect(uncreditedPayments()).toMatchObject([{checkoutId:c.checkoutId,userId:user,packName:'Starter',reason:'binding'}]);
  pay(c.checkoutId);await sweepPayments();await sweepPayments();
  expect(record(c.checkoutId).status).toBe('paid');expect(uncreditedPayments()).toEqual([]);
});
it('a checkout that ran out unpaid, or was refused a card, is not on that list: only what may have been paid and was not credited is',async()=>{
  const left=await open('/left'), refused=await open('/refused');
  pay(refused.checkoutId,{status:'failed'});
  later(25*3600000);for(let n=0;n<3;n++)await sweepPayments();
  expect([record(left.checkoutId).status,record(refused.checkoutId).status]).toEqual(['expired','declined']);
  later(4*86400000);await sweepPayments();
  expect(uncreditedPayments()).toEqual([]);expect(paymentStore().attention).toEqual([]);
});
it('a refund whose answer never came is on the admin\'s list as "result awaited" until it settles; one Dodo then lists nothing for is on it as "not found", with its credits back, until it is sent again',async()=>{
  const {p,status}=await refundSent(timeout);
  expect(paymentMarks().get(p.id)).toBe('refund-unknown');expect(refundUnconfirmed(p.id)).toBe(true);
  later(2*3600000);await sweepPayments();
  expect(status()).toBe('refund-failed');expect(paymentMarks().get(p.id)).toBe('refund-not-found');expect(refundUnconfirmed(p.id)).toBe(false);
  // The next attempt is refused outright: that failure is another one, and the old mark does not stay on it.
  down=()=>json({code:'REFUND_WINDOW_EXPIRED'},422);
  await expect(sendRefund(admin,p.id,'again','second')).rejects.toThrow('refund-refused');
  expect(status()).toBe('refund-failed');expect(paymentMarks().get(p.id)).toBeUndefined();
});
it('a refund Dodo took is not marked: its id is known, and the admin is told it is on its way',async()=>{
  const {c,p}=await refundSent(null);
  expect(record(c.checkoutId).refundId).toBeDefined();expect(paymentMarks().get(p.id)).toBeUndefined();expect(refundUnconfirmed(p.id)).toBe(false);
});

// Held by tests of their own since the fifth review: each of these let a wrong change of the code through.
it('the same answer read again is the same event: a payment that stays in work adds one event to the store, however many tours read it',async()=>{
  const c=await open();pay(c.checkoutId,{status:'processing'});
  for(let n=0;n<5;n++)await sweepPayments();
  expect(reads().filter(call=>call==='GET /payments/pay_A').length).toBeGreaterThan(2);
  expect(paymentStore().events.map(e=>e.raw)).toEqual(['dodo-read:payment']);
});
it('when Dodo fails on the payment itself, after its session named it, nothing is tried twice either: one request in the tour, the record as it was, and the next tour reads the payment again',async()=>{
  const before=balanceOf(user), c=await open();pay(c.checkoutId);
  await sweepPayments();
  const untouched=JSON.stringify(paymentStore());
  for(const failure of [()=>json({code:'INTERNAL'},500),timeout]){
    down=failure;calls=[];await sweepPayments();
    expect(reads()).toEqual(['GET /payments/pay_A']);expect(JSON.stringify(paymentStore())).toBe(untouched);
  }
  down=null;await sweepPayments();
  expect(balanceOf(user)).toBe(before+10);
});
it('a failure that is not Dodo\'s is not swallowed: when the credit cannot be stored the page\'s read and the tour fail aloud, nothing is half written, and the next tour credits once',async()=>{
  const before=balanceOf(user), c=await open();pay(c.checkoutId);
  const storage=()=>vi.spyOn(globalThis,'structuredClone').mockImplementationOnce(()=>{throw new Error('made-up-storage-failure');});
  storage();await expect(reconcilePayment(c.checkoutId,user)).rejects.toThrow('made-up-storage-failure');
  // The first tour only learns the payment's name; the second reads it, and it is that read which fails.
  await sweepPayments();expect(reads().at(-1)).toBe('GET /checkouts/cks_1');
  storage();await expect(sweepPayments()).rejects.toThrow('made-up-storage-failure');
  expect(reads().at(-1)).toBe('GET /payments/pay_A');
  vi.restoreAllMocks();
  expect(balanceOf(user)).toBe(before);expect(record(c.checkoutId)).toMatchObject({status:'pending',purchaseId:null});expect(paymentStore().events).toEqual([]);
  // The failed tour is over: the next ones are not kept out, and the payment is credited.
  await sweepPayments();await sweepPayments();
  expect(balanceOf(user)).toBe(before+10);expect(credited()).toBe(1);
});
it('a read the gate refuses decides nothing about the checkout: after its session ran out it is not closed on that answer, and the payment read correctly later is still credited',async()=>{
  const before=balanceOf(user), c=await open();pay(c.checkoutId,{checkout_session_id:'cks_of_someone_else'});
  later(25*3600000);for(let n=0;n<4;n++)await sweepPayments();
  expect(record(c.checkoutId).status).toBe('pending');
  pay(c.checkoutId);await sweepPayments();await sweepPayments();
  expect(record(c.checkoutId).status).toBe('paid');expect(balanceOf(user)).toBe(before+10);
});
it('a checkout that is closed is not asked about again: not an expired one after a restart, and not one a refused card left declined when its session ran out',async()=>{
  const left=await open('/left'), refused=await open('/refused');pay(refused.checkoutId,{status:'failed'});
  later(25*3600000);for(let n=0;n<4;n++)await sweepPayments();
  expect([record(left.checkoutId).status,record(refused.checkoutId).status]).toEqual(['expired','declined']);
  calls=[];for(let n=0;n<3;n++)await sweepPayments();
  expect(reads()).toEqual([]);
  // A restart forgets which checkouts were closed: the expired one is still not asked about, the declined one is asked once more and closed again.
  forgetReconciliation();for(let n=0;n<5;n++)await sweepPayments();
  expect(reads().filter(call=>call.includes(record(left.checkoutId).sessionId))).toEqual([]);
  calls=[];for(let n=0;n<3;n++)await sweepPayments();
  expect(reads()).toEqual([]);
});
it('"Dodo lists no refund" gives nothing back once the sent refund has a name: an answer that named it while the list was being read stands',async()=>{
  const {c,p,held,status}=await refundSent(timeout);
  later(2*3600000);
  let release=()=>{};gate=new Promise(resolve=>{release=resolve;});
  const tour=sweepPayments();
  await Promise.resolve();record(c.checkoutId).refundId='ref_named_meanwhile';
  release();await tour;
  expect(status()).toBe('refund-sent');expect(balanceOf(user)).toBe(held);expect(returned(p.id)).toBe(0);
});
it('the server\'s own read stores what the webhook would have: the tax Dodo added, the total it charged and the address of its invoice',async()=>{
  const before=balanceOf(user), c=await open();pay(c.checkoutId,{invoice_url:'https://test.dodopayments.com/invoices/payments/pay_A'});
  await reconcilePayment(c.checkoutId,user);
  expect(balanceOf(user)).toBe(before+10);
  expect(getStore().purchases.find(p=>p.id===record(c.checkoutId).purchaseId)).toMatchObject({amount:'$19.00',amountCents:1900,taxCents:361,totalCents:2261,invoiceUrl:'https://test.dodopayments.com/invoices/payments/pay_A'});
});
const INVOICE='https://test.dodopayments.com/invoices/payments/pay_A';
const invoiceOf=(checkoutId:string)=>getStore().purchases.find(p=>p.id===record(checkoutId).purchaseId)!.invoiceUrl;
it('an invoice address Dodo had not given when the payment was credited is written by a read that was on its way anyway: once, with no request made for it',async()=>{
  const before=balanceOf(user), c=await open();pay(c.checkoutId);
  let release=()=>{};gate=new Promise(resolve=>{release=resolve;});
  const read=reconcilePayment(c.checkoutId,user);
  expect(await deliver('payment.succeeded',notice(c.checkoutId))).toBe(200);
  expect(balanceOf(user)).toBe(before+10);expect(invoiceOf(c.checkoutId)).toBeUndefined();
  payments.pay_A!.invoice_url=INVOICE;release();await read;
  expect(invoiceOf(c.checkoutId)).toBe(INVOICE);expect(balanceOf(user)).toBe(before+10);expect(credited()).toBe(1);
  expect(reads()).toEqual(['GET /checkouts/cks_1','GET /payments/pay_A']);
  // Paid: Dodo is not asked again, for the invoice or for anything else.
  gate=null;later(6000);await reconcilePayment(c.checkoutId,user);await sweepPayments();
  expect(reads()).toHaveLength(2);
});
it('an invoice address that is kept is never replaced, and none is written from an address that is not Dodo\'s own or from a second notice of the payment',async()=>{
  const kept=await open();pay(kept.checkoutId,{invoice_url:INVOICE});
  let release=()=>{};gate=new Promise(resolve=>{release=resolve;});
  let read=reconcilePayment(kept.checkoutId,user);
  await deliver('payment.succeeded',notice(kept.checkoutId));
  payments.pay_A!.invoice_url='https://test.dodopayments.com/invoices/payments/pay_other';release();await read;
  expect(invoiceOf(kept.checkoutId)).toBe(INVOICE);
  const none=await open('/account');pay(none.checkoutId,{},'pay_B');
  gate=new Promise(resolve=>{release=resolve;});read=reconcilePayment(none.checkoutId,user);
  await deliver('payment.succeeded',notice(none.checkoutId,'pay_B'));
  payments.pay_B!.invoice_url='https://elsewhere.example/invoice';release();await read;
  expect(invoiceOf(none.checkoutId)).toBeUndefined();
  expect(await deliver('payment.succeeded',{...notice(none.checkoutId,'pay_B'),invoice_url:INVOICE})).toBe(200);
  expect(invoiceOf(none.checkoutId)).toBeUndefined();
});
it('the read of a sent refund that has no id brings the payment itself: the invoice address it carries is written where the purchase has none',async()=>{
  const {c,status}=await refundSent(timeout);
  expect(invoiceOf(c.checkoutId)).toBeUndefined();
  payments.pay_A!.invoice_url=INVOICE;await sweepPayments();
  expect(invoiceOf(c.checkoutId)).toBe(INVOICE);expect(status()).toBe('refund-sent');
  expect(reads()).toEqual(['GET /payments/pay_A']);
});
it.each<[string,(checkoutId:string)=>void]>([['is not "paid" any more',id=>{record(id).status='expired';}],['names another payment by then',id=>{record(id).paymentId='pay_B';}]])
('the invoice address a read brings is written only while the record still stands as the paid one of that very payment: a purchase whose record %s gets none (a record changed by hand while Dodo is asked: no notice or read makes one so)',async(_name,change)=>{
  const {c}=await refundSent(timeout);
  payments.pay_A!.invoice_url=INVOICE;
  let release=()=>{};gate=new Promise(resolve=>{release=resolve;});
  const tour=sweepPayments();
  await Promise.resolve();change(c.checkoutId);
  release();await tour;
  expect(reads()).toEqual(['GET /payments/pay_A']);expect(invoiceOf(c.checkoutId)).toBeUndefined();
});
// What "the whole payment went back" is measured against today, on a payment Dodo added tax to ($19.00 + $3.61 = $22.61), where a sent refund has
// no id and Dodo's own list of the payment's refunds decides. Held as it is: which of the two amounts Dodo reports for a real whole refund is not known yet.
it('a refund of a taxed payment that Dodo lists with the total, tax included, is the whole refund: the sent refund settles as refunded, its credits stay out and nothing is put before the owner',async()=>{
  const {c,p,held,status}=await refundSent(timeout);
  payments.pay_A!.refunds=[{refund_id:'ref_whole',status:'succeeded',amount:2261}];
  later(2*3600000);await sweepPayments();
  expect(status()).toBe('refunded');expect(balanceOf(user)).toBe(held);expect(returned(p.id)).toBe(0);
  expect(record(c.checkoutId)).toMatchObject({refundId:'ref_whole',status:'paid'});expect(record(c.checkoutId).flag).toBeUndefined();
  expect(paymentMarks().get(p.id)).toBeUndefined();
});
it('a refund of a taxed payment that Dodo lists with the price before tax is taken for a part of the money: the sent refund does not settle, its credits stay out and it goes before the owner',async()=>{
  const {c,p,held,status}=await refundSent(timeout);
  payments.pay_A!.refunds=[{refund_id:'ref_net',status:'succeeded',amount:1900}];
  later(2*3600000);for(let n=0;n<3;n++)await sweepPayments();
  expect(status()).toBe('refund-sent');expect(balanceOf(user)).toBe(held);expect(returned(p.id)).toBe(0);
  expect(record(c.checkoutId).refundId).toBeUndefined();expect(record(c.checkoutId).flag).toBe('refund-review');
  expect(paymentMarks().get(p.id)).toBe('refund-review');
});
it('parts of the money that Dodo\'s own list shows are put before the owner with their amount, each once, whichever read finds them: a payment first read after a part went back, and a sent refund whose id is not known',async()=>{
  const c=await open();pay(c.checkoutId,{refunds:[{refund_id:'ref_part',status:'succeeded',amount:500},{refund_id:'ref_failed',status:'failed',amount:2261}]});
  await sweepPayments();await sweepPayments();
  expect(starter().status).toBe('paid');expect(partRefunded(starter().id)).toBe(500);expect(record(c.checkoutId).outsideRefundId).toBeUndefined();
  await paymentsGateway.requestRefund(user,starter().id);
  down=timeout;await sendRefund(admin,starter().id,'asked','first');down=null;
  payments.pay_A!.refunds=[{refund_id:'ref_part',status:'succeeded',amount:500},{refund_id:'ref_more',status:'succeeded',amount:300}];
  later(2*3600000);await sweepPayments();await sweepPayments();
  expect(starter().status).toBe('refund-sent');expect(partRefunded(starter().id)).toBe(800);expect(paymentMarks().get(starter().id)).toBe('refund-review');
});
it('the invoice address a read brings is written only when Dodo\'s answer itself names this checkout: the payment of a sent refund that names another one, or none, leaves the purchase without',async()=>{
  const {c,status}=await refundSent(timeout);
  for(const metadata of [{checkout_id:'another-checkout'},{}]){
    Object.assign(payments.pay_A!,{metadata,invoice_url:INVOICE});later(60000);await sweepPayments();
    expect(invoiceOf(c.checkoutId)).toBeUndefined();
  }
  expect(status()).toBe('refund-sent');expect(reads()).toEqual(['GET /payments/pay_A','GET /payments/pay_A']);
  payments.pay_A!.metadata={checkout_id:c.checkoutId};later(60000);await sweepPayments();
  expect(invoiceOf(c.checkoutId)).toBe(INVOICE);
});
