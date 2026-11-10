// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getStore, resetStore } from '../mock/store';
import { balanceOf } from '../mock/ledger';
import { forgetReconciliation, partRefunded, paymentMarks, paymentsGateway, refundAmountUnknown, sendRefund, sweepPayments, SWEEP_ASKS } from './payments-gateway';
import { paymentStore } from './payments-store';
import { paymentWebhook } from './payments/webhook';
import { signDodoWebhook } from './payments/dodo-test-helpers';

/**
 * Refunds made at Dodo itself, in the shape of its real answers: the sweep's second look at payments that were credited (money that went back
 * and whose notice never came), and, at the end, the notices of the same refunds.
 * The payments and refunds below have the shape of Dodo's real test-mode answers of 2026-10-07 (every field name, `is_partial`,
 * `refund_status` and the amounts); every id, name and address is made up. The network is the tables in this file.
 * The envelope of a notice (`business_id`, `type`, `timestamp`, `data` with `payload_type`) is the one the code assumes from Dodo's documents:
 * no real delivery was captured, only the refund objects inside it are real.
 */
const KEY='made-up-dodo-test-key-0123456789', SECRET='whsec_'+randomBytes(32).toString('base64');
const PRODUCTS:Record<string,string>={'pack-starter':'pdt_madeupstarter','pack-standard':'pdt_madeupstandard','pack-studio':'pdt_madeupstudio'};
const HOUR=3600000, DAY=24*HOUR;
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
type Row=Record<string,unknown>;
let calls:string[], sessions:Record<string,Row>, payments:Record<string,Row>, refunds:Record<string,Row>, user:string, admin:string, down:(()=>Response)|null, refundAnswer:((paymentId:string)=>Response)|null, seq=0;
beforeEach(()=>{
  vi.unstubAllEnvs();
  for(const [name,value] of Object.entries({VC_PAYMENTS:'test',DODO_API_KEY_TEST:KEY,DODO_WEBHOOK_SECRET_TEST:SECRET,PUBLIC_BASE_URL:'http://127.0.0.1:3400',
    DODO_PRODUCT_PACK_STARTER:PRODUCTS['pack-starter'],DODO_PRODUCT_PACK_STANDARD:PRODUCTS['pack-standard'],DODO_PRODUCT_PACK_STUDIO:PRODUCTS['pack-studio']}))vi.stubEnv(name,value);
  resetStore();forgetReconciliation();calls=[];sessions={};payments={};refunds={};down=null;refundAnswer=null;
  user=getStore().users.find(u=>u.role==='customer')!.id;admin=getStore().users.find(u=>u.role==='admin')!.id;
  vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>{
    const path=new URL(url).pathname, [,table,id]=path.split('/');
    calls.push(`${init.method} ${path}`);
    if(init.method==='POST'&&path==='/checkouts')return json({session_id:`cks_${++seq}`,checkout_url:`https://test.checkout.dodopayments.com/session/cks_${seq}`});
    if(init.method==='POST'&&path==='/refunds')return refundAnswer?refundAnswer(JSON.parse(String(init.body)).payment_id):json({code:'NOT_FOUND'},404);
    if(down)return down();
    const row=table==='checkouts'?sessions[id!]??{id,payment_id:null,payment_status:null}:table==='payments'?payments[id!]:refunds[id!];
    return row?json(row):json({code:'NOT_FOUND'},404);
  });
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});

const record=(checkoutId:string)=>paymentStore().records.find(r=>r.checkoutId===checkoutId)!;
const reads=()=>calls.filter(call=>call.startsWith('GET'));
const later=(ms:number)=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(Date.now()+ms);};
const statusOf=(purchaseId:string)=>getStore().purchases.find(p=>p.id===purchaseId)!.status;
const told=(kind:string,purchaseId:string)=>getStore().outbox.filter(m=>m.kind==='payment'&&m.data.refund===kind&&m.data.purchaseId===purchaseId);
async function deliver(type:string,data:object,id=`msg_${++seq}`){
  const raw=JSON.stringify({business_id:'bus_madeup',type,timestamp:new Date().toISOString(),data}), seconds=Math.floor(Date.now()/1000);
  const headers=new Headers({'webhook-id':id,'webhook-timestamp':String(seconds),'webhook-signature':signDodoWebhook(raw,id,seconds,SECRET)});
  return (await paymentWebhook(new Request('https://site.example/api/payments/webhook',{method:'POST',headers,body:raw}))).status;
}
/** A refund as Dodo's `POST /refunds` and `GET /refunds/{id}` give it. Every refund of a payment that went back in more than one is "partial", the last one too. */
const refundOf=(paymentId:string,refundId:string,amount:number,over:Row={}):Row=>({refund_id:refundId,payment_id:paymentId,business_id:'bus_madeup',amount,currency:'USD',status:'succeeded',reason:'made up',
  created_at:'2026-10-07T11:34:59.672142Z',is_partial:true,metadata:{},customer:{customer_id:'cus_madeup',name:'Made Up',email:'buyer@example.com',phone_number:null,metadata:{}},brand_id:'bus_madeup',
  network_reference:null,network_reference_type:null,network_reference_updated_at:null,...over});
/** The same refund as the payment's own list carries it: without `metadata`, `customer` and `brand_id`. */
const listed=(refund:Row):Row=>Object.fromEntries(Object.entries(refund).filter(([name])=>!['metadata','customer','brand_id'].includes(name)));
/** A payment as Dodo's `GET /payments/{id}` gives it. */
function dodoPayment(checkoutId:string,packId:string,paymentId:string,total:number,tax:number,over:Row={}):Row {
  return {payment_id:paymentId,business_id:'bus_madeup',status:'succeeded',total_amount:total,currency:'USD',payment_method:'card',payment_method_type:'credit',payment_method_id:'pm_madeup',is_update_payment_method:false,
    created_at:new Date().toISOString(),updated_at:null,disputes:[],refunds:[],refund_status:null,customer:{customer_id:'cus_madeup',name:'Made Up',email:'buyer@example.com',phone_number:null,metadata:{}},
    subscription_id:null,is_multi_subscription:false,subscription_ids:[],product_cart:[{product_id:PRODUCTS[packId],quantity:1}],payment_link:'https://test.checkout.dodopayments.com/madeup',tax,
    metadata:{checkout_id:checkoutId},error_message:null,error_code:null,discount_id:null,discounts:null,settlement_amount:total,settlement_tax:tax,settlement_currency:'USD',
    billing:{country:'GB',state:'Greater London',city:'London',street:'1 Made Up Street',zipcode:'NW1 6XE'},card_last_four:'4242',card_issuing_country:'GB',card_type:'credit',card_network:'visa',card_holder_name:null,
    brand_id:'bus_madeup',digital_products_delivered:false,checkout_session_id:record(checkoutId).sessionId,invoice_id:'inv_madeup',invoice_url:`https://test.dodopayments.com/invoices/payments/${paymentId}`,
    custom_field_responses:null,retry_attempt:0,payment_provider:'dodo',...over};
}
/** A pack bought and credited through Dodo's signed notice. Dodo's own record of the payment is in the table, to be changed as money goes back there. */
async function buy(packId:string,total:number,tax:number,paymentId=`pay_${++seq}`){
  const c=await paymentsGateway.startCheckout(user,packId,`/gallery?n=${++seq}`);
  payments[paymentId]=dodoPayment(c.checkoutId,packId,paymentId,total,tax);
  expect(await deliver('payment.succeeded',{payload_type:'Payment',...payments[paymentId]})).toBe(200);
  const p=getStore().purchases.find(row=>row.id===record(c.checkoutId).purchaseId)!;
  expect(p.status).toBe('paid');
  return {c,p,paymentId};
}
/** What went back at Dodo so far, as its list and its `refund_status` then say. */
const wentBack=(paymentId:string,status:'partial'|'full',...list:Row[])=>{payments[paymentId]={...payments[paymentId],refunds:list.map(listed),refund_status:status};};

it('a pack whose money went back at Dodo in two parts, with no notice of either, is found by the sweep\'s own look: the first part is put before the owner and freezes nothing, the second makes it the whole payment and freezes the pack, and the admin closes it without sending money',async()=>{
  // Dodo's real case: 202.80 paid (169.00 + 33.80 tax), 100.00 and 102.80 back from its panel, both "partial", `refund_status` partial and then full.
  const {c,p,paymentId}=await buy('pack-studio',20280,3380), balance=balanceOf(user);
  const first=refundOf(paymentId,'ref_part1',10000), second=refundOf(paymentId,'ref_part2',10280,{created_at:'2026-10-07T11:36:25.028640Z'});
  wentBack(paymentId,'partial',first);
  // A payment that was just credited is not looked at again yet.
  await sweepPayments();expect(reads()).toEqual([]);expect(paymentMarks().size).toBe(0);
  later(HOUR+1000);await sweepPayments();
  expect(reads()).toEqual([`GET /payments/${paymentId}`]);
  expect(paymentMarks().get(p.id)).toBe('refund-review');expect(partRefunded(p.id)).toBe(10000);
  expect(statusOf(p.id)).toBe('paid');expect(balanceOf(user)).toBe(balance);expect(record(c.checkoutId).outsideRefundId).toBeUndefined();
  wentBack(paymentId,'full',first,second);
  // Looked at a minute ago: not again before its turn.
  later(60000);await sweepPayments();expect(reads()).toHaveLength(1);expect(statusOf(p.id)).toBe('paid');
  later(HOUR);await sweepPayments();
  expect(reads()).toHaveLength(2);
  expect(paymentMarks().get(p.id)).toBe('refund-outside');expect(record(c.checkoutId).outsideRefundId).toBe('ref_part2');
  expect((await paymentsGateway.purchasesFor(user)).find(row=>row.id===p.id)).toMatchObject({status:'refund-requested',refundable:null});
  expect(balanceOf(user)).toBe(balance-100);
  await expect(paymentsGateway.cancelRefund(user,p.id)).rejects.toThrow('refund-needs-owner');
  // A pack that is known to be back whole is not asked about any more.
  later(3*HOUR);await sweepPayments();expect(reads()).toHaveLength(2);
  expect((await sendRefund(admin,p.id,'the whole payment went back at Dodo','close')).value.status).toBe('refunded');
  expect(calls.filter(call=>call==='POST /refunds')).toEqual([]);
  expect(balanceOf(user)).toBe(balance-100);expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='refund').map(e=>e.change)).toEqual([-100]);
  expect(paymentMarks().get(p.id)).toBeUndefined();
});
it('a pack whose whole payment went back at Dodo in one refund, with no notice, is frozen by the sweep\'s own look; one Dodo lists no refund for stays as it is',async()=>{
  const whole=await buy('pack-starter',1900,0), plain=await buy('pack-starter',1900,0), balance=balanceOf(user);
  wentBack(whole.paymentId,'full',refundOf(whole.paymentId,'ref_whole',1900,{is_partial:false}));
  later(HOUR+1000);await sweepPayments();
  expect(reads()).toEqual([`GET /payments/${whole.paymentId}`,`GET /payments/${plain.paymentId}`]);
  expect(paymentMarks()).toEqual(new Map([[whole.p.id,'refund-outside']]));
  expect(statusOf(whole.p.id)).toBe('refund-requested');expect(statusOf(plain.p.id)).toBe('paid');expect(balanceOf(user)).toBe(balance-10);
  expect(record(plain.c.checkoutId).flag).toBeUndefined();expect(paymentStore().attention).toEqual([`refund-review:${whole.c.checkoutId}`]);
});
it('a refund Dodo lists without an amount, or in another currency than the payment\'s, is put before the owner as a refund of unknown amount: nothing is frozen and no credit moves',async()=>{
  const none=await buy('pack-starter',1900,0), other=await buy('pack-starter',1900,0), balance=balanceOf(user);
  wentBack(none.paymentId,'full',refundOf(none.paymentId,'ref_none',1900,{amount:null}));
  wentBack(other.paymentId,'full',refundOf(other.paymentId,'ref_inr',190000,{currency:'INR'}));
  later(HOUR+1000);await sweepPayments();
  for(const {p,c} of [none,other]){
    expect(paymentMarks().get(p.id)).toBe('refund-review');expect(refundAmountUnknown(p.id)).toBe(true);expect(partRefunded(p.id)).toBe(0);
    expect(statusOf(p.id)).toBe('paid');expect(record(c.checkoutId).outsideRefundId).toBeUndefined();
  }
  expect(balanceOf(user)).toBe(balance);
});
it('a refund sent from here for what was left after a part went back at Dodo unnoticed becomes "refunded" by the sweep\'s own look: the payment\'s list adds up to all that was paid, the buyer is told once, and nothing is left before the owner',async()=>{
  // Dodo's real case: 54.00 paid, 20.00 back from its panel; asked for a refund, Dodo gave back the 34.00 that were left and calls that refund "partial" too.
  const {c,p,paymentId}=await buy('pack-standard',5400,0);
  const outside=refundOf(paymentId,'ref_outside',2000);
  wentBack(paymentId,'partial',outside);
  await paymentsGateway.requestRefund(user,p.id);
  const held=balanceOf(user), ours=refundOf(paymentId,'ref_ours',3400,{metadata:{refund_key:`refund:${p.id}:1`,checkout_id:c.checkoutId}});
  refundAnswer=()=>{refunds.ref_ours=ours;wentBack(paymentId,'full',outside,ours);return json(ours);};
  expect((await sendRefund(admin,p.id,'asked','first')).value.status).toBe('refund-sent');
  expect(record(c.checkoutId).refundId).toBe('ref_ours');
  // The refund alone is a part of the payment: read by itself it settles nothing, and the owner is told.
  await sweepPayments();
  expect(reads()).toEqual(['GET /refunds/ref_ours']);
  expect(statusOf(p.id)).toBe('refund-sent');expect(paymentMarks().get(p.id)).toBe('refund-review');expect(told('true',p.id)).toHaveLength(0);
  later(HOUR+1000);await sweepPayments();
  expect(reads()).toContain(`GET /payments/${paymentId}`);
  expect(statusOf(p.id)).toBe('refunded');expect(told('true',p.id)).toHaveLength(1);
  expect(balanceOf(user)).toBe(held);expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='refund').map(e=>e.change)).toEqual([-30]);
  expect(partRefunded(p.id)).toBe(2000);expect(record(c.checkoutId).outsideRefundId).toBeUndefined();
  expect(paymentMarks().get(p.id)).toBeUndefined();
  // Settled: Dodo is not asked about it again, and reading the same once more would change nothing.
  const asked=calls.length;later(2*HOUR);await sweepPayments();expect(calls).toHaveLength(asked);
  expect(told('true',p.id)).toHaveLength(1);
});
it('a refund that both its notice and the sweep\'s look tell of is one refund: a part is counted once, the pack is frozen once, and its credits leave once',async()=>{
  const {c,p,paymentId}=await buy('pack-studio',20280,3380), balance=balanceOf(user);
  const first=refundOf(paymentId,'ref_part1',10000), second=refundOf(paymentId,'ref_part2',10280);
  wentBack(paymentId,'partial',first);
  expect(await deliver('refund.succeeded',{payload_type:'Refund',...first})).toBe(200);
  later(HOUR+1000);await sweepPayments();
  expect(record(c.checkoutId).outsideRefunds).toEqual([{id:'ref_part1',amountMinor:10000}]);expect(partRefunded(p.id)).toBe(10000);expect(statusOf(p.id)).toBe('paid');
  // The second part: the look finds it first, its notice comes afterwards, twice.
  wentBack(paymentId,'full',first,second);
  later(HOUR+1000);await sweepPayments();
  expect(statusOf(p.id)).toBe('refund-requested');expect(balanceOf(user)).toBe(balance-100);
  for(let n=0;n<2;n++)expect(await deliver('refund.succeeded',{payload_type:'Refund',...second},'msg_second')).toBe(200);
  expect(await deliver('refund.succeeded',{payload_type:'Refund',...second})).toBe(200);
  expect(record(c.checkoutId).outsideRefunds).toEqual([{id:'ref_part1',amountMinor:10000},{id:'ref_part2',amountMinor:10280}]);
  expect(statusOf(p.id)).toBe('refund-requested');expect(balanceOf(user)).toBe(balance-100);
  expect(paymentStore().attention.filter(a=>a===`refund-review:${c.checkoutId}`)).toHaveLength(1);
  await sendRefund(admin,p.id,'closed','close');
  expect(statusOf(p.id)).toBe('refunded');expect(balanceOf(user)).toBe(balance-100);
  expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='refund').map(e=>e.change)).toEqual([-100]);
  expect(told('true',p.id)).toHaveLength(1);
});
it('our own refund that its notice and the sweep\'s look both tell of settles once: one "refunded" mail, the credits out once',async()=>{
  const {c,p,paymentId}=await buy('pack-standard',5400,0);
  const outside=refundOf(paymentId,'ref_outside',2000);
  wentBack(paymentId,'partial',outside);
  await paymentsGateway.requestRefund(user,p.id);
  const held=balanceOf(user), ours=refundOf(paymentId,'ref_ours',3400,{metadata:{checkout_id:c.checkoutId}});
  refundAnswer=()=>{refunds.ref_ours=ours;wentBack(paymentId,'full',outside,ours);return json(ours);};
  await sendRefund(admin,p.id,'asked','first');
  later(HOUR+1000);await sweepPayments();
  expect(statusOf(p.id)).toBe('refunded');
  for(const refund of [ours,outside,ours])expect(await deliver('refund.succeeded',{payload_type:'Refund',...refund})).toBe(200);
  later(HOUR+1000);await sweepPayments();
  expect(statusOf(p.id)).toBe('refunded');expect(told('true',p.id)).toHaveLength(1);expect(balanceOf(user)).toBe(held);
  expect(record(c.checkoutId).outsideRefunds).toEqual([{id:'ref_outside',amountMinor:2000}]);
  expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='refund')).toHaveLength(1);
});
it('a pack the admin closed after the look found both parts of its payment back at Dodo keeps no mark when the first part\'s notice comes at last: a refund that was counted is old news on a closed pack',async()=>{
  const {c,p,paymentId}=await buy('pack-studio',20280,3380), balance=balanceOf(user);
  const first=refundOf(paymentId,'ref_part1',10000), second=refundOf(paymentId,'ref_part2',10280);
  wentBack(paymentId,'full',first,second);
  later(HOUR+1000);await sweepPayments();
  expect((await sendRefund(admin,p.id,'the whole payment went back at Dodo','close')).value.status).toBe('refunded');
  expect(paymentMarks().get(p.id)).toBeUndefined();
  for(const refund of [first,second,first]){
    expect(await deliver('refund.succeeded',{payload_type:'Refund',...refund})).toBe(200);
    expect(paymentMarks().get(p.id)).toBeUndefined();
    expect(record(c.checkoutId)).toMatchObject({refundId:'ref_part2',outsideRefundId:'ref_part2'});expect(record(c.checkoutId).flag).toBeUndefined();
  }
  expect(statusOf(p.id)).toBe('refunded');expect(balanceOf(user)).toBe(balance-100);expect(told('true',p.id)).toHaveLength(1);
});
it('a pack whose refund from here made up what was left of a payment keeps no mark when the notice of the part that went back at Dodo comes at last; a refund nobody knew of is still put before the owner',async()=>{
  const {c,p,paymentId}=await buy('pack-standard',5400,0);
  const outside=refundOf(paymentId,'ref_outside',2000);
  wentBack(paymentId,'partial',outside);
  await paymentsGateway.requestRefund(user,p.id);
  const ours=refundOf(paymentId,'ref_ours',3400,{metadata:{checkout_id:c.checkoutId}});
  refundAnswer=()=>{refunds.ref_ours=ours;wentBack(paymentId,'full',outside,ours);return json(ours);};
  await sendRefund(admin,p.id,'asked','first');
  later(HOUR+1000);await sweepPayments();
  expect(statusOf(p.id)).toBe('refunded');expect(paymentMarks().get(p.id)).toBeUndefined();
  for(const refund of [outside,ours,outside]){
    expect(await deliver('refund.succeeded',{payload_type:'Refund',...refund})).toBe(200);
    expect(paymentMarks().get(p.id)).toBeUndefined();expect(record(c.checkoutId).flag).toBeUndefined();
  }
  expect(told('true',p.id)).toHaveLength(1);
  expect(await deliver('refund.succeeded',{payload_type:'Refund',...refundOf(paymentId,'ref_more',500)})).toBe(200);
  expect(paymentMarks().get(p.id)).toBe('refund-review');expect(record(c.checkoutId).outsideRefunds).toEqual([{id:'ref_outside',amountMinor:2000},{id:'ref_more',amountMinor:500}]);
});
it('a tour looks at no more payments than it may ask about, the longest unlooked first, and the time of the last look is kept with the payment: a restart does not make it look again',async()=>{
  const bought:Awaited<ReturnType<typeof buy>>[]=[];
  for(let n=0;n<SWEEP_ASKS+3;n++){bought.push(await buy('pack-starter',1900,0));later(1000);}
  const path=(n:number)=>`GET /payments/${bought[n]!.paymentId}`;
  later(HOUR);calls=[];await sweepPayments();
  expect(reads()).toEqual(bought.slice(0,SWEEP_ASKS).map((_,n)=>path(n)));
  // A restart forgets what the process noted; the look is in the record.
  later(20000);forgetReconciliation();calls=[];await sweepPayments();
  expect(reads()).toEqual(bought.slice(SWEEP_ASKS).map((_,n)=>path(SWEEP_ASKS+n)));
  forgetReconciliation();calls=[];await sweepPayments();expect(reads()).toEqual([]);
  for(const {c} of bought)expect(Date.parse(record(c.checkoutId).refundsReadAt??'')).toBeGreaterThan(Date.now()-60000);
  // An hour after the first tour it is the turn of those it looked at, and not yet of the others.
  later(HOUR-10000);calls=[];await sweepPayments();
  expect(reads()).toEqual(bought.slice(0,SWEEP_ASKS).map((_,n)=>path(n)));
});
it('looks that find nothing new cost one write a tour, not one each: the whole record is copied and saved once for the times of all of them, a look that finds a refund is still written by itself, and every time is kept',async()=>{
  const bought:Awaited<ReturnType<typeof buy>>[]=[];
  for(let n=0;n<5;n++)bought.push(await buy('pack-starter',1900,0));
  // The receipts leave first. What a tour with nothing to look at copies is the measure: a tour of looks adds one copy to it.
  await sweepPayments();
  const copies=vi.spyOn(globalThis,'structuredClone');
  later(60000);await sweepPayments();
  const idle=copies.mock.calls.length;expect(reads()).toEqual([]);
  copies.mockClear();later(HOUR);await sweepPayments();
  expect(reads()).toHaveLength(5);expect(copies).toHaveBeenCalledTimes(idle+1);
  for(const {c} of bought)expect(Date.parse(record(c.checkoutId).refundsReadAt??'')).toBe(Date.now());
  copies.mockClear();later(60000);calls=[];await sweepPayments();
  expect(reads()).toEqual([]);expect(copies).toHaveBeenCalledTimes(idle);
  // Dodo failing is nothing new either: the five looks that got no answer are written down together.
  down=()=>json({code:'INTERNAL'},500);
  copies.mockClear();later(HOUR);calls=[];await sweepPayments();
  expect(reads()).toHaveLength(5);expect(copies).toHaveBeenCalledTimes(idle+1);
  for(const {c} of bought)expect(Date.parse(record(c.checkoutId).refundsReadAt??'')).toBe(Date.now());
  // One of the five has a refund to tell of: that is written by itself, the times of the four others together.
  const news=bought[2]!;
  wentBack(news.paymentId,'partial',refundOf(news.paymentId,'ref_part',500));
  const answer=payments[news.paymentId]!;
  down=()=>calls.at(-1)===`GET /payments/${news.paymentId}`?json(answer):json({code:'INTERNAL'},500);
  copies.mockClear();later(HOUR);calls=[];await sweepPayments();
  expect(reads()).toHaveLength(5);expect(partRefunded(news.p.id)).toBe(500);expect(copies.mock.calls.length).toBeGreaterThan(idle+1);
  for(const {c} of bought)expect(Date.parse(record(c.checkoutId).refundsReadAt??'')).toBe(Date.now());
  down=null;later(60000);calls=[];await sweepPayments();expect(reads()).toEqual([]);
});
it('a purchase that was credited without the address of Dodo\'s invoice gets it from the look that first reads one, and nothing else of the purchase changes',async()=>{
  const c=await paymentsGateway.startCheckout(user,'pack-starter','/gallery?no-invoice=1');
  payments.pay_bare=dodoPayment(c.checkoutId,'pack-starter','pay_bare',1900,0,{invoice_url:null});
  expect(await deliver('payment.succeeded',{payload_type:'Payment',...payments.pay_bare})).toBe(200);
  const p=()=>getStore().purchases.find(row=>row.id===record(c.checkoutId).purchaseId)!;
  expect(p().status).toBe('paid');expect(p().invoiceUrl).toBeUndefined();
  later(HOUR+1000);await sweepPayments();
  expect(reads()).toEqual(['GET /payments/pay_bare']);expect(p().invoiceUrl).toBeUndefined();
  payments.pay_bare={...payments.pay_bare,invoice_url:'https://test.dodopayments.com/invoices/payments/pay_bare'};
  later(HOUR);await sweepPayments();
  expect(p().invoiceUrl).toBe('https://test.dodopayments.com/invoices/payments/pay_bare');expect(Date.parse(record(c.checkoutId).refundsReadAt??'')).toBe(Date.now());
  expect(p().status).toBe('paid');expect(paymentMarks().size).toBe(0);
});
it('what a tour must ask about first comes first and keeps all its requests: checkouts that may have been paid are asked about, and the second look gets what is left of the tour, or the two requests kept for it where less is left',async()=>{
  const old=await buy('pack-starter',1900,0);
  later(HOUR+1000);
  for(let n=0;n<SWEEP_ASKS-1;n++)await paymentsGateway.startCheckout(user,'pack-starter',`/gallery?open=${n}`);
  const second=await buy('pack-starter',1900,0);later(1000);
  const third=await buy('pack-starter',1900,0);later(HOUR+1000);
  calls=[];await sweepPayments();
  expect(reads().filter(call=>call.startsWith('GET /checkouts/'))).toHaveLength(SWEEP_ASKS-1);
  expect(reads().filter(call=>call.startsWith('GET /payments/'))).toEqual([`GET /payments/${old.paymentId}`,`GET /payments/${second.paymentId}`]);
  calls=[];await sweepPayments();
  expect(reads().filter(call=>call.startsWith('GET /checkouts/'))).toHaveLength(SWEEP_ASKS-1);
  expect(reads().filter(call=>call.startsWith('GET /payments/'))).toEqual([`GET /payments/${third.paymentId}`]);
});
it('checkouts left open do not keep the second look away: with every request of the tour taken by them, a pack whose whole payment went back at Dodo with no notice is frozen by the very next tour, and the checkouts are asked about as before',async()=>{
  const {p,paymentId}=await buy('pack-starter',1900,0), other=await buy('pack-starter',1900,0), third=await buy('pack-starter',1900,0), balance=balanceOf(user);
  wentBack(paymentId,'full',refundOf(paymentId,'ref_whole',1900,{is_partial:false}));
  later(HOUR+1000);
  for(let n=0;n<SWEEP_ASKS+2;n++)await paymentsGateway.startCheckout(user,'pack-starter',`/gallery?open=${n}`);
  calls=[];await sweepPayments();
  expect(reads().filter(call=>call.startsWith('GET /checkouts/'))).toHaveLength(SWEEP_ASKS);
  // Two requests a tour are the look's own, whatever else the tour asks: no more than those while the checkouts take all of theirs.
  expect(reads().filter(call=>call.startsWith('GET /payments/'))).toEqual([`GET /payments/${paymentId}`,`GET /payments/${other.paymentId}`]);
  expect(statusOf(p.id)).toBe('refund-requested');expect(paymentMarks().get(p.id)).toBe('refund-outside');expect(balanceOf(user)).toBe(balance-10);
  // The tours after it: the payment that waited has its turn, and no checkout loses a question to the look.
  calls=[];
  for(let n=0;n<3;n++){later(60000);await sweepPayments();}
  expect(reads().filter(call=>call.startsWith('GET /checkouts/'))).toHaveLength(3*SWEEP_ASKS);
  expect(reads().filter(call=>call.startsWith('GET /payments/'))).toEqual([`GET /payments/${third.paymentId}`]);
});
it('only payments of the last ninety days are looked at again, and not one that is refunded',async()=>{
  const old=await buy('pack-starter',1900,0);
  later(89*DAY);calls=[];await sweepPayments();expect(reads()).toEqual([`GET /payments/${old.paymentId}`]);
  const young=await buy('pack-starter',1900,0), done=await buy('pack-starter',1900,0);
  await paymentsGateway.requestRefund(user,done.p.id);
  refundAnswer=id=>json(refunds.ref_done=refundOf(id,'ref_done',1900,{is_partial:false}));
  await sendRefund(admin,done.p.id,'asked','first');await sweepPayments();
  expect(statusOf(done.p.id)).toBe('refunded');
  later(2*DAY);calls=[];await sweepPayments();
  expect(reads()).toEqual([`GET /payments/${young.paymentId}`]);
});
it.each<[string,()=>Response]>([['fails',()=>json({code:'INTERNAL'},500)],['refuses the key',()=>json({code:'UNAUTHORIZED'},401)],['answers what cannot be read',()=>new Response('<html>down</html>')],
  ['does not answer in time',()=>{throw Object.assign(new Error('made-up-timeout'),{name:'TimeoutError'});}]])
('when Dodo %s, the look passes quietly: nothing changes, the tour does its other work, and the payment is looked at again in its turn',async(_name,reply)=>{
  const {c,p,paymentId}=await buy('pack-starter',1900,0), balance=balanceOf(user);
  wentBack(paymentId,'full',refundOf(paymentId,'ref_whole',1900,{is_partial:false}));
  const open=await paymentsGateway.startCheckout(user,'pack-starter','/gallery?late=1');
  later(DAY+11*60000);down=reply;const waiting=paymentStore().deliveries.filter(d=>d.status==='queued').length;
  await expect(sweepPayments()).resolves.toBeUndefined();
  expect(statusOf(p.id)).toBe('paid');expect(balanceOf(user)).toBe(balance);expect(paymentMarks().size).toBe(0);expect(record(c.checkoutId).flag).toBeUndefined();
  // The rest of the tour ran: the receipt mail left the queue.
  expect(waiting).toBeGreaterThan(0);expect(paymentStore().deliveries.filter(d=>d.status==='queued')).toHaveLength(0);
  expect(record(open.checkoutId).status).toBe('pending');
  down=null;later(60000);calls=[];await sweepPayments();expect(reads().filter(call=>call.startsWith('GET /payments/'))).toEqual([]);
  later(HOUR);await sweepPayments();
  expect(statusOf(p.id)).toBe('refund-requested');expect(paymentMarks().get(p.id)).toBe('refund-outside');
});
it('refunds of the payment\'s list that did not go through tell nothing of money that went back: one that failed, one still pending and one in review, each of the whole sum, freeze nothing, mark nothing and move no credit',async()=>{
  const {c,p,paymentId}=await buy('pack-standard',6426,1026), balance=balanceOf(user);
  wentBack(paymentId,'partial',...['failed','pending','review'].map(status=>refundOf(paymentId,`ref_${status}`,6426,{status,is_partial:false})));
  later(HOUR+1000);await sweepPayments();
  expect(reads()).toEqual([`GET /payments/${paymentId}`]);
  expect(statusOf(p.id)).toBe('paid');expect(balanceOf(user)).toBe(balance);expect(paymentMarks().size).toBe(0);
  expect(record(c.checkoutId).outsideRefunds).toBeUndefined();expect(record(c.checkoutId).outsideRefundId).toBeUndefined();expect(paymentStore().attention).toEqual([]);
});
it('a pack that waits for a refund is looked at like one that is paid: one the customer asked a refund for, and one whose refund Dodo refused, are frozen by the look when the whole payment went back at Dodo, and the admin closes each without sending money',async()=>{
  const asked=await buy('pack-starter',1900,0), failed=await buy('pack-starter',1900,0);
  for(const {p} of [asked,failed])await paymentsGateway.requestRefund(user,p.id);
  refundAnswer=()=>json({code:'INSUFFICIENT_WALLET_FUNDS',message:'Insufficient funds in wallet'},409);
  await expect(sendRefund(admin,failed.p.id,'asked','first')).rejects.toThrow('refund-refused');
  expect(statusOf(asked.p.id)).toBe('refund-requested');expect(statusOf(failed.p.id)).toBe('refund-failed');
  for(const {paymentId} of [asked,failed])wentBack(paymentId,'full',refundOf(paymentId,`ref_of_${paymentId}`,1900,{is_partial:false}));
  later(HOUR+1000);calls=[];await sweepPayments();
  expect(reads()).toEqual([asked,failed].map(({paymentId})=>`GET /payments/${paymentId}`));
  for(const {c,p,paymentId} of [asked,failed]){
    expect(paymentMarks().get(p.id)).toBe('refund-outside');expect(record(c.checkoutId).outsideRefundId).toBe(`ref_of_${paymentId}`);expect(statusOf(p.id)).toBe('refund-requested');
    expect((await sendRefund(admin,p.id,'the whole payment went back at Dodo',`close-${p.id}`)).value.status).toBe('refunded');
  }
  expect(calls.filter(call=>call==='POST /refunds')).toEqual([]);expect(paymentMarks().size).toBe(0);
});
it('a refund sent from here while the look\'s question was on its way is not settled by the look\'s answer: what the look asked about has changed, so the answer is left unused, the refund stays sent, and its own read settles it once',async()=>{
  const {c,p,paymentId}=await buy('pack-starter',1900,0);
  await paymentsGateway.requestRefund(user,p.id);
  const held=balanceOf(user), ours=refundOf(paymentId,'ref_ours',1900,{is_partial:false});
  // The refund's own answer never comes; Dodo made the refund all the same, and the look's answer already lists it.
  refundAnswer=()=>{throw Object.assign(new Error('made-up-timeout'),{name:'TimeoutError'});};
  let sending:Promise<unknown>=Promise.resolve();
  down=()=>{down=null;sending=sendRefund(admin,p.id,'asked','first');wentBack(paymentId,'full',ours);return json(payments[paymentId]);};
  later(HOUR+1000);await sweepPayments();await sending;
  expect(reads()).toEqual([`GET /payments/${paymentId}`]);
  expect(statusOf(p.id)).toBe('refund-sent');expect(record(c.checkoutId).refundId).toBeUndefined();expect(paymentMarks().get(p.id)).toBe('refund-unknown');expect(told('true',p.id)).toHaveLength(0);
  later(60000);await sweepPayments();
  expect(statusOf(p.id)).toBe('refunded');expect(record(c.checkoutId).refundId).toBe('ref_ours');expect(told('true',p.id)).toHaveLength(1);
  expect(balanceOf(user)).toBe(held);expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='refund').map(e=>e.change)).toEqual([-10]);
  expect(paymentMarks().get(p.id)).toBeUndefined();
});
it('the note that a sent refund\'s result is not known leaves with its own refund only: when one of two awaited refunds is "refunded", the other purchase\'s note stays on the owner\'s list',async()=>{
  const a=await buy('pack-starter',1900,0), b=await buy('pack-starter',1900,0);
  refundAnswer=()=>{throw Object.assign(new Error('made-up-timeout'),{name:'TimeoutError'});};
  for(const {p} of [a,b]){await paymentsGateway.requestRefund(user,p.id);await sendRefund(admin,p.id,'asked',`first-${p.id}`);}
  expect(paymentStore().attention).toEqual([`refund-unknown:${a.p.id}`,`refund-unknown:${b.p.id}`]);
  expect(await deliver('refund.succeeded',{payload_type:'Refund',...refundOf(a.paymentId,'ref_a',1900,{is_partial:false})})).toBe(200);
  expect(statusOf(a.p.id)).toBe('refunded');expect(statusOf(b.p.id)).toBe('refund-sent');
  expect(paymentStore().attention).toEqual([`refund-unknown:${b.p.id}`]);expect(paymentMarks()).toEqual(new Map([[b.p.id,'refund-unknown']]));
});
it('Dodo\'s answer about another checkout\'s payment, or under another id, tells nothing of this pack',async()=>{
  const {p,paymentId}=await buy('pack-starter',1900,0), list=[listed(refundOf(paymentId,'ref_whole',1900,{is_partial:false}))];
  for(const over of [{metadata:{checkout_id:'another-checkout'}},{metadata:{}},{payment_id:'pay_other'}]){
    payments[paymentId]={...payments[paymentId],refunds:list,refund_status:'full',...over};
    later(HOUR+1000);await sweepPayments();
    expect(statusOf(p.id),JSON.stringify(over)).toBe('paid');expect(paymentMarks().size).toBe(0);
  }
});
it('in fake mode no payment is looked at again, also not one Dodo was paid for: the sweep makes no request',async()=>{
  const {p,paymentId}=await buy('pack-starter',1900,0);
  wentBack(paymentId,'full',refundOf(paymentId,'ref_whole',1900,{is_partial:false}));
  vi.stubEnv('VC_PAYMENTS','fake');vi.stubEnv('VC_PAYMENTS_WEBHOOK_SECRET',randomBytes(32).toString('hex'));
  const fake=await paymentsGateway.startCheckout(user,'pack-starter','/gallery?fake=1');
  later(2*HOUR);calls=[];
  for(let n=0;n<3;n++){await sweepPayments();later(HOUR);}
  expect(calls).toEqual([]);expect(statusOf(p.id)).toBe('paid');expect(record(fake.checkoutId).refundsReadAt).toBeUndefined();
});
it('a sent refund Dodo calls "a part" while it names the whole sum waits for the owner whoever reads it: the refund read by itself and the payment\'s own list say the same, neither is refused as a changed answer, and nothing settles',async()=>{
  const {c,p,paymentId}=await buy('pack-starter',1900,0);
  await paymentsGateway.requestRefund(user,p.id);
  const held=balanceOf(user), ours=refundOf(paymentId,'ref_ours',1900,{metadata:{checkout_id:c.checkoutId}});
  refundAnswer=()=>{refunds.ref_ours=ours;wentBack(paymentId,'full',ours);return json(ours);};
  await sendRefund(admin,p.id,'asked','first');
  for(let n=0;n<3;n++){later(HOUR+1000);await sweepPayments();}
  expect(reads().filter(call=>call===`GET /payments/${paymentId}`).length).toBeGreaterThan(1);
  expect(statusOf(p.id)).toBe('refund-sent');expect(balanceOf(user)).toBe(held);expect(told('true',p.id)).toHaveLength(0);
  expect(paymentMarks().get(p.id)).toBe('refund-review');
  expect(paymentStore().attention).toEqual([`refund-review:${c.checkoutId}`]);
  // Each source's answer is kept once, however often it is read.
  expect(paymentStore().events.filter(e=>e.event.kind==='refunded')).toHaveLength(2);
});

// The two cases below could not be tried on the real site (no webhook reached it): Dodo's real refund objects, delivered as its notices.
it('two refunds made in the Dodo panel, each told by its notice and each called "partial" by Dodo: the first is put before the owner and freezes nothing, the second makes them the whole payment and freezes the pack, and the admin closes it without a single request to Dodo',async()=>{
  // 202.80 paid (169.00 + 33.80 tax); 100.00 back, then 102.80.
  const {c,p,paymentId}=await buy('pack-studio',20280,3380), balance=balanceOf(user);
  const first=refundOf(paymentId,'ref_part1',10000), second=refundOf(paymentId,'ref_part2',10280,{created_at:'2026-10-07T11:36:25.028640Z'});
  expect(await deliver('refund.succeeded',{payload_type:'Refund',...first})).toBe(200);
  expect(statusOf(p.id)).toBe('paid');expect(balanceOf(user)).toBe(balance);
  expect(paymentMarks().get(p.id)).toBe('refund-review');expect(partRefunded(p.id)).toBe(10000);expect(record(c.checkoutId).outsideRefundId).toBeUndefined();
  expect(await deliver('refund.succeeded',{payload_type:'Refund',...second})).toBe(200);
  expect((await paymentsGateway.purchasesFor(user)).find(row=>row.id===p.id)).toMatchObject({status:'refund-requested',refundable:null});
  expect(balanceOf(user)).toBe(balance-100);expect(paymentMarks().get(p.id)).toBe('refund-outside');
  expect(record(c.checkoutId)).toMatchObject({outsideRefundId:'ref_part2',outsideRefunds:[{id:'ref_part1',amountMinor:10000},{id:'ref_part2',amountMinor:10280}]});
  expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='refund')).toHaveLength(0);expect(told('true',p.id)).toHaveLength(0);
  await expect(paymentsGateway.cancelRefund(user,p.id)).rejects.toThrow('refund-needs-owner');
  calls=[];
  expect((await sendRefund(admin,p.id,'the whole payment went back at Dodo','close')).value.status).toBe('refunded');
  expect(calls).toEqual([]);
  expect(balanceOf(user)).toBe(balance-100);expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='refund').map(e=>e.change)).toEqual([-100]);
  expect(told('sent',p.id)).toHaveLength(0);expect(told('true',p.id).map(m=>m.data.amount)).toEqual(['$202.80']);
  expect(paymentMarks().get(p.id)).toBeUndefined();
  // Told again, in either order, and swept afterwards: nothing more happens, and Dodo is still not asked.
  for(const refund of [second,first])expect(await deliver('refund.succeeded',{payload_type:'Refund',...refund})).toBe(200);
  later(2*HOUR);await sweepPayments();
  expect(calls).toEqual([]);expect(statusOf(p.id)).toBe('refunded');expect(balanceOf(user)).toBe(balance-100);expect(told('true',p.id)).toHaveLength(1);
});
it('the whole payment refunded in the Dodo panel at once, told by one notice Dodo does not call "partial": the pack is frozen by that notice, and the admin closes it without a single request to Dodo',async()=>{
  // 64.26 paid (54.00 + 10.26 tax), all of it back in one refund.
  const {c,p,paymentId}=await buy('pack-standard',6426,1026), balance=balanceOf(user);
  const whole=refundOf(paymentId,'ref_whole',6426,{is_partial:false});
  for(let n=0;n<2;n++)expect(await deliver('refund.succeeded',{payload_type:'Refund',...whole},'msg_whole')).toBe(200);
  expect(statusOf(p.id)).toBe('refund-requested');expect(balanceOf(user)).toBe(balance-30);
  expect(paymentMarks().get(p.id)).toBe('refund-outside');expect(record(c.checkoutId)).toMatchObject({outsideRefundId:'ref_whole',outsideRefunds:[{id:'ref_whole',amountMinor:6426}]});
  calls=[];
  expect((await sendRefund(admin,p.id,'the whole payment went back at Dodo','close')).value.status).toBe('refunded');
  expect(calls).toEqual([]);
  expect(getStore().ledger.filter(e=>e.relatedPurchaseId===p.id&&e.type==='refund').map(e=>e.change)).toEqual([-30]);
  expect(told('sent',p.id)).toHaveLength(0);expect(told('true',p.id).map(m=>m.data.amount)).toEqual(['$64.26']);
  expect(paymentMarks().get(p.id)).toBeUndefined();expect(balanceOf(user)).toBe(balance-30);
});
it('a part less than the whole payment told by a notice Dodo does not call "partial" is still a part: 100.00 of 202.80 freezes nothing',async()=>{
  const {p,paymentId}=await buy('pack-studio',20280,3380), balance=balanceOf(user);
  expect(await deliver('refund.succeeded',{payload_type:'Refund',...refundOf(paymentId,'ref_part1',10000,{is_partial:false})})).toBe(200);
  expect(statusOf(p.id)).toBe('paid');expect(balanceOf(user)).toBe(balance);expect(partRefunded(p.id)).toBe(10000);expect(paymentMarks().get(p.id)).toBe('refund-review');
});
