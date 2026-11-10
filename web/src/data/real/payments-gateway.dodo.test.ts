// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getStore, resetStore } from '../mock/store';
import { balanceOf, lotsOf, writeEntry } from '../mock/ledger';
import { partRefunded, paymentMarks, paymentsGateway, receivePayment, reconcilePayment, refundAmountUnknown, refundRefusal, sendRefund, sweepPayments, uncreditedPayments } from './payments-gateway';
import { paymentStore } from './payments-store';
import { renderEmail } from '@/core/payments/email';
import { paymentWebhook } from './payments/webhook';
import { DodoProvider } from './payments/dodo-provider';
import { fakeNotice } from './payments/fake-notice';
import { sign } from './payments/signature';
import { signDodoWebhook } from './payments/dodo-test-helpers';

/** Everything here is made up: the key, the secret, the products and every id. The network is a function in this file. */
const KEY='made-up-dodo-test-key-0123456789', SECRET='whsec_'+randomBytes(32).toString('base64');
const PRODUCT='pdt_madeupstarter';
interface Call { method:string; path:string; body:Record<string,any>|null; auth:string|null } // eslint-disable-line @typescript-eslint/no-explicit-any
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
const timeout=():never=>{throw Object.assign(new Error('made-up-timeout'),{name:'TimeoutError'});};
/** Dodo as documented: a new session for each opening call, a new refund for each refund call. */
function dodo(call:Call):Response {
  if(call.method==='POST'&&call.path==='/checkouts')return json({session_id:`cks_${calls.length}`,checkout_url:`https://test.checkout.dodopayments.com/session/cks_${calls.length}`});
  if(call.method==='POST'&&call.path==='/refunds')return json({refund_id:`ref_${calls.length}`,payment_id:call.body!.payment_id,status:'pending',amount:2261,currency:'USD',created_at:new Date().toISOString()});
  return json({code:'NOT_FOUND'},404);
}
let calls:Call[], answer:(call:Call)=>Response|Promise<Response>, user:string, deliveries=0;
beforeEach(()=>{
  vi.unstubAllEnvs();
  for(const [name,value] of Object.entries({VC_PAYMENTS:'test',DODO_API_KEY_TEST:KEY,DODO_WEBHOOK_SECRET_TEST:SECRET,PUBLIC_BASE_URL:'http://127.0.0.1:3400',
    DODO_PRODUCT_PACK_STARTER:PRODUCT,DODO_PRODUCT_PACK_STANDARD:'pdt_madeupstandard',DODO_PRODUCT_PACK_STUDIO:'pdt_madeupstudio'}))vi.stubEnv(name,value);
  resetStore();user=getStore().users.find(u=>u.role==='customer')!.id;calls=[];answer=dodo;
  vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>{
    const call={method:init.method!,path:new URL(url).pathname,body:init.body?JSON.parse(String(init.body)):null,auth:new Headers(init.headers).get('authorization')};
    calls.push(call);return answer(call);
  });
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});

const open=(returnTo='/gallery')=>paymentsGateway.startCheckout(user,'pack-starter',returnTo);
const record=(checkoutId:string)=>paymentStore().records.find(r=>r.checkoutId===checkoutId)!;
async function deliver(type:string,data:object,id=`msg_${++deliveries}`,at=Date.now()){
  const raw=JSON.stringify({business_id:'bus_madeup',type,timestamp:new Date(at).toISOString(),data}), seconds=Math.floor(Date.now()/1000);
  const headers=new Headers({'webhook-id':id,'webhook-timestamp':String(seconds),'webhook-signature':signDodoWebhook(raw,id,seconds,SECRET)});
  const response=await paymentWebhook(new Request('https://site.example/api/payments/webhook',{method:'POST',headers,body:raw}));
  return {status:response.status,body:await response.text(),id};
}
/** A Dodo payment of the starter pack ($19 + $3.61 tax) on the checkout's own session, with the private fields a real one carries. */
const payment=(checkoutId:string,over:object={})=>({payload_type:'Payment',payment_id:'pay_A',status:'succeeded',total_amount:2261,tax:361,currency:'USD',
  checkout_session_id:record(checkoutId).sessionId,metadata:{checkout_id:checkoutId},product_cart:[{product_id:PRODUCT,quantity:1}],
  card_last_four:'4242',billing:{street:'1 Example Street'},customer:{email:'buyer@example.com'},...over});
const refund=(checkoutId:string,over:object={})=>({payload_type:'Refund',refund_id:record(checkoutId).refundId,payment_id:record(checkoutId).paymentId,status:'succeeded',amount:2261,currency:'USD',metadata:{checkout_id:checkoutId},...over});
/** A paid starter pack whose refund the customer asked for. */
async function paidAndAsked(){
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId));
  const p=(await paymentsGateway.purchasesFor(user))[0]!;await paymentsGateway.requestRefund(user,p.id);
  return {c,p,admin:getStore().users.find(u=>u.role==='admin')!.id};
}

it('opening a checkout writes the command before the call and the session after it, and asks Dodo for the pack\'s own product in USD',async()=>{
  let during:ReturnType<typeof record>|undefined;
  answer=call=>{during=structuredClone(paymentStore().records[0]!);return dodo(call);};
  const c=await open('/gallery?a=1&b=2');
  expect(during).toMatchObject({checkoutId:c.checkoutId,provider:'dodo',sessionId:'',paymentId:'',status:'pending',amountMinor:1900,currency:'USD'});
  expect(calls).toHaveLength(1);
  expect(calls[0]).toEqual({method:'POST',path:'/checkouts',auth:`Bearer ${KEY}`,body:{product_cart:[{product_id:PRODUCT,quantity:1}],customer:{email:getStore().users.find(u=>u.id===user)!.email},
    metadata:{checkout_id:c.checkoutId},billing_currency:'USD',feature_flags:{allow_currency_selection:false,allow_discount_code:false},
    return_url:`http://127.0.0.1:3400/checkout/return?checkout=${c.checkoutId}&returnTo=${encodeURIComponent('/gallery?a=1&b=2')}`,
    cancel_url:`http://127.0.0.1:3400/checkout/return?checkout=${c.checkoutId}&returnTo=${encodeURIComponent('/gallery?a=1&b=2')}`}});
  expect(c.url).toBe('https://test.checkout.dodopayments.com/session/cks_1');
  expect(record(c.checkoutId)).toMatchObject({sessionId:'cks_1',paymentId:'',status:'pending'});
  expect(Date.parse(record(c.checkoutId).expiresAt)-Date.now()).toBeGreaterThan(23*3600000);
  expect((await paymentsGateway.getCheckout(c.checkoutId,user))).toMatchObject({status:'pending',reference:null});
});
it('the address Dodo sends the buyer back to is built from the site\'s own base: nothing in the request can point it elsewhere',async()=>{
  for(const returnTo of ['https://elsewhere.example/phish','//elsewhere.example/phish','/\\elsewhere.example','javascript:alert(1)','','gallery','/gallery\r\nX: y'])
    await expect(open(returnTo),JSON.stringify(returnTo)).rejects.toThrow('invalid-return-path');
  expect(calls).toHaveLength(0);expect(paymentStore().records).toHaveLength(0);
  const c=await open('/gallery?next=https://elsewhere.example/phish&to=/@elsewhere.example#part');
  for(const address of [calls[0]!.body!.return_url,calls[0]!.body!.cancel_url]){
    const url=new URL(address);
    expect({origin:url.origin,path:url.pathname,hash:url.hash,names:[...url.searchParams.keys()],checkout:url.searchParams.get('checkout')})
      .toEqual({origin:'http://127.0.0.1:3400',path:'/checkout/return',hash:'',names:['checkout','returnTo'],checkout:c.checkoutId});
  }
});
it('the same click asked again gets the same Dodo page without a second call, also while the first call is still on its way',async()=>{
  const [first,second]=await Promise.all([open(),open()]);
  expect(second).toEqual(first);expect(await open()).toEqual(first);
  expect(calls).toHaveLength(1);expect(paymentStore().records).toHaveLength(1);
});
it('an opening call with no answer leaves the checkout unresolved: it is never asked again, it can never be credited, and the buyer can open a new one',async()=>{
  answer=timeout;
  const before=balanceOf(user);
  const failure=await paymentsGateway.startCheckout(user,'pack-starter','/gallery','one-click').catch((error:Error)=>error);
  expect(failure).toEqual(new Error('payment-provider-unavailable'));
  const lost=paymentStore().records[0]!;
  expect(lost).toMatchObject({sessionId:'',paymentId:'',status:'pending'});
  await expect(paymentsGateway.startCheckout(user,'pack-starter','/gallery','one-click')).rejects.toThrow('checkout-not-opened');
  expect(calls).toHaveLength(1);
  // Dodo did open it after all and someone pays it: with no session of ours to match, nothing is credited.
  for(const session of ['','cks_unknown'])expect((await deliver('payment.succeeded',{...payment(lost.checkoutId),checkout_session_id:session})).status).toBe(200);
  expect(balanceOf(user)).toBe(before);expect(record(lost.checkoutId).status).toBe('pending');
  answer=dodo;
  const next=await open();
  expect(next.checkoutId).not.toBe(lost.checkoutId);expect(calls).toHaveLength(2);
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(Date.now()+25*3600000);await sweepPayments();
  expect(record(lost.checkoutId).status).toBe('expired');expect(balanceOf(user)).toBe(before);
});
it('Dodo refusing or failing the opening call tells the buyer nothing of the key or the reply',async()=>{
  for(const reply of [()=>json({code:'UNAUTHORIZED',message:`bad key ${KEY}`},401),()=>json({message:KEY},500),()=>new Response(`<html>${KEY}</html>`),timeout]){
    answer=reply;
    const failure=await open(`/gallery?n=${calls.length}`).catch((error:Error)=>error);
    expect(failure).toEqual(new Error('payment-provider-unavailable'));
  }
  expect(JSON.stringify(getStore())).not.toContain(KEY);
  expect(paymentStore().attention.some(a=>a.includes('dodo-client:401:UNAUTHORIZED'))).toBe(true);
});
it('a paid webhook writes the credits once: a redelivery, a second notice of the same payment and a server read of it change nothing more',async()=>{
  const before=balanceOf(user), c=await open();
  const first=await deliver('payment.succeeded',payment(c.checkoutId));
  expect(first).toMatchObject({status:200,body:'{"ok":true}'});
  expect(balanceOf(user)).toBe(before+10);expect(record(c.checkoutId)).toMatchObject({status:'paid',paymentId:'pay_A'});
  await deliver('payment.succeeded',payment(c.checkoutId),first.id);
  await deliver('payment.succeeded',payment(c.checkoutId));
  receivePayment({eventId:'read:pay_A',checkoutId:c.checkoutId,providerSessionId:'cks_1',providerPaymentId:'pay_A',kind:'paid',amountMinor:1900,currency:'USD',occurredAt:new Date().toISOString()},'read',{taxMinor:361,cart:[{productId:PRODUCT,quantity:1}]});
  await sweepPayments();
  expect(balanceOf(user)).toBe(before+10);
  expect(getStore().purchases.filter(p=>p.userId===user&&p.status==='paid'&&p.amountCents===1900)).toHaveLength(1);
  expect(paymentStore().deliveries).toHaveLength(1);
  expect((await paymentsGateway.getCheckout(c.checkoutId,user))).toMatchObject({status:'paid',reference:'pay_A'});
});
it.each([
  ['a tax Dodo did not report',{tax:null,total_amount:1900},'tax-unknown'],['another currency',{currency:'EUR'},'currency'],
  ['another product',{product_cart:[{product_id:'pdt_madeupstudio',quantity:1}]},'cart'],['two of the product',{product_cart:[{product_id:PRODUCT,quantity:2}]},'cart'],
  ['no cart',{product_cart:null},'cart'],['less than the price',{total_amount:2260},'amount'],['more than the price',{total_amount:2262},'amount'],
])('a paid notice with %s is answered 200, writes no credit and marks the checkout for review',async(_name,over,reason)=>{
  const before=balanceOf(user), c=await open();
  for(let n=0;n<2;n++)expect((await deliver('payment.succeeded',payment(c.checkoutId,over),'msg_same')).status).toBe(200);
  expect(balanceOf(user)).toBe(before);
  expect(record(c.checkoutId)).toMatchObject({status:'pending',flag:'payment-review',purchaseId:null});
  expect(paymentStore().attention).toEqual([`payment-review:${reason}:${c.checkoutId}`]);
  // The same payment read correctly later is credited once, and the mark goes.
  await deliver('payment.succeeded',payment(c.checkoutId));
  expect(balanceOf(user)).toBe(before+10);expect(record(c.checkoutId).flag).toBeUndefined();
});
it('a payment of an account that no longer exists is answered 200, writes nothing to anyone and is put before the owner',async()=>{
  const c=await open(), store=getStore();
  store.users=store.users.filter(u=>u.id!==user);
  const kept=()=>JSON.stringify([store.ledger,store.purchases,store.invoices,store.outbox]), before=kept();
  for(let n=0;n<2;n++)expect((await deliver('payment.succeeded',payment(c.checkoutId),'msg_gone')).status).toBe(200);
  expect((await deliver('payment.succeeded',payment(c.checkoutId))).status).toBe(200);
  expect(record(c.checkoutId)).toMatchObject({status:'pending',flag:'payment-review',purchaseId:null});
  expect(paymentStore().attention).toEqual([`payment-review:no-account:${c.checkoutId}`]);
  expect(kept()).toBe(before);
});
it('a payment Dodo reported that was not credited is listed for the owner with its buyer, pack and reason, until the same checkout is credited after all',async()=>{
  expect(uncreditedPayments()).toEqual([]);
  const short=await open('/short'), gone=await open('/gone'), fine=await open('/fine');
  await deliver('payment.succeeded',payment(short.checkoutId,{total_amount:2260}));
  await deliver('payment.succeeded',payment(fine.checkoutId,{payment_id:'pay_fine'}));
  getStore().checkouts.find(row=>row.id===gone.checkoutId)!.userId='usr-deleted';
  await deliver('payment.succeeded',payment(gone.checkoutId,{payment_id:'pay_gone'}));
  const at=(id:string)=>getStore().checkouts.find(row=>row.id===id)!.startedAt;
  expect(uncreditedPayments()).toEqual([
    {checkoutId:short.checkoutId,userId:user,packName:'Starter',amount:'$19.00',at:at(short.checkoutId),reason:'amount'},
    {checkoutId:gone.checkoutId,userId:'usr-deleted',packName:'Starter',amount:'$19.00',at:at(gone.checkoutId),reason:'no-account'},
  ]);
  // Refused for one reason and then for another: the last one is the reason shown.
  await deliver('payment.succeeded',payment(short.checkoutId,{currency:'EUR'}));
  expect(uncreditedPayments()[0]).toMatchObject({checkoutId:short.checkoutId,reason:'currency'});
  await deliver('payment.succeeded',payment(short.checkoutId));
  expect(uncreditedPayments().map(row=>row.checkoutId)).toEqual([gone.checkoutId]);
});
it('a real payment is never credited without the provider\'s own facts, a session and a payment id',async()=>{
  const before=balanceOf(user), c=await open();
  const paid={eventId:'no-facts',checkoutId:c.checkoutId,providerSessionId:'cks_1',providerPaymentId:'pay_A',kind:'paid' as const,amountMinor:1900,currency:'USD',occurredAt:new Date().toISOString()};
  receivePayment(paid,'read');
  expect(()=>receivePayment({...paid,eventId:'no-payment',providerPaymentId:''},'read',{taxMinor:0,cart:[{productId:PRODUCT,quantity:1}]})).toThrow('payment-binding-mismatch');
  expect(()=>receivePayment({...paid,eventId:'other-session',providerSessionId:'cks_other'},'read',{taxMinor:0,cart:[{productId:PRODUCT,quantity:1}]})).toThrow('payment-binding-mismatch');
  expect(balanceOf(user)).toBe(before);expect(record(c.checkoutId).status).toBe('pending');
});
it('the payment id is bound where it is first seen; after a refused card the attempt that pays replaces it, and once credited no other payment can',async()=>{
  const before=balanceOf(user), c=await open();
  await deliver('payment.processing',payment(c.checkoutId,{status:'processing'}));
  expect(record(c.checkoutId)).toMatchObject({status:'pending',paymentId:'pay_A'});
  await deliver('payment.failed',payment(c.checkoutId,{status:'failed'}));
  expect(record(c.checkoutId)).toMatchObject({status:'declined',paymentId:'pay_A'});
  // A second refused attempt does not take the binding over; the one that pays does.
  await deliver('payment.failed',payment(c.checkoutId,{status:'failed',payment_id:'pay_B'}));
  expect(record(c.checkoutId).paymentId).toBe('pay_A');
  await deliver('payment.succeeded',payment(c.checkoutId,{payment_id:'pay_C'}));
  expect(record(c.checkoutId)).toMatchObject({status:'paid',paymentId:'pay_C'});expect(balanceOf(user)).toBe(before+10);
  // Late news of the refused attempts changes nothing and raises no alarm.
  await deliver('payment.failed',payment(c.checkoutId,{status:'failed',payment_id:'pay_B'}));
  expect(record(c.checkoutId).flag).toBeUndefined();
  // A second payment that succeeded on the same session: no second credit, the first stays bound, the owner is told.
  await deliver('payment.succeeded',payment(c.checkoutId,{payment_id:'pay_D'}));
  expect(record(c.checkoutId)).toMatchObject({status:'paid',paymentId:'pay_C',flag:'second-payment'});
  expect(balanceOf(user)).toBe(before+10);expect(paymentStore().attention).toEqual([`second-payment:${c.checkoutId}`]);
});
it('somebody else\'s payment cannot be bound: another session, another checkout\'s session or an unknown checkout is answered 200 and changes nothing',async()=>{
  const before=balanceOf(user), mine=await open(), other=await open('/other');
  const snapshot=()=>JSON.stringify([paymentStore().records,paymentStore().events,getStore().purchases,getStore().ledger]);
  const untouched=snapshot();
  for(const data of [payment(mine.checkoutId,{checkout_session_id:'cks_elsewhere'}),payment(mine.checkoutId,{checkout_session_id:record(other.checkoutId).sessionId}),
    payment(mine.checkoutId,{metadata:{checkout_id:'not-ours'}}),payment(mine.checkoutId,{metadata:{}})])
    expect(await deliver('payment.succeeded',data)).toMatchObject({status:200,body:'{"ok":true}'});
  expect(snapshot()).toBe(untouched);expect(balanceOf(user)).toBe(before);
  expect(paymentStore().unhandled!.map(u=>u.reason)).toEqual(['session-mismatch','session-mismatch','unknown-checkout','checkout-id-missing']);
});
it('a refund is written before Dodo is asked, is bound to the payment that was credited, and takes the credits out once',async()=>{
  const {c,p,admin}=await paidAndAsked(), held=balanceOf(user);
  let during:string|undefined;
  answer=call=>{during=getStore().purchases.find(row=>row.id===p.id)!.status;return dodo(call);};
  expect((await sendRefund(admin,p.id,'asked','first')).value.status).toBe('refund-sent');
  expect(during).toBe('refund-sent');
  expect(calls[1]).toMatchObject({method:'POST',path:'/refunds',body:{payment_id:'pay_A',reason:'asked',metadata:{checkout_id:c.checkoutId}}});
  expect(record(c.checkoutId).refundId).toBe('ref_2');
  // Another payment's refund, or a refund we never sent, settles nothing.
  expect((await deliver('refund.succeeded',refund(c.checkoutId,{payment_id:'pay_other'}))).status).toBe(503);
  expect((await deliver('refund.succeeded',refund(c.checkoutId,{metadata:{checkout_id:'another-checkout'}}))).status).toBe(200);
  expect(paymentStore().attention).not.toContain(`refund-review:${c.checkoutId}`);
  for(const over of [{refund_id:'ref_other'},{is_partial:true}]){
    paymentStore().attention=[];delete record(c.checkoutId).flag;
    expect((await deliver('refund.succeeded',refund(c.checkoutId,over))).status).toBe(200);
    expect(paymentStore().attention).toEqual([`refund-review:${c.checkoutId}`]);expect(record(c.checkoutId).flag).toBe('refund-review');
  }
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refund-sent');expect(balanceOf(user)).toBe(held);
  const settled=await deliver('refund.succeeded',refund(c.checkoutId));await deliver('refund.succeeded',refund(c.checkoutId),settled.id);await deliver('refund.succeeded',refund(c.checkoutId));
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refunded');
  expect(balanceOf(user)).toBe(held);expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='refund')).toHaveLength(1);
  expect(calls).toHaveLength(2);
});
it('a refund Dodo fails gives the credits back once, and the retry is a new refund that old news cannot settle',async()=>{
  const {c,p,admin}=await paidAndAsked(), held=balanceOf(user);
  await sendRefund(admin,p.id,'asked','first');
  const failed=refund(c.checkoutId,{status:'failed'});
  await deliver('refund.failed',failed);await deliver('refund.failed',failed);
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refund-failed');expect(balanceOf(user)).toBe(held+10);
  answer=timeout;await sendRefund(admin,p.id,'again','second');
  await deliver('refund.succeeded',{...failed,status:'succeeded'});
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refund-sent');
  // News of the earlier attempt is expected: it is no reason to call the owner.
  expect(record(c.checkoutId).flag).toBeUndefined();expect(paymentStore().attention.filter(a=>a.startsWith('refund-review'))).toEqual([]);
});
it('a refund call with no answer stays sent and unknown: it is not sent again, and Dodo\'s own notice settles it once',async()=>{
  const {c,p,admin}=await paidAndAsked(), held=balanceOf(user);
  answer=timeout;
  expect((await sendRefund(admin,p.id,'asked','first')).value.status).toBe('refund-sent');
  expect(record(c.checkoutId).refundId).toBeUndefined();expect(paymentStore().attention).toContain(`refund-unknown:${p.id}`);
  answer=dodo;
  expect((await sendRefund(admin,p.id,'asked','first')).outcome).toBe('already-done');expect((await sendRefund(admin,p.id,'asked','second')).outcome).toBe('already-done');
  expect(calls.filter(call=>call.path==='/refunds')).toHaveLength(1);
  await deliver('refund.succeeded',refund(c.checkoutId,{refund_id:'ref_made_by_dodo'}));await deliver('refund.succeeded',refund(c.checkoutId,{refund_id:'ref_another'}));
  expect(record(c.checkoutId).refundId).toBe('ref_made_by_dodo');
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refunded');expect(balanceOf(user)).toBe(held);
});
it('a sent refund whose id is not known takes only a success as its own: another refund\'s failure gives no credit back, and the success that follows still settles it',async()=>{
  const {c,p,admin}=await paidAndAsked(), held=balanceOf(user);
  answer=timeout;await sendRefund(admin,p.id,'asked','first');
  for(let n=0;n<2;n++)await deliver('refund.failed',refund(c.checkoutId,{refund_id:'ref_of_someone_else',status:'failed',metadata:{}}));
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refund-sent');expect(balanceOf(user)).toBe(held);
  expect(record(c.checkoutId).refundId).toBeUndefined();
  await deliver('refund.succeeded',refund(c.checkoutId,{refund_id:'ref_ours'}));
  expect(record(c.checkoutId).refundId).toBe('ref_ours');
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refunded');expect(balanceOf(user)).toBe(held);
});
it('a refund Dodo refuses outright is marked failed, the credits come back once and nothing of the reply is kept',async()=>{
  const {c,p,admin}=await paidAndAsked(), held=balanceOf(user);
  answer=()=>json({code:'REFUND_WINDOW_EXPIRED',message:`secret words ${KEY}`},422);
  await expect(sendRefund(admin,p.id,'asked','first')).rejects.toEqual(new Error('refund-refused'));
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refund-failed');expect(balanceOf(user)).toBe(held+10);
  expect(paymentStore().attention).toContain(`refund-refused:${p.id}:dodo-no-refund:422:REFUND_WINDOW_EXPIRED`);
  expect(JSON.stringify(getStore())).not.toContain('secret words');
  answer=dodo;await sendRefund(admin,p.id,'again','second');
  expect(record(c.checkoutId).refundId).toBe('ref_3');expect(balanceOf(user)).toBe(held);
});
// Credits come back only when it is known that no refund exists. Everything else may mean money is going back: the refund stays sent, and a later read settles it.
it.each<[string,()=>Response|Promise<Response>]>([
  ['a refusal Dodo does not name as "no refund"',()=>json({code:'INSUFFICIENT_BALANCE'},422)],['NOTHING_TO_REFUND',()=>json({code:'NOTHING_TO_REFUND'},422)],['LINE_ITEM_FULLY_REFUNDED',()=>json({code:'LINE_ITEM_FULLY_REFUNDED'},422)],
  ['a code Dodo has never documented',()=>json({code:'SOMETHING_NEW'},422)],['a code that is not in Dodo\'s form',()=>json({code:'refund window expired'},422)],
  ['a 409 without a code',()=>json({},409)],['a 400 without a code',()=>json({message:'bad'},400)],['a refused key',()=>json({code:'UNAUTHORIZED'},401)],['a 404',()=>json({code:'NOT_FOUND'},404)],
  ['a 500',()=>json({code:'INTERNAL'},500)],['a 503',()=>new Response('down',{status:503})],['a 200 that cannot be read',()=>new Response('<html>ok</html>')],
  ['a 200 about another payment',()=>json({refund_id:'ref_x',payment_id:'pay_other',status:'pending',created_at:new Date().toISOString()})],['a 202',()=>json({},202)],
  ['a redirect',()=>new Response(null,{status:302,headers:{location:'https://elsewhere.example'}})],['a dead line',()=>{throw new TypeError('fetch failed');}],['no answer in time',timeout],
])('a refund answered with %s is not known to have failed: it stays sent, no credit comes back, and it is asked exactly once',async(_name,reply)=>{
  const {p,admin}=await paidAndAsked(), held=balanceOf(user);
  answer=reply;
  expect((await sendRefund(admin,p.id,'asked','first')).value.status).toBe('refund-sent');
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refund-sent');expect(balanceOf(user)).toBe(held);
  expect(paymentStore().attention).toContain(`refund-unknown:${p.id}`);
  expect((await sendRefund(admin,p.id,'asked','second')).outcome).toBe('already-done');
  expect(calls.filter(call=>call.path==='/refunds')).toHaveLength(1);
});
it('a refund call that fails outside the adapter is not known to have failed either: it stays sent and no credit comes back',async()=>{
  const {p,admin}=await paidAndAsked(), held=balanceOf(user);
  const broken=vi.spyOn(DodoProvider.prototype,'refund').mockRejectedValue(new Error('made-up failure'));
  expect((await sendRefund(admin,p.id,'asked','first')).value.status).toBe('refund-sent');
  broken.mockRestore();
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refund-sent');expect(balanceOf(user)).toBe(held);
  expect(paymentStore().attention).toContain(`refund-unknown:${p.id}`);
});
it('a refund our own adapter refuses to send was never sent: it is marked failed and the credits come back once',async()=>{
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId,{payment_id:'pay A/../refunds'}));
  const p=(await paymentsGateway.purchasesFor(user))[0]!, admin=getStore().users.find(u=>u.role==='admin')!.id;
  await paymentsGateway.requestRefund(user,p.id);
  const held=balanceOf(user);
  await expect(sendRefund(admin,p.id,'asked','first')).rejects.toEqual(new Error('refund-refused'));
  expect(calls.filter(call=>call.path!=='/checkouts')).toHaveLength(0);
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refund-failed');expect(balanceOf(user)).toBe(held+10);
});
const told=(kind:string,purchaseId:string)=>getStore().outbox.filter(m=>m.kind==='payment'&&m.data.refund===kind&&m.data.purchaseId===purchaseId);
it('the buyer is told "refund sent" only when Dodo took the refund: a refused one tells nothing, the one Dodo takes tells once, and its confirmation tells "refunded" once',async()=>{
  const {c,p,admin}=await paidAndAsked();
  answer=()=>json({code:'REFUND_WINDOW_EXPIRED'},422);
  await expect(sendRefund(admin,p.id,'asked','first')).rejects.toThrow('refund-refused');
  expect(told('sent',p.id)).toHaveLength(0);
  answer=dodo;const sent=await sendRefund(admin,p.id,'asked','second');
  expect(told('sent',p.id)).toHaveLength(1);
  expect(told('sent',p.id)[0]!.data).toMatchObject({packName:p.packName,credits:String(p.credits),amount:'$22.61',date:sent.at});
  await sendRefund(admin,p.id,'asked','second');expect(told('sent',p.id)).toHaveLength(1);
  await deliver('refund.succeeded',refund(c.checkoutId));
  expect(told('sent',p.id)).toHaveLength(1);expect(told('true',p.id)).toHaveLength(1);
});
it('the refund of a payment Dodo added tax to is of the whole payment: the "refund sent" mail says the total that was charged, in both languages; with a tax of zero it says the price',async()=>{
  const {c,p,admin}=await paidAndAsked();
  await sendRefund(admin,p.id,'asked','first');await deliver('refund.succeeded',refund(c.checkoutId));
  expect(told('sent',p.id)[0]!.data.amount).toBe('$22.61');expect(told('true',p.id)[0]!.data.amount).toBe('$22.61');
  expect(renderEmail(told('sent',p.id)[0]!,'en','http://127.0.0.1:3400').text).toContain('Refund amount: $22.61');
  expect(renderEmail(told('sent',p.id)[0]!,'tr','http://127.0.0.1:3400').text).toContain('İade tutarı: $22.61');
  const plain=await open('/account');await deliver('payment.succeeded',payment(plain.checkoutId,{payment_id:'pay_B',total_amount:1900,tax:0}));
  const untaxed=getStore().purchases.find(row=>row.id===record(plain.checkoutId).purchaseId)!;
  await paymentsGateway.requestRefund(user,untaxed.id);await sendRefund(admin,untaxed.id,'asked','third');
  expect(told('sent',untaxed.id)[0]!.data.amount).toBe('$19.00');
});
it('a refund whose answer never came tells the buyer nothing until Dodo itself confirms it',async()=>{
  const {c,p,admin}=await paidAndAsked();
  answer=timeout;await sendRefund(admin,p.id,'asked','first');
  expect(told('sent',p.id)).toHaveLength(0);
  await deliver('refund.succeeded',refund(c.checkoutId,{refund_id:'ref_made_by_dodo'}));
  expect(told('sent',p.id)).toHaveLength(0);expect(told('true',p.id)).toHaveLength(1);
});
it('a whole refund made in the Dodo panel, which we never sent, freezes the pack like a dispute: its credits cannot be spent or asked back, and the owner sees the mark',async()=>{
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId));
  const balance=balanceOf(user), p=(await paymentsGateway.purchasesFor(user))[0]!;
  expect(paymentMarks().size).toBe(0);
  for(let n=0;n<2;n++)expect((await deliver('refund.succeeded',{...refund(c.checkoutId),refund_id:'ref_panel',metadata:{}},'msg_panel')).status).toBe(200);
  expect(record(c.checkoutId).flag).toBe('refund-review');expect(paymentStore().attention).toEqual([`refund-review:${c.checkoutId}`]);
  expect(paymentMarks()).toEqual(new Map([[p.id,'refund-outside']]));
  // The money is back with the buyer: the pack's credits are held, and neither a new request nor taking one back can free them.
  expect((await paymentsGateway.purchasesFor(user))[0]).toMatchObject({status:'refund-requested',refundable:null});
  expect(balanceOf(user)).toBe(balance-10);
  await expect(paymentsGateway.cancelRefund(user,p.id)).rejects.toThrow('refund-needs-owner');
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refund-requested');expect(balanceOf(user)).toBe(balance-10);
  expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='refund')).toHaveLength(0);
});
it('a failed or partial refund we never sent moves no money for good: it is marked, and the pack stays as it is',async()=>{
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId));
  const balance=balanceOf(user), p=(await paymentsGateway.purchasesFor(user))[0]!;
  await deliver('refund.failed',{...refund(c.checkoutId),refund_id:'ref_panel',status:'failed',metadata:{}});
  await deliver('refund.succeeded',{...refund(c.checkoutId),refund_id:'ref_part',is_partial:true,amount:100,metadata:{}});
  expect(record(c.checkoutId).flag).toBe('refund-review');
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('paid');expect(balanceOf(user)).toBe(balance);
});
const panelRefund=(checkoutId:string)=>deliver('refund.succeeded',{...refund(checkoutId),refund_id:'ref_panel',metadata:{}});
const dispute=()=>deliver('dispute.opened',{payload_type:'Dispute',dispute_id:'dp_1',payment_id:'pay_A',amount:'2261',currency:'USD'});
/** The pack is frozen: its credits are in the account but cannot be spent, and the customer can neither take the request back nor ask anew. */
async function expectFrozen(purchaseId:string,spendable:number,needs:string){
  expect((await paymentsGateway.purchasesFor(user)).find(p=>p.id===purchaseId)).toMatchObject({status:'refund-requested',refundable:null});
  expect(balanceOf(user)).toBe(spendable);
  await expect(paymentsGateway.cancelRefund(user,purchaseId)).rejects.toThrow(needs);
  expect(getStore().purchases.find(p=>p.id===purchaseId)!.status).toBe('refund-requested');expect(balanceOf(user)).toBe(spendable);
}
it.each<[string,(checkoutId:string)=>Promise<unknown>,string,string]>([['the whole payment is refunded in the Dodo panel',panelRefund,'refund-outside','refund-needs-owner'],['the payment is disputed',dispute,'disputed','dispute-needs-owner']])
('a pack whose own refund failed has its credits back; when %s afterwards, they are frozen, whether Dodo failed the refund or refused it',async(_name,outside,mark,needs)=>{
  for(const failed of ['by notice','by refusal']){
    resetStore();user=getStore().users.find(u=>u.role==='customer')!.id;answer=dodo;
    const {c,p,admin}=await paidAndAsked(), held=balanceOf(user);
    if(failed==='by notice'){await sendRefund(admin,p.id,'asked','first');await deliver('refund.failed',refund(c.checkoutId,{status:'failed'}));}
    else {answer=()=>json({code:'REFUND_WINDOW_EXPIRED'},422);await expect(sendRefund(admin,p.id,'asked','first')).rejects.toThrow('refund-refused');}
    expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refund-failed');expect(balanceOf(user),failed).toBe(held+10);
    await outside(c.checkoutId);
    await expectFrozen(p.id,held,needs);
    expect(paymentMarks()).toEqual(new Map([[p.id,mark]]));
  }
});
it.each<[string,string,(checkoutId:string)=>Promise<unknown>,string]>([['the whole payment is refunded in the Dodo panel','by notice',panelRefund,'refund-needs-owner'],
  ['the payment is disputed','by notice',dispute,'dispute-needs-owner'],['the payment is disputed','by refusal',dispute,'dispute-needs-owner']])
('while our refund is on its way %s; when ours then fails, its credits come back frozen (the failure learnt %s)',async(_name,failed,outside,needs)=>{
  const {c,p,admin}=await paidAndAsked(), held=balanceOf(user);
  if(failed==='by notice'){
    await sendRefund(admin,p.id,'asked','first');await outside(c.checkoutId);
    expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refund-sent');expect(balanceOf(user)).toBe(held);
    await deliver('refund.failed',refund(c.checkoutId,{status:'failed'}));
  }else{
    answer=async()=>{await outside(c.checkoutId);return json({code:'PAYMENT_NOT_SUCCEEDED'},422);};
    await expect(sendRefund(admin,p.id,'asked','first')).rejects.toThrow('refund-refused');
  }
  // The credits are back in the account once, and none of them can be spent.
  expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='returned')).toHaveLength(1);
  await expectFrozen(p.id,held,needs);
});
it.each([['EXISTING_REFUND_REQUEST_PROCESSING',409],['PAYMENT_ALREADY_REFUNDED',422],['PAYMENT_HAS_BEEN_REFUNDED',422]])('Dodo answering %s means a refund of this payment exists: ours stays sent, no credit comes back, and Dodo\'s notice settles it',async(code,status)=>{
  const {c,p,admin}=await paidAndAsked(), held=balanceOf(user);
  answer=()=>json({code},status);
  expect((await sendRefund(admin,p.id,'asked','first')).value.status).toBe('refund-sent');
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refund-sent');expect(balanceOf(user)).toBe(held);
  expect(paymentStore().attention).toContain(`refund-unknown:${p.id}`);
  await deliver('refund.succeeded',refund(c.checkoutId,{refund_id:'ref_panel',metadata:{}}));
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refunded');expect(balanceOf(user)).toBe(held);
});
it.each([['PAYMENT_ALREADY_REFUNDED',422],['PAYMENT_HAS_BEEN_REFUNDED',422]])('the way out of a pack frozen by a panel refund is the admin\'s refund: Dodo answering %s is then the refund itself, so the purchase is refunded, its credits leave once and the mark is gone',async(code,status)=>{
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId));
  const balance=balanceOf(user), p=(await paymentsGateway.purchasesFor(user))[0]!, admin=getStore().users.find(u=>u.role==='admin')!.id;
  await panelRefund(c.checkoutId);
  answer=()=>json({code},status);
  expect((await sendRefund(admin,p.id,'refunded in the panel','first')).outcome).toBe('done');
  expect(getStore().purchases.find(row=>row.id===p.id)).toMatchObject({status:'refunded',refund:{settledAt:expect.any(String)}});
  expect(balanceOf(user)).toBe(balance-10);expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='refund'&&e.change===-10)).toHaveLength(1);
  expect(record(c.checkoutId)).toMatchObject({refundId:'ref_panel'});expect(record(c.checkoutId).flag).toBeUndefined();expect(paymentMarks().size).toBe(0);
  expect(paymentStore().attention).toEqual([`refund-review:${c.checkoutId}`]);
  // The buyer is told once that the money went back, and never that a refund was "sent" from here.
  expect(told('true',p.id)).toHaveLength(1);expect(told('sent',p.id)).toHaveLength(0);
  expect((await sendRefund(admin,p.id,'again','second')).outcome).toBe('already-done');
  expect(calls.filter(call=>call.path==='/refunds')).toHaveLength(0);expect(balanceOf(user)).toBe(balance-10);
});
it.each([[3,7],[10,0]])('the way out of a pack frozen by a panel refund is open also when %i of its 10 credits were spent: the money is back at Dodo already, so nothing is sent there, the %i left leave once, the purchase is refunded and the mark is gone',async(spent,left)=>{
  const before=balanceOf(user), c=await open();await deliver('payment.succeeded',payment(c.checkoutId));
  const p=(await paymentsGateway.purchasesFor(user))[0]!, admin=getStore().users.find(u=>u.role==='admin')!.id;
  writeEntry(user,'generation',-spent,'made-up job',{from:p.id});
  await panelRefund(c.checkoutId);
  expect(paymentMarks()).toEqual(new Map([[p.id,'refund-outside']]));await expectFrozen(p.id,before,'refund-needs-owner');
  expect((await sendRefund(admin,p.id,'refunded in the panel','first')).outcome).toBe('done');
  expect(calls.filter(call=>call.path==='/refunds')).toHaveLength(0);
  expect(getStore().purchases.find(row=>row.id===p.id)).toMatchObject({status:'refunded',refund:{settledAt:expect.any(String)}});
  expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='refund').map(e=>e.change)).toEqual(left?[-left]:[]);
  expect(lotsOf(user).get(p.id)).toBe(0);expect(balanceOf(user)).toBe(before);
  expect(record(c.checkoutId)).toMatchObject({refundId:'ref_panel'});expect(record(c.checkoutId).flag).toBeUndefined();expect(paymentMarks().size).toBe(0);
  // The buyer is told once that the money went back, and never that a refund was "sent" from here.
  expect(told('true',p.id)).toHaveLength(1);expect(told('sent',p.id)).toHaveLength(0);
  expect((await sendRefund(admin,p.id,'again','second')).outcome).toBe('already-done');
  expect(calls.filter(call=>call.path==='/refunds')).toHaveLength(0);expect(balanceOf(user)).toBe(before);
});
it('a pack with spent credits whose whole refund Dodo did not report is still not refunded from here: a part that went back in the panel opens no way, and the mark says so',async()=>{
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId));
  const p=(await paymentsGateway.purchasesFor(user))[0]!, admin=getStore().users.find(u=>u.role==='admin')!.id;
  writeEntry(user,'generation',-3,'made-up job',{from:p.id});
  await deliver('refund.succeeded',{...refund(c.checkoutId),refund_id:'ref_part',is_partial:true,amount:100,metadata:{}});
  getStore().purchases.find(row=>row.id===p.id)!.status='refund-requested';
  const before=JSON.stringify([getStore().purchases,getStore().ledger,record(c.checkoutId)]);
  await expect(sendRefund(admin,p.id,'asked','first')).rejects.toThrow('credits-used');
  expect(JSON.stringify([getStore().purchases,getStore().ledger,record(c.checkoutId)])).toBe(before);
  expect(calls.filter(call=>call.path==='/refunds')).toHaveLength(0);expect(paymentMarks()).toEqual(new Map([[p.id,'refund-review']]));
});
it('"refunded already" is taken for the refund only where Dodo itself reported a whole refund of that payment: without one it stays sent and unknown',async()=>{
  const {p,admin}=await paidAndAsked(), held=balanceOf(user);
  answer=()=>json({code:'PAYMENT_ALREADY_REFUNDED'},422);
  await sendRefund(admin,p.id,'asked','first');
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refund-sent');expect(balanceOf(user)).toBe(held);
  expect(paymentStore().attention).toEqual([`refund-unknown:${p.id}`]);
});
it('a pack whose credits were spent is not refunded: nothing is sent to Dodo and nothing changes',async()=>{
  const {c,p,admin}=await paidAndAsked();
  await paymentsGateway.cancelRefund(user,p.id);
  getStore().ledger.push({...getStore().ledger.find(e=>e.relatedPurchaseId===p.id&&e.type==='purchase')!,id:'spent-one',type:'generation',change:-1,from:[{lot:p.id,credits:1}]} as never);
  getStore().purchases.find(row=>row.id===p.id)!.status='refund-requested';
  const before=JSON.stringify([getStore().purchases,getStore().ledger,record(c.checkoutId)]);
  await expect(sendRefund(admin,p.id,'asked','first')).rejects.toThrow('credits-used');
  expect(JSON.stringify([getStore().purchases,getStore().ledger,record(c.checkoutId)])).toBe(before);
  expect(calls.filter(call=>call.path==='/refunds')).toHaveLength(0);
});
it('a refund or a dispute is applied only to the payment that was credited: another payment id, or none, is refused whatever else matches',async()=>{
  const {c,p,admin}=await paidAndAsked();await sendRefund(admin,p.id,'asked','first');
  const before=JSON.stringify(getStore());
  const notice=(kind:'refunded'|'refund-failed'|'disputed',providerPaymentId:string)=>({eventId:crypto.randomUUID(),checkoutId:c.checkoutId,providerSessionId:record(c.checkoutId).sessionId,providerPaymentId,
    providerRefundId:record(c.checkoutId).refundId,kind,amountMinor:2261,currency:'USD',occurredAt:new Date().toISOString()});
  for(const kind of ['refunded','refund-failed','disputed'] as const)for(const id of ['pay_other',''])expect(()=>receivePayment(notice(kind,id),'read'),`${kind} ${id}`).toThrow('payment-binding-mismatch');
  expect(JSON.stringify(getStore())).toBe(before);
});
it('Dodo\'s notice of our refund may come before the answer to the call: the two agree and it settles once; when they name different refunds the owner is told',async()=>{
  const {c,p,admin}=await paidAndAsked(), held=balanceOf(user);
  // The refund the call is about to name is `ref_2`: its notice arrives while the call is still on its way.
  answer=async call=>{await deliver('refund.succeeded',refund(c.checkoutId,{refund_id:'ref_2'}));return dodo(call);};
  await sendRefund(admin,p.id,'asked','first');
  expect(record(c.checkoutId)).toMatchObject({refundId:'ref_2'});expect(record(c.checkoutId).flag).toBeUndefined();
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refunded');expect(balanceOf(user)).toBe(held);
  expect(told('sent',p.id)).toHaveLength(0);expect(told('true',p.id)).toHaveLength(1);
});
it('an answer that names another refund than the notice did does not replace it: the owner is told',async()=>{
  const {c,p,admin}=await paidAndAsked(), held=balanceOf(user);
  answer=async call=>{await deliver('refund.succeeded',refund(c.checkoutId,{refund_id:'ref_named_by_notice'}));return dodo(call);};
  await sendRefund(admin,p.id,'asked','first');
  expect(record(c.checkoutId)).toMatchObject({refundId:'ref_named_by_notice',flag:'refund-review'});expect(paymentStore().attention).toContain(`refund-review:${c.checkoutId}`);
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refunded');expect(balanceOf(user)).toBe(held);
});
it('a refusal that arrives after Dodo\'s notice of the refund gives no credit back: the refund stands',async()=>{
  const {c,p,admin}=await paidAndAsked(), held=balanceOf(user);
  answer=async()=>{await deliver('refund.succeeded',refund(c.checkoutId,{refund_id:'ref_first'}));return json({code:'REFUND_WINDOW_EXPIRED'},422);};
  await sendRefund(admin,p.id,'asked','first').catch(()=>undefined);
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refunded');expect(balanceOf(user)).toBe(held);
  expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='returned')).toHaveLength(0);
});
it('a dispute\'s mark is never replaced by a lesser one',async()=>{
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId));
  await deliver('dispute.opened',{payload_type:'Dispute',dispute_id:'dp_1',payment_id:'pay_A',amount:'2261',currency:'USD'});
  await deliver('refund.succeeded',{...refund(c.checkoutId),refund_id:'ref_panel',metadata:{}});
  await deliver('refund.succeeded',{...refund(c.checkoutId),refund_id:'ref_part',is_partial:true,metadata:{}});
  await deliver('payment.succeeded',payment(c.checkoutId,{payment_id:'pay_second'}));
  expect(record(c.checkoutId).flag).toBe('disputed');
  expect(paymentStore().attention).toEqual([`disputed:${c.checkoutId}`,`refund-review:${c.checkoutId}`,`second-payment:${c.checkoutId}`]);
});
it('the mark of an outside refund is not replaced by a lesser one either: a second payment on the frozen pack leaves it frozen, and both go before the owner',async()=>{
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId));
  const balance=balanceOf(user), p=(await paymentsGateway.purchasesFor(user))[0]!;
  await panelRefund(c.checkoutId);
  await deliver('payment.succeeded',payment(c.checkoutId,{payment_id:'pay_second'}));
  expect(record(c.checkoutId).flag).toBe('refund-review');
  expect(paymentStore().attention).toEqual([`refund-review:${c.checkoutId}`,`second-payment:${c.checkoutId}`]);
  await expectFrozen(p.id,balance-10,'refund-needs-owner');
  // A dispute is the heavier mark: it takes the place of the refund's.
  await dispute();
  expect(record(c.checkoutId).flag).toBe('disputed');await expectFrozen(p.id,balance-10,'dispute-needs-owner');
});
it('a failure to store a paid notice is not swallowed: it is answered 500, nothing is credited, and the delivery that comes again credits once',async()=>{
  const before=balanceOf(user), c=await open();
  vi.spyOn(globalThis,'structuredClone').mockImplementationOnce(()=>{throw new Error('made-up-storage-failure');});
  expect(await deliver('payment.succeeded',payment(c.checkoutId),'msg_again')).toMatchObject({status:500,body:'{"error":"payment-processing-failed"}'});
  vi.restoreAllMocks();
  expect(balanceOf(user)).toBe(before);expect(record(c.checkoutId).status).toBe('pending');
  expect((await deliver('payment.succeeded',payment(c.checkoutId),'msg_again')).status).toBe(200);
  expect(balanceOf(user)).toBe(before+10);
});
it('a dispute freezes the pack of the payment it names; a dispute of a payment we do not know changes nothing',async()=>{
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId));
  const dispute={payload_type:'Dispute',dispute_id:'dp_1',payment_id:'pay_unknown',amount:'2261',currency:'USD'};
  // Not stored (yet): Dodo is asked to deliver it again, and nothing changes.
  expect(await deliver('dispute.opened',dispute)).toMatchObject({status:503,body:'{"error":"not-ready"}'});
  expect(record(c.checkoutId).flag).toBeUndefined();
  await deliver('dispute.opened',{...dispute,payment_id:'pay_A'});
  expect(record(c.checkoutId).flag).toBe('disputed');
  const p=(await paymentsGateway.purchasesFor(user))[0]!;
  expect(p.status).toBe('refund-requested');await expect(paymentsGateway.cancelRefund(user,p.id)).rejects.toThrow('dispute-needs-owner');
});
const won=(id?:string)=>deliver('dispute.won',{payload_type:'Dispute',dispute_id:'dp_1',payment_id:'pay_A',amount:'2261',currency:'USD'},id);
it('a dispute Dodo says we won ends the freeze: the pack is what it was before the dispute, its credits can be spent again and the mark is gone',async()=>{
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId));
  const balance=balanceOf(user), p=(await paymentsGateway.purchasesFor(user))[0]!;
  // Won without a dispute on record: nothing to end.
  await won();expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('paid');
  await dispute();await expectFrozen(p.id,balance-10,'dispute-needs-owner');
  for(let n=0;n<2;n++)expect((await won('msg_won')).status).toBe(200);
  expect((await paymentsGateway.purchasesFor(user))[0]).toMatchObject({status:'paid',refund:null,refundable:{ok:true}});expect(balanceOf(user)).toBe(balance);
  expect(record(c.checkoutId).flag).toBeUndefined();expect(paymentMarks().size).toBe(0);
});
it('a won dispute gives back exactly what the dispute froze: a failed refund is failed again and can be sent again, and a request of the customer\'s own stays a request the customer can take back',async()=>{
  const {c,p,admin}=await paidAndAsked(), held=balanceOf(user);
  await dispute();await won();
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refund-requested');expect(balanceOf(user)).toBe(held);
  await sendRefund(admin,p.id,'asked','first');await deliver('refund.failed',refund(c.checkoutId,{status:'failed'}));
  await dispute();await expectFrozen(p.id,held,'dispute-needs-owner');
  await won();
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refund-failed');expect(balanceOf(user)).toBe(held+10);
  expect((await sendRefund(admin,p.id,'again','second')).outcome).toBe('done');
  // The retry fails too while a new dispute stands, and that one is won as well.
  await dispute();await deliver('refund.failed',refund(c.checkoutId,{status:'failed'}));await expectFrozen(p.id,held,'dispute-needs-owner');
  await won();expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refund-failed');expect(balanceOf(user)).toBe(held+10);
});
it('a won dispute does not free a pack whose whole payment was also refunded in the panel: it stays frozen under the refund\'s mark',async()=>{
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId));
  const balance=balanceOf(user), p=(await paymentsGateway.purchasesFor(user))[0]!;
  await panelRefund(c.checkoutId);await dispute();await won();
  expect(record(c.checkoutId).flag).toBe('refund-review');expect(paymentMarks()).toEqual(new Map([[p.id,'refund-outside']]));
  await expectFrozen(p.id,balance-10,'refund-needs-owner');
});
/** A stage of a dispute of `pay_A` that happened at the given moment and is delivered now: Dodo promises no order. */
const stage=(name:string,disputeId:string|null,at:number)=>deliver(`dispute.${name}`,{payload_type:'Dispute',...(disputeId?{dispute_id:disputeId}:{}),payment_id:'pay_A',amount:'2261',currency:'USD'},undefined,at);
it('a stage of a dispute that happened before the last one known of it is old news, whenever it is delivered: one from before the win does not freeze the pack again, and a win from before the last stage does not free it',async()=>{
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId));
  const balance=balanceOf(user), p=(await paymentsGateway.purchasesFor(user))[0]!, t=Date.now();
  await stage('opened','dp_1',t-5000);await stage('won','dp_1',t-3000);
  expect((await stage('challenged','dp_1',t-4000)).status).toBe(200);
  expect((await paymentsGateway.purchasesFor(user))[0]).toMatchObject({status:'paid',refundable:{ok:true}});expect(balanceOf(user)).toBe(balance);
  expect(record(c.checkoutId).flag).toBeUndefined();expect(paymentMarks().size).toBe(0);
  // What happened after the win is news: the dispute stands again, and the win that is older than it ends nothing.
  await stage('opened','dp_1',t-1000);await expectFrozen(p.id,balance-10,'dispute-needs-owner');
  await stage('won','dp_1',t-2000);await expectFrozen(p.id,balance-10,'dispute-needs-owner');
  expect(paymentMarks()).toEqual(new Map([[p.id,'disputed']]));
});
it('a dispute that is won ends its own freeze only: while another dispute of the same payment stands the pack stays frozen, also when an earlier win is delivered again or a win names no dispute, and it is free once every one is won',async()=>{
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId));
  const balance=balanceOf(user), p=(await paymentsGateway.purchasesFor(user))[0]!, t=Date.now();
  const free=async()=>{expect((await paymentsGateway.purchasesFor(user))[0]).toMatchObject({status:'paid',refundable:{ok:true}});expect(balanceOf(user)).toBe(balance);expect(paymentMarks().size).toBe(0);};
  await stage('opened','dp_1',t-9000);await stage('opened','dp_2',t-8000);await stage('won','dp_2',t-7000);
  await expectFrozen(p.id,balance-10,'dispute-needs-owner');
  await stage('won','dp_1',t-6000);await free();
  await stage('opened','dp_3',t-5000);
  // Dodo delivers the first dispute's win once more, under a new delivery id; then a win that says nothing of which dispute it ends.
  await stage('won','dp_1',t-6000);await expectFrozen(p.id,balance-10,'dispute-needs-owner');
  await stage('won',null,t-4000);await expectFrozen(p.id,balance-10,'dispute-needs-owner');
  expect(paymentMarks()).toEqual(new Map([[p.id,'disputed']]));
  await stage('won','dp_3',t-3000);await free();
});
it('the stages of a dispute that were kept because its payment was not stored apply in the order they happened once it is credited: a stage from before the win that came after it freezes nothing',async()=>{
  const before=balanceOf(user), c=await open(), t=Date.now();
  await stage('won','dp_1',t-3000);await stage('challenged','dp_1',t-4000);
  await deliver('payment.succeeded',payment(c.checkoutId));
  expect((await paymentsGateway.purchasesFor(user))[0]!.status).toBe('paid');expect(balanceOf(user)).toBe(before+10);expect(record(c.checkoutId).flag).toBeUndefined();
});
/** A notice of something that happened two hours ago, delivered now: too old to wait for its payment. */
function old(type:string,data:object,id=`msg_${++deliveries}`){
  const raw=JSON.stringify({business_id:'bus_madeup',type,timestamp:new Date(Date.now()-2*3600000).toISOString(),data}), seconds=Math.floor(Date.now()/1000);
  return paymentWebhook(new Request('https://site.example/api/payments/webhook',{method:'POST',body:raw,headers:{'webhook-id':id,'webhook-timestamp':String(seconds),'webhook-signature':signDodoWebhook(raw,id,seconds,SECRET)}}));
}
it('a refund or a dispute of a payment that is still not stored an hour later is answered 200 and kept once: Dodo stops sending what is not ours',async()=>{
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId));
  const before=JSON.stringify([paymentStore().records,paymentStore().events,getStore().purchases,getStore().ledger]);
  for(let n=0;n<2;n++){
    expect((await old('refund.succeeded',refund(c.checkoutId,{payment_id:'pay_of_another_product',refund_id:'ref_x',metadata:{}}),'msg_old_refund')).status).toBe(200);
    expect((await old('dispute.opened',{payload_type:'Dispute',dispute_id:'dp_1',payment_id:'pay_of_another_product',amount:'2261',currency:'USD'},'msg_old_dispute')).status).toBe(200);
  }
  expect(JSON.stringify([paymentStore().records,paymentStore().events,getStore().purchases,getStore().ledger])).toBe(before);
  // The note says what kind of notice it was and which payment and refund it named, and nothing else of its body.
  expect(paymentStore().unhandled).toEqual([{eventId:'msg_old_refund',type:'refund.succeeded',reason:'unknown-payment',receivedAt:expect.any(String),paymentId:'pay_of_another_product',refundId:'ref_x',amountMinor:2261,currency:'USD'},
    {eventId:'msg_old_dispute',type:'dispute.opened',reason:'unknown-payment',receivedAt:expect.any(String),paymentId:'pay_of_another_product',disputeId:'dp_1',occurredAt:expect.any(String)}]);
});
const outsideOf=(over:object={})=>({payload_type:'Refund',refund_id:'ref_panel',payment_id:'pay_A',status:'succeeded',amount:2261,currency:'USD',metadata:{},...over});
const disputeOf=(payment_id='pay_A')=>({payload_type:'Dispute',dispute_id:'dp_1',payment_id,amount:'2261',currency:'USD'});
it.each<[string,()=>Promise<unknown>,string,string]>([['whole refund in the Dodo panel',()=>old('refund.succeeded',outsideOf()),'refund-review','refund-needs-owner'],['dispute',()=>old('dispute.opened',disputeOf()),'disputed','dispute-needs-owner']])
('a %s that was kept because its payment was not stored applies when that payment is credited after all: the credits are written frozen and the owner is told',async(_name,early,mark,needs)=>{
  const before=balanceOf(user), c=await open();
  await early();
  expect(record(c.checkoutId)).toMatchObject({status:'pending',purchaseId:null});
  expect((await deliver('payment.succeeded',payment(c.checkoutId))).status).toBe(200);
  const p=(await paymentsGateway.purchasesFor(user))[0]!;
  expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='purchase'&&e.change===10)).toHaveLength(1);
  await expectFrozen(p.id,before,needs);
  expect(record(c.checkoutId).flag).toBe(mark);expect(paymentStore().attention).toEqual([`${mark}:${c.checkoutId}`]);expect(paymentMarks()).toEqual(new Map([[p.id,mark==='refund-review'?'refund-outside':mark]]));
});
it('a kept notice that moved no money for good, or is about another payment, freezes nothing: a part refunded or a refund that failed is marked, a dispute that was won meanwhile and another payment\'s notices leave the pack as paid',async()=>{
  const before=balanceOf(user), c=await open();
  await old('dispute.opened',disputeOf());await old('dispute.won',disputeOf());
  await old('refund.succeeded',outsideOf({payment_id:'pay_other'}));await old('dispute.opened',disputeOf('pay_other'));
  await deliver('payment.succeeded',payment(c.checkoutId));
  const p=(await paymentsGateway.purchasesFor(user))[0]!;
  expect(p.status).toBe('paid');expect(balanceOf(user)).toBe(before+10);expect(record(c.checkoutId).flag).toBeUndefined();
  const second=await open('/second');
  await old('refund.succeeded',outsideOf({payment_id:'pay_B',refund_id:'ref_part',is_partial:true,amount:100}));await old('refund.failed',outsideOf({payment_id:'pay_B',refund_id:'ref_failed',status:'failed'}));
  await deliver('payment.succeeded',payment(second.checkoutId,{payment_id:'pay_B'}));
  expect(getStore().purchases.find(row=>row.id===record(second.checkoutId).purchaseId)!.status).toBe('paid');expect(balanceOf(user)).toBe(before+20);
  expect(record(second.checkoutId).flag).toBe('refund-review');expect(record(second.checkoutId).outsideRefundId).toBeUndefined();
});
it('an event type we do not act on is answered 200 and kept once, with no effect',async()=>{
  const c=await open(), before=JSON.stringify([paymentStore().records,paymentStore().events,getStore().ledger]);
  for(let n=0;n<2;n++)expect(await deliver('subscription.active',{payload_type:'Subscription',subscription_id:'sub_1',metadata:{checkout_id:c.checkoutId}},'msg_sub')).toMatchObject({status:200,body:'{"ok":true}'});
  expect(JSON.stringify([paymentStore().records,paymentStore().events,getStore().ledger])).toBe(before);
  expect(paymentStore().unhandled).toEqual([{eventId:'msg_sub',type:'subscription.active',reason:'ignored',receivedAt:expect.any(String)}]);
});
it('nothing that comes from the browser writes a credit: not the fake provider\'s buttons, not the port, not a fake-signed notice, and no later sweep',async()=>{
  const before=balanceOf(user), c=await open();
  await expect(fakeNotice(user,c.checkoutId,'paid')).rejects.toThrow();
  await expect(paymentsGateway.complete(c.checkoutId,'paid')).rejects.toThrow('signed-payment-notice-required');
  await expect(paymentsGateway.notify(c.checkoutId,'paid')).rejects.toThrow('signed-payment-notice-required');
  const event={eventId:'forged',kind:'paid',checkoutId:c.checkoutId,providerSessionId:'cks_1',providerPaymentId:'pay_A',amountMinor:1900,currency:'USD',occurredAt:new Date().toISOString()};
  const raw=JSON.stringify(event), headers=new Headers({'webhook-id':'forged','webhook-timestamp':String(Math.floor(Date.now()/1000))});
  headers.set('webhook-signature',sign(raw,headers,SECRET));
  expect((await paymentWebhook(new Request('https://site.example/api/payments/webhook',{method:'POST',headers,body:raw}))).status).toBe(400);
  await reconcilePayment(c.checkoutId,user);await sweepPayments();
  expect(balanceOf(user)).toBe(before);expect(record(c.checkoutId).status).toBe('pending');expect(paymentStore().events).toHaveLength(0);
});
it('a checkout belongs to the provider that opened it: the other mode can neither pay, reuse nor refund it',async()=>{
  const before=balanceOf(user), real=await open(), fakeSecret=randomBytes(32).toString('hex');
  vi.stubEnv('VC_PAYMENTS','fake');vi.stubEnv('VC_PAYMENTS_WEBHOOK_SECRET',fakeSecret);
  const paid=(id:string)=>({eventId:crypto.randomUUID(),checkoutId:id,providerSessionId:record(id).sessionId,providerPaymentId:record(id).paymentId||'pay_A',kind:'paid' as const,amountMinor:1900,currency:'USD',occurredAt:new Date().toISOString()});
  expect(()=>receivePayment(paid(real.checkoutId),'forged')).toThrow('payment-provider-mismatch');
  await expect(fakeNotice(user,real.checkoutId,'paid')).rejects.toThrow();await sweepPayments();
  const fake=await open();
  expect(fake.checkoutId).not.toBe(real.checkoutId);expect(fake.url).toBe(`/checkout/mock/${fake.checkoutId}`);
  vi.stubEnv('VC_PAYMENTS','test');
  expect(()=>receivePayment(paid(fake.checkoutId),'forged',{taxMinor:0,cart:[{productId:PRODUCT,quantity:1}]})).toThrow('payment-provider-mismatch');
  expect((await deliver('payment.succeeded',payment(fake.checkoutId))).status).toBe(200);
  expect(balanceOf(user)).toBe(before);expect(calls).toHaveLength(1);
  // A paid Dodo pack whose refund was asked for cannot be refunded by the fake provider, nor a fake one by Dodo.
  await deliver('payment.succeeded',payment(real.checkoutId));
  const p=(await paymentsGateway.purchasesFor(user)).find(row=>row.status==='paid')!, admin=getStore().users.find(u=>u.role==='admin')!.id;
  await paymentsGateway.requestRefund(user,p.id);
  vi.stubEnv('VC_PAYMENTS','fake');
  const held=balanceOf(user), entries=getStore().ledger.length;
  await expect(sendRefund(admin,p.id,'asked','first')).rejects.toThrow('payment-provider-mismatch');
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refund-requested');
  expect(balanceOf(user)).toBe(held);expect(getStore().ledger).toHaveLength(entries);expect(record(real.checkoutId).refundKeys).toBeUndefined();
  expect(calls).toHaveLength(1);
});
it('the store keeps no key, no secret and nothing of a notice\'s body: no card digits, no address, no buyer email',async()=>{
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId));await deliver('payment.succeeded',payment(c.checkoutId,{metadata:{}}));
  const kept=JSON.stringify(getStore().paymentsState);
  for(const secret of [KEY,SECRET,SECRET.slice(6),'4242','Example Street','buyer@example.com'])expect(kept).not.toContain(secret);
  expect(paymentStore().events.map(e=>e.raw)).toEqual(['dodo:payment.succeeded']);
});
it('the fake provider\'s notice is refused before it writes anything: in test mode, and on a Dodo checkout in fake mode',async()=>{
  const c=await open(), untouched=JSON.stringify(getStore());
  for(const kind of ['paid','declined','pending','cancelled','expired'] as const)await expect(fakeNotice(user,c.checkoutId,kind)).rejects.toThrow('fake-payments-off');
  expect(JSON.stringify(getStore())).toBe(untouched);
  vi.stubEnv('VC_PAYMENTS','fake');vi.stubEnv('VC_PAYMENTS_WEBHOOK_SECRET',randomBytes(32).toString('hex'));
  await expect(fakeNotice(user,c.checkoutId,'paid')).rejects.toThrow('fake-payments-off');
  expect(JSON.stringify(getStore())).toBe(untouched);expect(calls).toHaveLength(1);
});
it('a disputed pack is not refunded from here: the admin\'s refund is refused before anything is written or sent',async()=>{
  const {c,p,admin}=await paidAndAsked();await dispute();
  const kept=()=>JSON.stringify([getStore().purchases,getStore().ledger,getStore().adminActions,record(c.checkoutId)]), before=kept(), sent=calls.length;
  await expect(sendRefund(admin,p.id,'asked','first')).rejects.toThrow('dispute-needs-owner');
  expect(kept()).toBe(before);expect(calls).toHaveLength(sent);
});
it('a refusal gives no credit back once the sent refund has a name: only a refund nobody named is known to have made none',async()=>{
  const {c,p,admin}=await paidAndAsked(), held=balanceOf(user);
  // While the call is on its way the refund is named (by a notice or a read) and is not settled yet.
  answer=()=>{record(c.checkoutId).refundId='ref_named';return json({code:'REFUND_WINDOW_EXPIRED'},422);};
  await sendRefund(admin,p.id,'asked','first').catch(()=>undefined);
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refund-sent');expect(balanceOf(user)).toBe(held);
  expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='returned')).toHaveLength(0);
});
it('a second payment on one checkout is on the admin\'s list under its own mark',async()=>{
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId));
  const p=(await paymentsGateway.purchasesFor(user))[0]!;
  await deliver('payment.succeeded',payment(c.checkoutId,{payment_id:'pay_second'}));
  expect(paymentMarks()).toEqual(new Map([[p.id,'second-payment']]));
});
it('in test mode the fake provider\'s notice is refused for a checkout the fake itself opened too, before it writes anything',async()=>{
  vi.stubEnv('VC_PAYMENTS','fake');vi.stubEnv('VC_PAYMENTS_WEBHOOK_SECRET',randomBytes(32).toString('hex'));
  const fake=await open();
  expect(record(fake.checkoutId).provider).toBeUndefined();
  vi.stubEnv('VC_PAYMENTS','test');
  const untouched=JSON.stringify(getStore());
  for(const kind of ['paid','declined','pending'] as const)await expect(fakeNotice(user,fake.checkoutId,kind)).rejects.toThrow('fake-payments-off');
  expect(JSON.stringify(getStore())).toBe(untouched);expect(calls).toHaveLength(0);
});
it('an opening call that fails outside the adapter leaves the owner a note that says "unknown": no text of a failure we did not write ourselves is kept',async()=>{
  const broken=vi.spyOn(DodoProvider.prototype,'createCheckout').mockRejectedValue(new Error(`made-up failure that quotes ${KEY}`));
  await expect(open()).rejects.toThrow('payment-provider-unavailable');
  broken.mockRestore();
  expect(paymentStore().attention).toEqual([`checkout-not-opened:${paymentStore().records[0]!.checkoutId}:unknown`]);
  expect(JSON.stringify(getStore())).not.toContain(KEY);
});
const bought=(checkoutId:string)=>getStore().purchases.find(p=>p.id===record(checkoutId).purchaseId)!;
const receipt=(purchaseId:string)=>getStore().outbox.find(m=>m.kind==='payment'&&m.data.purchaseId===purchaseId&&!m.data.refund)!.data;
it('a payment Dodo added tax to is stored with what Dodo itself reported: the purchase, its invoice and the receipt mail carry the tax and the total charged, and the credits and the pack price are the pack\'s as before',async()=>{
  const before=balanceOf(user), c=await open();await deliver('payment.succeeded',payment(c.checkoutId));
  const p=bought(c.checkoutId);
  expect(p).toMatchObject({status:'paid',credits:10,amount:'$19.00',amountCents:1900,taxCents:361,totalCents:2261});
  expect(balanceOf(user)).toBe(before+10);
  expect(getStore().invoices.find(i=>i.id===p.invoiceId)).toMatchObject({amount:'$19.00',taxCents:361,totalCents:2261});
  expect(receipt(p.id)).toMatchObject({amount:'$19.00',tax:'$3.61',total:'$22.61'});
});
it('a payment Dodo reported a tax of zero on is told as before: the zero is kept, and the receipt mail names no tax and no second total',async()=>{
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId,{total_amount:1900,tax:0}));
  const p=bought(c.checkoutId);
  expect(p).toMatchObject({amount:'$19.00',amountCents:1900,taxCents:0,totalCents:1900});
  expect(receipt(p.id)).toMatchObject({amount:'$19.00'});
  expect(receipt(p.id)).not.toHaveProperty('tax');expect(receipt(p.id)).not.toHaveProperty('total');
});
const INVOICE='https://test.dodopayments.com/invoices/payments/pay_A';
it('Dodo\'s own invoice of a payment is kept from its signed notice: the purchase and the receipt mail carry its address',async()=>{
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId,{invoice_url:INVOICE}));
  const p=bought(c.checkoutId);
  expect(p.invoiceUrl).toBe(INVOICE);expect(receipt(p.id).invoiceUrl).toBe(INVOICE);
});
it.each(['http://test.dodopayments.com/invoices/payments/pay_A','https://dodopayments.com.elsewhere.example/invoices/pay_A','https://elsewhere.example/?next=https://test.dodopayments.com/','https://user:secret@test.dodopayments.com/invoices/pay_A',
  'javascript:alert(1)','//test.dodopayments.com/invoices/pay_A','/invoices/pay_A',''])('an invoice address that is not Dodo\'s own https address (%s) is not kept: the payment is credited and its invoice stays the site\'s own page',async address=>{
  const before=balanceOf(user), c=await open();await deliver('payment.succeeded',payment(c.checkoutId,{invoice_url:address}));
  const p=bought(c.checkoutId);
  expect(balanceOf(user)).toBe(before+10);expect(p.status).toBe('paid');
  expect(p).not.toHaveProperty('invoiceUrl');expect(receipt(p.id)).not.toHaveProperty('invoiceUrl');
});
it('an invoice address too long to keep costs the buyer nothing: the paid notice is taken, the credits are written once, and the invoice stays the site\'s own page',async()=>{
  const before=balanceOf(user), c=await open();
  expect(await deliver('payment.succeeded',payment(c.checkoutId,{invoice_url:'https://test.dodopayments.com/'+'i'.repeat(5000)}))).toMatchObject({status:200,body:'{"ok":true}'});
  const p=bought(c.checkoutId);
  expect(balanceOf(user)).toBe(before+10);expect(p.status).toBe('paid');expect(paymentStore().unhandled??[]).toHaveLength(0);
  expect(p).not.toHaveProperty('invoiceUrl');expect(receipt(p.id)).not.toHaveProperty('invoiceUrl');
});
it('the gate itself checks the invoice address it is handed: one that is not Dodo\'s is dropped where the credit is written',async()=>{
  const c=await open();
  receivePayment({eventId:'read:pay_A',checkoutId:c.checkoutId,providerSessionId:'cks_1',providerPaymentId:'pay_A',kind:'paid',amountMinor:1900,currency:'USD',occurredAt:new Date().toISOString()},'read',
    {taxMinor:361,cart:[{productId:PRODUCT,quantity:1}],invoiceUrl:'https://elsewhere.example/invoice'});
  expect(bought(c.checkoutId)).toMatchObject({status:'paid',taxCents:361});
  expect(bought(c.checkoutId)).not.toHaveProperty('invoiceUrl');
});
it('the record of a refunded payment stays "paid": it says the payment succeeded, the refund is on the purchase, and a paid notice that comes afterwards cannot credit the pack a second time',async()=>{
  const {c,p,admin}=await paidAndAsked();
  await sendRefund(admin,p.id,'asked','first');await deliver('refund.succeeded',refund(c.checkoutId));
  const after=balanceOf(user);
  expect(record(c.checkoutId).status).toBe('paid');expect(bought(c.checkoutId).status).toBe('refunded');
  expect((await deliver('payment.succeeded',payment(c.checkoutId))).status).toBe(200);
  expect(balanceOf(user)).toBe(after);expect(bought(c.checkoutId).status).toBe('refunded');
  expect(getStore().purchases.filter(row=>row.userId===user&&row.id===p.id)).toHaveLength(1);
});
/** A refund of `pay_A` made in the Dodo panel: no checkout id of ours, and whatever amount and flag Dodo gives it. */
const panel=(refund_id:string,amount:number,over:object={})=>deliver('refund.succeeded',{payload_type:'Refund',refund_id,payment_id:'pay_A',status:'succeeded',amount,currency:'USD',metadata:{},...over});
it.each<[string,number,object]>([['less than was paid and no word of a part',100,{}],['less than was paid and "not a part"',100,{is_partial:false}],['the price before tax',1900,{}]])
('a refund in the Dodo panel is the whole one only when its amount is all the buyer paid, tax included (%s): a part freezes nothing, takes no credit, and waits for the owner with its amount',async(_name,amount,over)=>{
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId));
  const balance=balanceOf(user), p=(await paymentsGateway.purchasesFor(user))[0]!, admin=getStore().users.find(u=>u.role==='admin')!.id;
  // The same refund told twice, under two delivery ids, is one refund.
  for(let n=0;n<2;n++)expect((await panel('ref_part',amount,over)).status).toBe(200);
  expect((await paymentsGateway.purchasesFor(user))[0]).toMatchObject({status:'paid',refundable:{ok:true}});expect(balanceOf(user)).toBe(balance);
  expect(record(c.checkoutId)).toMatchObject({flag:'refund-review'});expect(record(c.checkoutId).outsideRefundId).toBeUndefined();
  expect(paymentMarks()).toEqual(new Map([[p.id,'refund-review']]));expect(partRefunded(p.id)).toBe(amount);
  // Nothing closes it from here: with credits spent the admin's refund is refused, and no credit leaves.
  writeEntry(user,'generation',-3,'made-up job',{from:p.id});await paymentsGateway.requestRefund(user,p.id).catch(()=>{});
  getStore().purchases.find(row=>row.id===p.id)!.status='refund-requested';
  await expect(sendRefund(admin,p.id,'asked','first')).rejects.toThrow('credits-used');
  expect(lotsOf(user).get(p.id)).toBe(7);expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='refund')).toHaveLength(0);expect(told('true',p.id)).toHaveLength(0);
});
it.each<[string,[string,number][]]>([['the whole sum and "a part"',[['ref_part',2261]]],['parts that add up to it, each called "a part"',[['ref_one',500],['ref_two',1761]]]])
('a refund in the Dodo panel that gives back all the buyer paid, tax included, is the whole one whatever Dodo calls it (%s): the amounts decide, the pack is frozen and the owner sees the whole refund',async(_name,parts)=>{
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId));
  const balance=balanceOf(user), p=(await paymentsGateway.purchasesFor(user))[0]!;
  // Each refund told twice, under two delivery ids, is one refund.
  for(const [refund_id,amount] of parts)for(let n=0;n<2;n++)expect((await panel(refund_id,amount,{is_partial:true})).status).toBe(200);
  expect(record(c.checkoutId)).toMatchObject({flag:'refund-review',outsideRefundId:parts.at(-1)![0]});
  expect(paymentMarks()).toEqual(new Map([[p.id,'refund-outside']]));expect(partRefunded(p.id)).toBe(0);
  await expectFrozen(p.id,balance-10,'refund-needs-owner');
  expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='refund')).toHaveLength(0);expect(told('true',p.id)).toHaveLength(0);
});
it('a refund in the Dodo panel that is told in another currency than the payment was made in says nothing of how much of it went back: INR 190000 is not "all of the 22.61 USD", so nothing is frozen, no credit moves, no amount is written and the owner sees a refund of unknown amount',async()=>{
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId));
  const balance=balanceOf(user), p=(await paymentsGateway.purchasesFor(user))[0]!;
  for(let n=0;n<2;n++)expect((await panel('ref_inr',190000,{currency:'INR'})).status).toBe(200);
  expect((await paymentsGateway.purchasesFor(user))[0]).toMatchObject({status:'paid',refundable:{ok:true}});expect(balanceOf(user)).toBe(balance);
  expect(record(c.checkoutId)).toMatchObject({flag:'refund-review',outsideRefunds:[{id:'ref_inr',amountMinor:null}]});expect(record(c.checkoutId).outsideRefundId).toBeUndefined();
  expect(paymentMarks()).toEqual(new Map([[p.id,'refund-review']]));expect(partRefunded(p.id)).toBe(0);
  // Parts in the payment's own currency still add up beside it.
  await panel('ref_usd',2261);
  expect(record(c.checkoutId).outsideRefundId).toBe('ref_usd');await expectFrozen(p.id,balance-10,'refund-needs-owner');
});
it('a sent refund whose id is not known does not take a refund told in another currency for its own, whatever the number: it stays sent, the buyer is told nothing, and the owner sees it',async()=>{
  const {c,p,admin}=await paidAndAsked(), held=balanceOf(user);
  answer=timeout;await sendRefund(admin,p.id,'asked','first');
  await panel('ref_inr',190000,{currency:'INR'});
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refund-sent');expect(record(c.checkoutId).refundId).toBeUndefined();expect(record(c.checkoutId).outsideRefundId).toBeUndefined();
  expect(record(c.checkoutId).flag).toBe('refund-review');expect(told('true',p.id)).toHaveLength(0);expect(balanceOf(user)).toBe(held);
});
it('parts that went back in the Dodo panel are counted once each: when they add up to all the buyer paid the whole payment is back, and the pack is frozen under the last of them',async()=>{
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId));
  const balance=balanceOf(user), p=(await paymentsGateway.purchasesFor(user))[0]!;
  await panel('ref_one',1000);await panel('ref_one',1000);await panel('ref_two',1000);
  expect(partRefunded(p.id)).toBe(2000);expect(record(c.checkoutId).outsideRefundId).toBeUndefined();expect(balanceOf(user)).toBe(balance);
  await panel('ref_three',261);
  expect(record(c.checkoutId).outsideRefundId).toBe('ref_three');expect(paymentMarks()).toEqual(new Map([[p.id,'refund-outside']]));expect(partRefunded(p.id)).toBe(0);
  await expectFrozen(p.id,balance-10,'refund-needs-owner');
});
it('a part that went back before its payment was stored is kept with its amount, and is still a part when that payment is credited: the credits are written free, and the owner sees the amount',async()=>{
  const before=balanceOf(user), c=await open();
  await old('refund.succeeded',outsideOf({refund_id:'ref_part',amount:100}),'msg_early_part');
  expect(paymentStore().unhandled).toEqual([{eventId:'msg_early_part',type:'refund.succeeded',reason:'unknown-payment',receivedAt:expect.any(String),paymentId:'pay_A',refundId:'ref_part',amountMinor:100,currency:'USD'}]);
  await deliver('payment.succeeded',payment(c.checkoutId));
  const p=(await paymentsGateway.purchasesFor(user))[0]!;
  expect(p).toMatchObject({status:'paid',refundable:{ok:true}});expect(balanceOf(user)).toBe(before+10);
  expect(record(c.checkoutId)).toMatchObject({flag:'refund-review'});expect(record(c.checkoutId).outsideRefundId).toBeUndefined();expect(partRefunded(p.id)).toBe(100);
});
it.each<[string,()=>unknown,string|undefined]>([
  ['in another currency than the payment\'s',()=>old('refund.succeeded',outsideOf({refund_id:'ref_early',amount:190000,currency:'INR'}),'msg_early'),'INR'],
  // A note that was kept before notes carried a currency: what its number counts is not known, so it is never read as the payment's own currency.
  ['by a note of before, which names no currency',()=>{(paymentStore().unhandled??=[]).push({eventId:'msg_early',type:'refund.succeeded',reason:'unknown-payment',receivedAt:new Date().toISOString(),paymentId:'pay_A',refundId:'ref_early',amountMinor:2261});},undefined],
])('a refund that was told before its payment was stored %s is a refund of unknown amount when that payment is credited: the number is not taken for all the buyer paid, the credits are written free, nothing is frozen and the owner sees "amount not known"',async(_name,tell,currency)=>{
  const before=balanceOf(user), c=await open();
  await tell();
  expect(paymentStore().unhandled).toEqual([{eventId:'msg_early',type:'refund.succeeded',reason:'unknown-payment',receivedAt:expect.any(String),paymentId:'pay_A',refundId:'ref_early',amountMinor:expect.any(Number),...(currency?{currency}:{})}]);
  await deliver('payment.succeeded',payment(c.checkoutId));
  const p=(await paymentsGateway.purchasesFor(user))[0]!;
  expect(p).toMatchObject({status:'paid',refundable:{ok:true}});expect(balanceOf(user)).toBe(before+10);
  expect(record(c.checkoutId)).toMatchObject({flag:'refund-review',outsideRefunds:[{id:'ref_early',amountMinor:null}]});expect(record(c.checkoutId).outsideRefundId).toBeUndefined();
  expect(paymentMarks().get(p.id)).toBe('refund-review');expect(refundAmountUnknown(p.id)).toBe(true);expect(partRefunded(p.id)).toBe(0);
  // Nothing closes it from here without a request to Dodo: the admin's refund of the unspent pack is sent like any other.
  await paymentsGateway.requestRefund(user,p.id);
  await sendRefund(getStore().users.find(u=>u.role==='admin')!.id,p.id,'asked','first');
  expect(calls.filter(call=>call.method==='POST'&&call.path==='/refunds')).toHaveLength(1);expect(told('true',p.id)).toHaveLength(0);
});
it('a mark put on a purchase after its refund was "refunded" is not taken off by that refund told once more: Dodo\'s notice named one refund, the answer to the call another, and the owner still sees it',async()=>{
  const {c,p,admin}=await paidAndAsked();
  answer=async call=>{
    if(call.method!=='POST'||call.path!=='/refunds')return dodo(call);
    await deliver('refund.succeeded',refund(c.checkoutId,{refund_id:'ref_told'}));
    return json({refund_id:'ref_answered',payment_id:'pay_A',status:'pending',amount:2261,currency:'USD',created_at:new Date().toISOString()});
  };
  await sendRefund(admin,p.id,'asked','first');
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refunded');expect(record(c.checkoutId)).toMatchObject({refundId:'ref_told',flag:'refund-review'});
  await deliver('refund.succeeded',refund(c.checkoutId));
  expect(record(c.checkoutId).flag).toBe('refund-review');expect(paymentMarks().get(p.id)).toBe('refund-review');expect(told('true',p.id)).toHaveLength(1);
});
/** A refund that went through in the Dodo panel, told without its amount: as null, or with no amount at all. */
const amountless=(amount:null|undefined)=>({payload_type:'Refund',refund_id:'ref_bare',payment_id:'pay_A',status:'succeeded',...(amount===null?{amount}:{}),currency:'USD',metadata:{}});
it.each([['null for its amount',null],['no amount at all',undefined]] as const)('a refund notice in which Dodo gives %s is not dropped: the refund is put before the owner as one of unknown amount, the pack is not frozen and no credit is taken; told again with its amount it counts like any other refund',async(_name,amount)=>{
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId));
  const balance=balanceOf(user), p=(await paymentsGateway.purchasesFor(user))[0]!;
  expect((await deliver('refund.succeeded',amountless(amount))).status).toBe(200);
  expect(paymentStore().unhandled??[]).toHaveLength(0);
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('paid');expect(balanceOf(user)).toBe(balance);
  expect(record(c.checkoutId)).toMatchObject({flag:'refund-review',outsideRefunds:[{id:'ref_bare',amountMinor:null}]});expect(record(c.checkoutId).outsideRefundId).toBeUndefined();
  expect(paymentMarks().get(p.id)).toBe('refund-review');expect(refundAmountUnknown(p.id)).toBe(true);expect(partRefunded(p.id)).toBe(0);
  expect(paymentStore().attention).toEqual([`refund-review:${c.checkoutId}`]);
  await panel('ref_bare',2261);
  expect(record(c.checkoutId)).toMatchObject({outsideRefundId:'ref_bare',outsideRefunds:[{id:'ref_bare',amountMinor:2261}]});expect(refundAmountUnknown(p.id)).toBe(false);
  await expectFrozen(p.id,balance-10,'refund-needs-owner');
});
it('a refund sent from here that Dodo\'s notice tells of without an amount is not "refunded": how much went back is not known, so it waits for the owner, its credits stay out and the buyer is told nothing',async()=>{
  const {c,p,admin}=await paidAndAsked();
  await sendRefund(admin,p.id,'asked','first');
  const held=balanceOf(user);
  expect((await deliver('refund.succeeded',refund(c.checkoutId,{amount:null}))).status).toBe(200);
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refund-sent');expect(balanceOf(user)).toBe(held);expect(told('true',p.id)).toHaveLength(0);
  expect(paymentMarks().get(p.id)).toBe('refund-review');expect(record(c.checkoutId).outsideRefunds).toBeUndefined();expect(paymentStore().unhandled??[]).toHaveLength(0);
});
it('a refund told without an amount before its payment was stored is kept without one, and is a refund of unknown amount when that payment is credited: the credits are written free and the owner sees it',async()=>{
  const before=balanceOf(user), c=await open();
  await old('refund.succeeded',amountless(null),'msg_early_bare');
  expect(paymentStore().unhandled).toEqual([{eventId:'msg_early_bare',type:'refund.succeeded',reason:'unknown-payment',receivedAt:expect.any(String),paymentId:'pay_A',refundId:'ref_bare',currency:'USD'}]);
  await deliver('payment.succeeded',payment(c.checkoutId));
  const p=(await paymentsGateway.purchasesFor(user))[0]!;
  expect(p).toMatchObject({status:'paid',refundable:{ok:true}});expect(balanceOf(user)).toBe(before+10);
  expect(record(c.checkoutId)).toMatchObject({flag:'refund-review',outsideRefunds:[{id:'ref_bare',amountMinor:null}]});expect(record(c.checkoutId).outsideRefundId).toBeUndefined();expect(refundAmountUnknown(p.id)).toBe(true);
});
it('a sent refund whose id is not known does not take a part for its own: a part that went back meanwhile settles nothing, and the whole refund that follows still does',async()=>{
  const {c,p,admin}=await paidAndAsked(), held=balanceOf(user);
  answer=timeout;await sendRefund(admin,p.id,'asked','first');
  await panel('ref_part',100);
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refund-sent');expect(record(c.checkoutId).refundId).toBeUndefined();
  expect(record(c.checkoutId).flag).toBe('refund-review');expect(told('true',p.id)).toHaveLength(0);
  await panel('ref_whole',2261);
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refunded');expect(record(c.checkoutId).refundId).toBe('ref_whole');expect(balanceOf(user)).toBe(held);
});
it.each([['PAYMENT_NOT_SUCCEEDED',422],['REFUND_WINDOW_EXPIRED',422]])('a pack frozen by a panel refund is closed by the admin\'s refund also when Dodo answers %s: no refund was made because the money is back already, so the purchase is refunded, its credits leave once, the mark is gone and the admin is not sent round again',async(code,status)=>{
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId));
  const balance=balanceOf(user), p=(await paymentsGateway.purchasesFor(user))[0]!, admin=getStore().users.find(u=>u.role==='admin')!.id;
  await panelRefund(c.checkoutId);
  answer=()=>json({code},status);
  expect((await sendRefund(admin,p.id,'refunded in the panel','first')).outcome).toBe('done');
  expect(getStore().purchases.find(row=>row.id===p.id)).toMatchObject({status:'refunded',refund:{settledAt:expect.any(String)}});
  expect(balanceOf(user)).toBe(balance-10);expect(lotsOf(user).get(p.id)).toBe(0);
  expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='refund'&&e.change===-10)).toHaveLength(1);expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='returned')).toHaveLength(0);
  expect(record(c.checkoutId)).toMatchObject({refundId:'ref_panel'});expect(record(c.checkoutId).flag).toBeUndefined();expect(paymentMarks().size).toBe(0);
  expect(paymentStore().attention).toEqual([`refund-review:${c.checkoutId}`]);
  expect(told('true',p.id)).toHaveLength(1);expect(told('sent',p.id)).toHaveLength(0);
  expect((await sendRefund(admin,p.id,'again','second')).outcome).toBe('already-done');
  expect(calls.filter(call=>call.path==='/refunds')).toHaveLength(0);
});
it('a pack none of whose credits were spent, frozen by a whole refund in the Dodo panel, is closed by the admin\'s refund without asking Dodo for one: the money is back already, so the answer says "refunded" at once and never "sent"',async()=>{
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId));
  const balance=balanceOf(user), p=(await paymentsGateway.purchasesFor(user))[0]!, admin=getStore().users.find(u=>u.role==='admin')!.id;
  await panelRefund(c.checkoutId);
  answer=call=>{if(call.path==='/refunds')throw new Error('made-up: no refund may be asked for');return dodo(call);};
  expect(await sendRefund(admin,p.id,'refunded in the panel','first')).toMatchObject({outcome:'done',value:{status:'refunded'}});
  expect(calls.filter(call=>call.path==='/refunds')).toHaveLength(0);
  expect(balanceOf(user)).toBe(balance-10);expect(lotsOf(user).get(p.id)).toBe(0);expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='refund').map(e=>e.change)).toEqual([-10]);
  expect(record(c.checkoutId)).toMatchObject({refundId:'ref_panel'});expect(paymentMarks().size).toBe(0);expect(paymentStore().attention).toEqual([`refund-review:${c.checkoutId}`]);
  expect(told('true',p.id)).toHaveLength(1);expect(told('sent',p.id)).toHaveLength(0);
});
it.each([['PAYMENT_ALREADY_REFUNDED',422],['PAYMENT_NOT_SUCCEEDED',422]])('a refund that was sent while only a part of the money was back, and whose last part went back in the Dodo panel before Dodo answered %s: the whole payment is back, so the purchase is closed as refunded, the admin is answered "refunded" and not "sent", and no credit comes back',async(code,status)=>{
  const {c,p,admin}=await paidAndAsked(), held=balanceOf(user);
  await panel('ref_one',500);
  answer=async call=>{if(call.path!=='/refunds')return dodo(call);await panel('ref_two',1761);return json({code},status);};
  expect(await sendRefund(admin,p.id,'asked','first')).toMatchObject({outcome:'done',value:{status:'refunded'}});
  expect(getStore().purchases.find(row=>row.id===p.id)).toMatchObject({status:'refunded',refund:{settledAt:expect.any(String)}});
  expect(balanceOf(user)).toBe(held);expect(lotsOf(user).get(p.id)).toBe(0);expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='returned')).toHaveLength(0);
  expect(record(c.checkoutId)).toMatchObject({refundId:'ref_two'});expect(paymentMarks().size).toBe(0);
  expect(told('true',p.id)).toHaveLength(1);expect(told('sent',p.id)).toHaveLength(0);
  expect(calls.filter(call=>call.path==='/refunds')).toHaveLength(1);
});
it('a refund whose call never answered, and whose last part went back in the Dodo panel meanwhile, is closed by the next read: the refund Dodo lists last is the refund, and the mark is gone',async()=>{
  const {c,p,admin}=await paidAndAsked(), held=balanceOf(user);
  await panel('ref_one',500);
  answer=async call=>{
    if(call.method==='POST'&&call.path==='/refunds'){await panel('ref_two',1761);return timeout();}
    if(call.method==='GET'&&call.path==='/payments/pay_A')return json({payment_id:'pay_A',status:'succeeded',total_amount:2261,tax:361,currency:'USD',metadata:{checkout_id:c.checkoutId},checkout_session_id:record(c.checkoutId).sessionId,
      product_cart:[{product_id:PRODUCT,quantity:1}],refunds:[{refund_id:'ref_one',status:'succeeded',amount:500},{refund_id:'ref_two',status:'succeeded',amount:1761}],created_at:new Date().toISOString()});
    return dodo(call);
  };
  expect((await sendRefund(admin,p.id,'asked','first')).value.status).toBe('refund-sent');
  expect(record(c.checkoutId)).toMatchObject({outsideRefundId:'ref_two',flag:'refund-review'});expect(record(c.checkoutId).refundId).toBeUndefined();
  await sweepPayments();
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refunded');expect(balanceOf(user)).toBe(held);
  expect(record(c.checkoutId)).toMatchObject({refundId:'ref_two'});expect(record(c.checkoutId).flag).toBeUndefined();expect(told('true',p.id)).toHaveLength(1);
});
it('a dispute whose amount Dodo sends as a number, not as text, freezes the pack all the same',async()=>{
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId));
  const balance=balanceOf(user), p=(await paymentsGateway.purchasesFor(user))[0]!;
  expect((await deliver('dispute.opened',{payload_type:'Dispute',dispute_id:'dp_1',payment_id:'pay_A',amount:2261,currency:'USD'})).status).toBe(200);
  await expectFrozen(p.id,balance-10,'dispute-needs-owner');expect(paymentMarks()).toEqual(new Map([[p.id,'disputed']]));
});
it('a paid notice whose invoice address is not text is credited once, without an address: the buyer does not wait days for the credits',async()=>{
  const before=balanceOf(user), c=await open();
  for(let n=0;n<2;n++)expect((await deliver('payment.succeeded',payment(c.checkoutId,{invoice_url:{href:'https://test.dodopayments.com/invoices/payments/pay_A'}}),'msg_odd_invoice')).status).toBe(200);
  expect(balanceOf(user)).toBe(before+10);expect((await paymentsGateway.purchasesFor(user))[0]).toMatchObject({status:'paid'});
  expect(getStore().purchases.find(row=>row.id===record(c.checkoutId).purchaseId)!.invoiceUrl).toBeUndefined();
});
it('credits of a charge that come back to a pack after it was closed leave it again at once: a refunded pack gives nobody credits to spend, while one that is not refunded gets them back as before',async()=>{
  const before=balanceOf(user), c=await open();await deliver('payment.succeeded',payment(c.checkoutId));
  const p=(await paymentsGateway.purchasesFor(user))[0]!, admin=getStore().users.find(u=>u.role==='admin')!.id;
  const charge=[{lot:p.id,credits:3}];
  writeEntry(user,'generation',-3,'made-up job',{from:p.id});writeEntry(user,'returned',3,'made-up job',{backTo:charge});
  expect(balanceOf(user)).toBe(before+10);expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='refund')).toHaveLength(0);
  writeEntry(user,'generation',-3,'made-up job',{from:p.id});
  await panelRefund(c.checkoutId);
  expect((await sendRefund(admin,p.id,'refunded in the panel','first')).outcome).toBe('done');
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refunded');expect(balanceOf(user)).toBe(before);
  // The job that spent the three credits fails afterwards: they come back to a pack whose money is with the buyer again.
  const back=writeEntry(user,'returned',3,'made-up job',{backTo:charge});
  expect(back).toMatchObject({type:'returned',change:3});
  expect(balanceOf(user)).toBe(before);expect(lotsOf(user).get(p.id)).toBe(0);
  expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='refund').map(e=>e.change)).toEqual([-7,-3]);
  expect(getStore().ledger.at(-1)).toMatchObject({type:'refund',change:-3,by:{kind:'system'},balanceAfter:before});
});
it('a sent refund whose id is not known does not take a refund Dodo calls "a part" for its own, though that refund names the whole sum: it stays sent and without a name, nobody is told "refunded", and the money that is back holds the pack like a whole panel refund',async()=>{
  const {c,p,admin}=await paidAndAsked(), held=balanceOf(user);
  answer=timeout;await sendRefund(admin,p.id,'asked','first');
  await panel('ref_flagged',2261,{is_partial:true});
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refund-sent');expect(record(c.checkoutId).refundId).toBeUndefined();
  expect(record(c.checkoutId)).toMatchObject({flag:'refund-review',outsideRefundId:'ref_flagged'});expect(told('true',p.id)).toHaveLength(0);expect(balanceOf(user)).toBe(held);
});
it('credits of a charge that was drawn from several packs come back after one of those packs was closed: only that pack\'s own share leaves again, and what came back to the others can be spent',async()=>{
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId));
  const p=(await paymentsGateway.purchasesFor(user))[0]!, admin=getStore().users.find(u=>u.role==='admin')!.id, all=balanceOf(user);
  writeEntry(user,'generation',-all,'made-up job');
  const charge=getStore().ledger.at(-1)!.lots, share=charge.find(lot=>lot.lot===p.id)!.credits;
  expect(share).toBe(10);expect(charge.length).toBeGreaterThan(1);expect(balanceOf(user)).toBe(0);
  await panelRefund(c.checkoutId);
  expect((await sendRefund(admin,p.id,'refunded in the panel','first')).outcome).toBe('done');
  // The job fails afterwards: the whole charge comes back, each credit to the pack it was taken from.
  writeEntry(user,'returned',all,'made-up job',{backTo:charge});
  expect(balanceOf(user)).toBe(all-share);expect(lotsOf(user).get(p.id)).toBe(0);expect([...lotsOf(user).values()].every(left=>left>=0)).toBe(true);
  expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='refund').map(e=>e.change)).toEqual([-share]);
  expect(getStore().ledger.at(-1)).toMatchObject({type:'refund',change:-share,by:{kind:'system'},balanceAfter:all-share});
});
it('a refunded pack takes back only what comes back to its own buyer: credits written to another account under that pack\'s id stay with that account',async()=>{
  const c=await open();await deliver('payment.succeeded',payment(c.checkoutId));
  const p=(await paymentsGateway.purchasesFor(user))[0]!, admin=getStore().users.find(u=>u.role==='admin')!.id;
  await panelRefund(c.checkoutId);
  expect((await sendRefund(admin,p.id,'refunded in the panel','first')).outcome).toBe('done');
  const before=balanceOf(admin), entries=getStore().ledger.length;
  writeEntry(admin,'returned',3,'made-up job',{backTo:[{lot:p.id,credits:3}]});
  expect(balanceOf(admin)).toBe(before+3);expect(getStore().ledger).toHaveLength(entries+1);expect(getStore().ledger.at(-1)).toMatchObject({userId:admin,type:'returned',change:3});
});
it('the disputes that were kept because their payment was not stored are told apart by their own ids once it is credited: the win of one does not free a pack another one still holds',async()=>{
  const before=balanceOf(user), c=await open(), kept=(type:string,dispute_id:string)=>old(type,{payload_type:'Dispute',dispute_id,payment_id:'pay_A',amount:'2261',currency:'USD'});
  await kept('dispute.opened','dp_1');await kept('dispute.opened','dp_2');await kept('dispute.won','dp_2');
  await deliver('payment.succeeded',payment(c.checkoutId));
  const p=(await paymentsGateway.purchasesFor(user))[0]!;
  await expectFrozen(p.id,before,'dispute-needs-owner');expect(paymentMarks()).toEqual(new Map([[p.id,'disputed']]));
  expect(record(c.checkoutId).disputes).toEqual([{id:'dp_1',at:expect.any(String),won:false},{id:'dp_2',at:expect.any(String),won:true}]);
});
// Dodo's own answer, word for word, to a refund asked in its test mode while the account's wallet could not cover it (2026-10-07): HTTP 409, and the payment listed no refund afterwards.
const NO_FUNDS=()=>json({code:'INSUFFICIENT_WALLET_FUNDS',message:'Insufficient funds in wallet'},409);
it('a refund Dodo refuses because its wallet cannot cover it has failed at once, not "result awaited": the credits are back, nothing is frozen, the buyer is never told money is on its way, and the owner\'s list says why',async()=>{
  const {c,p,admin}=await paidAndAsked(), held=balanceOf(user);
  answer=NO_FUNDS;
  await expect(sendRefund(admin,p.id,'asked','first')).rejects.toEqual(new Error('refund-refused'));
  expect((await paymentsGateway.purchasesFor(user)).find(row=>row.id===p.id)!.status).toBe('refund-failed');
  expect(balanceOf(user)).toBe(held+10);expect(lotsOf(user).get(p.id)).toBe(10);
  expect(record(c.checkoutId)).toMatchObject({status:'paid',refundNote:'no-funds'});
  expect(record(c.checkoutId).flag).toBeUndefined();expect(record(c.checkoutId).frozenFrom).toBeUndefined();expect(record(c.checkoutId).refundId).toBeUndefined();
  expect(told('sent',p.id)).toHaveLength(0);expect(told('true',p.id)).toHaveLength(0);
  expect(paymentMarks().get(p.id)).toBe('refund-no-funds');expect(refundRefusal(p.id)).toBe('no-funds');
  expect(paymentStore().attention).toEqual([`refund-refused:${p.id}:dodo-no-refund:409:INSUFFICIENT_WALLET_FUNDS`]);
  expect(JSON.stringify(getStore())).not.toContain('Insufficient funds in wallet');
  // The minute's tour has nothing to ask Dodo about it, and an hour later it is still the same failed refund: no credit moves a second time.
  await sweepPayments();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(Date.now()+2*3600000);await sweepPayments();
  expect(calls.filter(call=>call.path.startsWith('/refunds'))).toHaveLength(1);
  expect(balanceOf(user)).toBe(held+10);expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='returned')).toHaveLength(1);
});
it('a refund Dodo\'s wallet could not cover can be sent again from the list, as often as it takes: each try is a new request under its own key, the try Dodo takes is the refund, and the reason is gone from the list',async()=>{
  const {c,p,admin}=await paidAndAsked(), held=balanceOf(user);
  answer=NO_FUNDS;
  await expect(sendRefund(admin,p.id,'asked','first')).rejects.toThrow('refund-refused');
  await expect(sendRefund(admin,p.id,'asked again','second')).rejects.toThrow('refund-refused');
  expect(balanceOf(user)).toBe(held+10);expect(paymentMarks().get(p.id)).toBe('refund-no-funds');
  // The confirmation that was refused is not a new try: the same click sent again asks Dodo nothing.
  expect((await sendRefund(admin,p.id,'asked','first')).outcome).toBe('already-done');
  expect(calls.filter(call=>call.path==='/refunds')).toHaveLength(2);
  answer=dodo;
  expect((await sendRefund(admin,p.id,'the wallet is filled','third')).value.status).toBe('refund-sent');
  // Dodo keeps no idempotency key (the value only travels as metadata, as its real refunds show), and ours is new for each try: no earlier refusal can answer for this one.
  expect(calls.filter(call=>call.path==='/refunds').map(call=>call.body!.metadata.refund_key)).toEqual([`refund:${p.id}:1`,`refund:${p.id}:2`,`refund:${p.id}:3`]);
  expect(record(c.checkoutId).refundId).toBe('ref_4');expect(record(c.checkoutId).refundNote).toBeUndefined();
  expect(paymentMarks().get(p.id)).toBeUndefined();expect(refundRefusal(p.id)).toBeNull();
  expect(balanceOf(user)).toBe(held);expect(told('sent',p.id)).toHaveLength(1);
  await deliver('refund.succeeded',refund(c.checkoutId));
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refunded');expect(balanceOf(user)).toBe(held);
});
it('"insufficient wallet funds" for a pack whose whole payment went back in the Dodo panel already closes it with that refund: the money is back, so nothing fails and no credit comes back',async()=>{
  const {c,p,admin}=await paidAndAsked(), held=balanceOf(user);
  await deliver('refund.succeeded',refund(c.checkoutId,{refund_id:'ref_panel',metadata:{}}));
  // The notice of the panel refund arrives while Dodo is being asked: the pack was not known to be closed when the refund was sent.
  delete record(c.checkoutId).outsideRefundId;
  answer=()=>{record(c.checkoutId).outsideRefundId='ref_panel';return NO_FUNDS();};
  expect((await sendRefund(admin,p.id,'asked','first')).value.status).toBe('refunded');
  expect(balanceOf(user)).toBe(held);expect(paymentMarks().get(p.id)).toBeUndefined();
});
it('the note that a sent refund\'s result is not known is gone once that refund is "refunded": nothing is left for the owner to look at; while it is still awaited the note stays, and so does another purchase\'s',async()=>{
  const {c,p,admin}=await paidAndAsked(), note=`refund-unknown:${p.id}`;
  // Dodo's real answer to a refund of a payment whose money is back already (HTTP 400): the outcome is not known from it.
  answer=()=>json({code:'PAYMENT_ALREADY_REFUNDED',message:'This payment has already been refunded'},400);
  await sendRefund(admin,p.id,'asked','first');
  expect(paymentStore().attention).toEqual([note]);
  await deliver('refund.failed',refund(c.checkoutId,{refund_id:'ref_of_someone_else',status:'failed',metadata:{}}));
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refund-sent');expect(paymentStore().attention).toContain(note);
  await deliver('refund.succeeded',refund(c.checkoutId,{refund_id:'ref_made_at_dodo'}));
  expect(getStore().purchases.find(row=>row.id===p.id)!.status).toBe('refunded');
  expect(paymentStore().attention).not.toContain(note);expect(paymentStore().attention.filter(a=>a.startsWith('refund-unknown'))).toEqual([]);
  // Another purchase's note is its own: it stays while that refund is awaited.
  answer=dodo;const other=await open('/account');await deliver('payment.succeeded',payment(other.checkoutId,{payment_id:'pay_B'}));
  const q=getStore().purchases.find(row=>row.id===record(other.checkoutId).purchaseId)!;
  await paymentsGateway.requestRefund(user,q.id);answer=timeout;await sendRefund(admin,q.id,'asked','second');
  await deliver('refund.succeeded',refund(c.checkoutId,{refund_id:'ref_made_at_dodo'}));
  expect(paymentStore().attention.filter(a=>a.startsWith('refund-unknown'))).toEqual([`refund-unknown:${q.id}`]);
});
