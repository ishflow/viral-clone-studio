// @vitest-environment node
import { inspect } from 'node:util';
import { afterEach, expect, it, vi } from 'vitest';
import { dodoConfig, DodoError, DodoProvider } from './dodo-provider';
import { fetchHttp, HttpError } from './http';
import type { Http } from './http';
// Made-up values: no real key or product id belongs in a test.
const KEY='placeholder-key-fixture';
const env={DODO_API_KEY_TEST:KEY,DODO_API_BASE_TEST:'https://test.dodopayments.com',DODO_PRODUCT_PACK_STARTER:'pdt_FixtureStarter01',DODO_PRODUCT_PACK_STANDARD:'pdt_FixtureStandard1',DODO_PRODUCT_PACK_STUDIO:'pdt_FixtureStudio001'};
it('reads the key, the test address and one product for every pack on sale',()=>{
  const config=dodoConfig(env);
  expect({base:config.base,key:config.key(),products:config.products}).toEqual({base:'https://test.dodopayments.com',key:KEY,
    products:new Map([['pack-starter','pdt_FixtureStarter01'],['pack-standard','pdt_FixtureStandard1'],['pack-studio','pdt_FixtureStudio001']])});
  expect(dodoConfig({...env,DODO_API_BASE_TEST:undefined}).base).toBe('https://test.dodopayments.com');
  expect(dodoConfig({...env,DODO_API_BASE_TEST:'https://test.dodopayments.com/'}).base).toBe('https://test.dodopayments.com');
});
it('does not show the key when the settings are printed, logged or written as JSON',()=>{
  const config=dodoConfig(env);
  for(const text of [inspect(config,{depth:10,showHidden:true}),JSON.stringify(config),String(config),String(config.key),inspect({mode:'test',dodo:config},{depth:10})])expect(text).not.toContain(KEY);
});
it('stops at start when a pack on sale has no product, or two packs share one',()=>{
  for(const name of ['DODO_PRODUCT_PACK_STARTER','DODO_PRODUCT_PACK_STANDARD','DODO_PRODUCT_PACK_STUDIO'])
    for(const value of [undefined,'',' ','prod_wrong_kind','pdt_has space','pdt_../x','pdt_'])
      expect(()=>dodoConfig({...env,[name]:value}),`${name}=${value}`).toThrow(`dodo-product-required:${name}`);
  expect(()=>dodoConfig({...env,DODO_PRODUCT_PACK_STUDIO:env.DODO_PRODUCT_PACK_STARTER})).toThrow('dodo-product-duplicate');
});
it('stops at start without a usable key and never repeats the key it was given',()=>{
  // A key with a letter outside ASCII or an invisible character cannot be put in a header: every call would fail later, as a dead line.
  for(const value of [undefined,'',' ','two words','line\nbreak','tab\tinside','kéy-0123456789','ключ-0123456789','key\u200b0123456789','\ufeffkey0123456789','key\u00a00123456789','key\u202e0123456789','key🙂0123456789'])
    expect(()=>dodoConfig({...env,DODO_API_KEY_TEST:value}),JSON.stringify(value)).toThrow('dodo-key-required');
  try{dodoConfig({...env,DODO_API_KEY_TEST:'private value'});}catch(error){expect(String(error)).not.toContain('private');}
});
it('never repeats a setting it refuses: not the product, not the address',()=>{
  const MARK='pdt_LeakMarker000001';
  for(const bad of [{DODO_PRODUCT_PACK_STARTER:`${MARK} x`},{DODO_PRODUCT_PACK_STUDIO:MARK,DODO_PRODUCT_PACK_STARTER:MARK},{DODO_API_BASE_TEST:`https://${MARK}.example`},{DODO_API_BASE_TEST:`not an address ${MARK}`}]){
    const error=(()=>{try{dodoConfig({...env,...bad});return null;}catch(e){return e as Error;}})();
    expect(error).toBeInstanceOf(Error);
    for(const text of [error!.message,String(error!.stack),inspect(error,{depth:10})])expect(text.toLowerCase()).not.toContain(MARK.toLowerCase());
    expect(error!.cause).toBeUndefined();
  }
});
it('accepts no address other than the provider\'s https test address',()=>{
  for(const base of ['http://test.dodopayments.com','https://live.dodopayments.com','https://test.dodopayments.com.elsewhere.example','https://elsewhere.example','https://test.dodopayments.com:8443',
    'https://user:pass@test.dodopayments.com','https://test.dodopayments.com/v1','https://test.dodopayments.com/?a=1','https://test.dodopayments.com/#a','http://127.0.0.1:9999','not an address',''])
    expect(()=>dodoConfig({...env,DODO_API_BASE_TEST:base}),base).toThrow('invalid-dodo-base');
});

// Replies below are shaped after docs.dodopayments.com (API 1.118.3) and two real test-mode calls of 2026-10-07; every id is made up.
const CHECKOUT='7b0f6c0e-2a55-4c1e-9d0a-5a1c2e3f4a5b',SESSION='cks_FixtureSession000001',PAYMENT='pay_FixturePayment000001',REFUND='ref_FixtureRefund0000001',BUSINESS='bus_FixtureBusiness0001';
const customer={customer_id:'cus_FixtureCustomer0001',name:'Fixture Buyer',email:'buyer@example.com',phone_number:null,metadata:{}};
const paymentReply={payment_id:PAYMENT,business_id:BUSINESS,brand_id:BUSINESS,status:'succeeded',total_amount:2128,tax:228,currency:'USD',settlement_amount:2128,settlement_currency:'USD',settlement_tax:228,
  created_at:'2026-10-07T03:31:02.118734Z',updated_at:'2026-10-07T03:31:09.004211Z',checkout_session_id:SESSION,payment_link:`https://test.checkout.dodopayments.com/session/${SESSION}`,
  metadata:{checkout_id:CHECKOUT},customer,billing:{country:'DE',state:'BE',city:'Berlin',street:'1 Fixture St',zipcode:'10115'},
  product_cart:[{product_id:'pdt_FixtureStarter01',quantity:1}],refunds:[],disputes:[],refund_status:null,invoice_id:'INV-FIXTURE-1',invoice_url:`https://test.dodopayments.com/invoices/payments/${PAYMENT}`,
  payment_method:'card',payment_method_type:'visa',payment_method_id:null,payment_provider:'dodo',card_last_four:'4242',card_network:'VISA',card_type:'CREDIT',card_issuing_country:'US',card_holder_name:'Fixture Buyer',
  custom_field_responses:null,discount_id:null,discounts:null,error_code:null,error_message:null,subscription_id:null,subscription_ids:[],is_multi_subscription:false,is_update_payment_method:false,digital_products_delivered:false,retry_attempt:0};
const refundReply={refund_id:REFUND,payment_id:PAYMENT,business_id:BUSINESS,brand_id:BUSINESS,status:'pending',amount:2128,currency:'USD',is_partial:false,reason:'Customer asked',
  metadata:{checkout_id:CHECKOUT,refund_key:'refund:purchase-1:1'},customer,created_at:'2026-10-07T04:00:00.250001Z',network_reference:null,network_reference_type:null};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
function wired(...replies:Response[]){
  const fetcher=vi.fn<typeof fetch>();
  for(const reply of replies)fetcher.mockResolvedValueOnce(reply);
  return {fetcher,provider:new DodoProvider(dodoConfig(env),fetchHttp(fetcher))};
}
/** The one request that left, in full: nothing the provider sends escapes the comparison. */
function sent(fetcher:ReturnType<typeof vi.fn<typeof fetch>>){
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url,init]=fetcher.mock.calls[0]!;
  return {url,method:init!.method,headers:init!.headers,body:init!.body===undefined?undefined:JSON.parse(String(init!.body))};
}
const readHeaders={Authorization:`Bearer ${KEY}`,Accept:'application/json'},writeHeaders={...readHeaders,'Content-Type':'application/json'};
// The buyer's page offers neither another currency nor a discount code: a payment in EUR or below the pack price takes the money and can never be credited.
it('opens a checkout session for one unit of the pack\'s own product, in USD with no currency choice and no discount code, tied to our checkout',async()=>{
  const {fetcher,provider}=wired(json({session_id:SESSION,checkout_url:`https://test.checkout.dodopayments.com/session/${SESSION}`}));
  const session=await provider.createCheckout({checkoutId:CHECKOUT,packId:'pack-standard',email:'buyer@example.com',returnUrl:`http://127.0.0.1:3400/checkout/return?checkout=${CHECKOUT}`,cancelUrl:'http://127.0.0.1:3400/pricing'});
  expect(session).toStrictEqual({sessionId:SESSION,url:`https://test.checkout.dodopayments.com/session/${SESSION}`});
  expect(sent(fetcher)).toStrictEqual({url:'https://test.dodopayments.com/checkouts',method:'POST',headers:writeHeaders,body:{
    product_cart:[{product_id:'pdt_FixtureStandard1',quantity:1}],customer:{email:'buyer@example.com'},metadata:{checkout_id:CHECKOUT},
    return_url:`http://127.0.0.1:3400/checkout/return?checkout=${CHECKOUT}`,cancel_url:'http://127.0.0.1:3400/pricing',billing_currency:'USD',feature_flags:{allow_currency_selection:false,allow_discount_code:false}}});
});
it('reads a session that nobody has paid yet, and one that has a payment',async()=>{
  const open=wired(json({id:SESSION,payment_id:null,payment_status:null,customer_name:null,customer_email:'buyer@example.com',created_at:'2026-10-07T03:28:12.505414Z'}));
  expect(await open.provider.getCheckout(SESSION)).toStrictEqual({sessionId:SESSION,paymentId:null,paymentStatus:null});
  expect(sent(open.fetcher)).toStrictEqual({url:`https://test.dodopayments.com/checkouts/${SESSION}`,method:'GET',headers:readHeaders,body:undefined});
  const paid=wired(json({id:SESSION,payment_id:PAYMENT,payment_status:'succeeded',customer_name:'Fixture Buyer',customer_email:'buyer@example.com',created_at:'2026-10-07T03:28:12.505414Z'}));
  expect(await paid.provider.getCheckout(SESSION)).toStrictEqual({sessionId:SESSION,paymentId:PAYMENT,paymentStatus:'succeeded'});
});
it('reads a payment with what the credit decision needs: amount with tax apart, currency, cart, our checkout and its session',async()=>{
  const {fetcher,provider}=wired(json(paymentReply));
  expect(await provider.getPayment(PAYMENT)).toStrictEqual({paymentId:PAYMENT,status:'succeeded',totalAmount:2128,tax:228,currency:'USD',checkoutId:CHECKOUT,sessionId:SESSION,
    products:[{productId:'pdt_FixtureStarter01',quantity:1}],refunds:[],invoiceUrl:`https://test.dodopayments.com/invoices/payments/${PAYMENT}`,createdAt:'2026-10-07T03:31:02.118Z'});
  expect(sent(fetcher)).toStrictEqual({url:`https://test.dodopayments.com/payments/${PAYMENT}`,method:'GET',headers:readHeaders,body:undefined});
});
it('reads a payment whose optional parts are empty or left out, lists its refunds and drops an invoice link that is not https',async()=>{
  // JSON drops the undefined ones: status, tax and the session are absent from this reply.
  const {provider}=wired(json({...paymentReply,status:undefined,tax:undefined,checkout_session_id:undefined,metadata:{},product_cart:null,invoice_url:'javascript:alert(1)',refund_status:'full',
    refunds:[{refund_id:REFUND,payment_id:PAYMENT,business_id:BUSINESS,status:'succeeded',amount:2128,currency:'USD',is_partial:false,reason:null,created_at:'2026-10-07T04:00:00.250001Z',network_reference:null,network_reference_type:null}]}));
  expect(await provider.getPayment(PAYMENT)).toStrictEqual({paymentId:PAYMENT,status:null,totalAmount:2128,tax:null,currency:'USD',checkoutId:null,sessionId:null,
    products:[],refunds:[{refundId:REFUND,status:'succeeded',amount:2128}],invoiceUrl:null,createdAt:'2026-10-07T03:31:02.118Z'});
});
it('asks for a full refund of one payment, carrying our checkout and our own retry key',async()=>{
  const {fetcher,provider}=wired(json(refundReply));
  expect(await provider.refund({paymentId:PAYMENT,reason:'Customer asked',checkoutId:CHECKOUT,idempotencyKey:'refund:purchase-1:1'}))
    .toStrictEqual({refundId:REFUND,paymentId:PAYMENT,status:'pending',amount:2128,currency:'USD',createdAt:'2026-10-07T04:00:00.250Z'});
  expect(sent(fetcher)).toStrictEqual({url:'https://test.dodopayments.com/refunds',method:'POST',headers:writeHeaders,body:{payment_id:PAYMENT,reason:'Customer asked',metadata:{checkout_id:CHECKOUT,refund_key:'refund:purchase-1:1'}}});
});
it('a refund the payment lists in another currency than its own is read without an amount: that number is not a part of this payment\'s sum; one in the payment\'s currency, or with none named, keeps its amount',async()=>{
  const listed=(over:object)=>wired(json({...paymentReply,refunds:[{refund_id:REFUND,status:'succeeded',amount:190000,...over}]})).provider.getPayment(PAYMENT).then(payment=>payment.refunds);
  expect(await listed({currency:'INR'})).toStrictEqual([{refundId:REFUND,status:'succeeded',amount:null}]);
  for(const currency of ['USD',null,undefined,356])expect(await listed({currency}),String(currency)).toStrictEqual([{refundId:REFUND,status:'succeeded',amount:190000}]);
});
it('a refund the provider itself calls a part of the payment is read with that word; one it does not call so carries none',async()=>{
  expect(await wired(json({...refundReply,status:'succeeded',amount:1000,is_partial:true})).provider.getRefund(REFUND))
    .toStrictEqual({refundId:REFUND,paymentId:PAYMENT,status:'succeeded',amount:1000,currency:'USD',createdAt:'2026-10-07T04:00:00.250Z',partial:true});
  for(const is_partial of [false,null,undefined,'yes'])expect(await wired(json({...refundReply,is_partial})).provider.getRefund(REFUND)).not.toHaveProperty('partial');
});
it('reads a refund in each state the provider names',async()=>{
  for(const status of ['succeeded','failed','pending','review']){
    const {fetcher,provider}=wired(json({...refundReply,status,amount:null,currency:null}));
    expect(await provider.getRefund(REFUND),status).toStrictEqual({refundId:REFUND,paymentId:PAYMENT,status,amount:null,currency:null,createdAt:'2026-10-07T04:00:00.250Z'});
    expect(sent(fetcher)).toStrictEqual({url:`https://test.dodopayments.com/refunds/${REFUND}`,method:'GET',headers:readHeaders,body:undefined});
  }
});

const checkoutInput={checkoutId:CHECKOUT,packId:'pack-starter',email:'buyer@example.com',returnUrl:'http://127.0.0.1:3400/checkout/return',cancelUrl:'http://127.0.0.1:3400/pricing'};
const refundInput={paymentId:PAYMENT,reason:'Customer asked',checkoutId:CHECKOUT,idempotencyKey:'refund:purchase-1:1'};
const calls:[string,(provider:DodoProvider)=>Promise<unknown>][]=[
  ['createCheckout',p=>p.createCheckout(checkoutInput)],['getCheckout',p=>p.getCheckout(SESSION)],['getPayment',p=>p.getPayment(PAYMENT)],['refund',p=>p.refund(refundInput)],['getRefund',p=>p.getRefund(REFUND)]];
const call=(name:string)=>calls.find(([n])=>n===name)![1];
async function failureOf(work:Promise<unknown>):Promise<DodoError> {
  const error=await work.then(()=>null,(e:unknown)=>e);
  if(!(error instanceof DodoError))throw new Error(`expected a DodoError, got ${error===null?'a result':'another error'}`);
  return error;
}
const failed=(fetcher:(...args:Parameters<typeof fetch>)=>Promise<Response>)=>new DodoProvider(dodoConfig(env),fetchHttp(vi.fn<typeof fetch>(fetcher)));
afterEach(()=>vi.restoreAllMocks());
it('every call turns a refusal, an outage, a redirect, a timeout, a dead line and an unreadable reply into a typed failure, and returns nothing',async()=>{
  const cases:[string,()=>Promise<Response>,{kind:string;status?:number;code?:string}][]=[
    ['400',async()=>json({code:'INVALID_REQUEST_BODY',message:'Bad request'},400),{kind:'client',status:400,code:'INVALID_REQUEST_BODY'}],
    ['401',async()=>json({code:'UNAUTHORIZED',message:'You are not authorised to perform this action'},401),{kind:'client',status:401,code:'UNAUTHORIZED'}],
    ['404 without a body',async()=>new Response('',{status:404}),{kind:'client',status:404}],
    ['409',async()=>json({code:'CONFLICT',message:'Conflict'},409),{kind:'client',status:409,code:'CONFLICT'}],
    ['422',async()=>json({code:'INSUFFICIENT_BALANCE',message:'The balance does not cover this'},422),{kind:'client',status:422,code:'INSUFFICIENT_BALANCE'}],
    ['429',async()=>json({code:'RATE_LIMIT_EXCEEDED',message:null},429),{kind:'client',status:429,code:'RATE_LIMIT_EXCEEDED'}],
    ['500',async()=>json({code:'INTERNAL_SERVER_ERROR',message:null},500),{kind:'server',status:500,code:'INTERNAL_SERVER_ERROR'}],
    ['502 with a page',async()=>new Response('<html>Bad Gateway</html>',{status:502}),{kind:'server',status:502}],
    ['503',async()=>new Response('',{status:503}),{kind:'server',status:503}],
    ['302',async()=>new Response(null,{status:302,headers:{location:'https://elsewhere.example/'}}),{kind:'redirect'}],
    ['timeout',async()=>{throw new DOMException('The operation was aborted due to timeout','TimeoutError');},{kind:'timeout'}],
    ['dead line',async()=>{throw new TypeError('fetch failed');},{kind:'network'}],
    ['cut-off JSON',async()=>new Response('{"session_id":"cks_',{status:200}),{kind:'invalid-response'}],
    ['empty 200',async()=>new Response('',{status:200}),{kind:'invalid-response'}],
    ['a page with 200',async()=>new Response('<html>ok</html>',{status:200}),{kind:'invalid-response'}],
    ['null',async()=>json(null),{kind:'invalid-response'}],
    ['a list',async()=>json([]),{kind:'invalid-response'}],
    ['an empty object',async()=>json({}),{kind:'invalid-response'}],
  ];
  for(const [name,run] of calls)for(const [label,reply,want] of cases){
    const error=await failureOf(run(failed(reply)));
    expect({kind:error.kind,status:error.status,code:error.code},`${name}: ${label}`).toStrictEqual({kind:want.kind,status:want.status,code:want.code});
  }
});
// These three say the opposite of "no refund": money is going back already (most often our own first request, whose answer never came).
it.each([[409,'EXISTING_REFUND_REQUEST_PROCESSING'],[422,'PAYMENT_ALREADY_REFUNDED'],[422,'PAYMENT_HAS_BEEN_REFUNDED']])
('a refund answered %i %s is "a refund of this payment exists", never a refusal; the same answer to any other call stays a refusal',async(status,code)=>{
  for(const [name,run] of calls){
    const error=await failureOf(run(failed(async()=>json({code,message:'made up'},status))));
    expect({kind:error.kind,status:error.status,code:error.code},name).toStrictEqual({kind:name==='refund'?'refund-exists':'client',status,code});
  }
});
// The only refusals that are known to mean "there is no refund": Dodo names each of them. Every other refusal of a refund leaves its outcome unknown.
it.each(['REFUND_WINDOW_EXPIRED','PAYMENT_NOT_SUCCEEDED','ZERO_AMOUNT_PAYMENT_REFUND_NOT_ALLOWED'])
('a refund answered %s is "no refund was made"; the same answer to any other call, and any refusal Dodo does not name so, is not',async(code)=>{
  for(const [name,run] of calls){
    const error=await failureOf(run(failed(async()=>json({code,message:'made up'},422))));
    expect({kind:error.kind,status:error.status,code:error.code},name).toStrictEqual({kind:name==='refund'?'no-refund':'client',status:422,code});
  }
  for(const [status,body] of [[422,{code:'NOTHING_TO_REFUND'}],[409,{}],[400,{code:'INSUFFICIENT_BALANCE'}],[401,{code:'UNAUTHORIZED'}],[404,{}],[422,{code:code.toLowerCase()}],[422,{code:`${code}_X`}]] as const){
    const error=await failureOf(failed(async()=>json(body,status)).refund(refundInput));
    expect(error.kind,JSON.stringify([status,body])).toBe('client');
  }
});
// Dodo documents no idempotency key: a call that is made again can open a second session or send a second refund.
it.each(calls.map(([name])=>name))('%s sends exactly one request whatever goes wrong: nothing is tried again',async name=>{
  const doors:[string,Http][]=[
    ['a dead line',async()=>{throw new HttpError('network');}],
    ['a timeout',async()=>{throw new HttpError('timeout');}],
    ['a redirect',async()=>{throw new HttpError('redirect');}],
    ['an error that is not the door\'s own',async()=>{throw new Error('made up');}],
    ['500',async()=>({status:500,body:''})],
    ['503',async()=>({status:503,body:'<html>Service Unavailable</html>'})],
    ['429',async()=>({status:429,body:'{"code":"RATE_LIMIT_EXCEEDED"}'})],
    ['408',async()=>({status:408,body:''})],
    ['409 a refund exists',async()=>({status:409,body:'{"code":"EXISTING_REFUND_REQUEST_PROCESSING"}'})],
    ['a cut-off reply',async()=>({status:200,body:'{"session_id":"cks_'})],
    ['an empty reply',async()=>({status:200,body:''})],
    ['a reply of another shape',async()=>({status:200,body:'{}'})],
  ];
  for(const [label,answer] of doors){
    const door=vi.fn<Http>(answer);
    await failureOf(call(name)(new DodoProvider(dodoConfig(env),door)));
    expect(door,label).toHaveBeenCalledTimes(1);
  }
  // And through the real door, counted where the request leaves the process.
  const lines:[string,()=>Promise<Response>][]=[
    ['a dead line',async()=>{throw new TypeError('fetch failed');}],
    ['a timeout',async()=>{throw new DOMException('The operation was aborted due to timeout','TimeoutError');}],
    ['500',async()=>new Response('',{status:500})],
    ['429',async()=>json({code:'RATE_LIMIT_EXCEEDED',message:null},429)],
    ['a cut-off reply',async()=>new Response('{"session_id":"cks_',{status:200})],
    ['a reply of another shape',async()=>json({})],
  ];
  for(const [label,answer] of lines){
    const fetcher=vi.fn<typeof fetch>(answer);
    await failureOf(call(name)(new DodoProvider(dodoConfig(env),fetchHttp(fetcher))));
    expect(fetcher,label).toHaveBeenCalledTimes(1);
  }
});
it.each(calls.map(([name])=>name))('%s takes 200 and 201 as an answer and no other success status, and a reply too large to be one is not read',async name=>{
  const bodies:Record<string,unknown>={createCheckout:{session_id:SESSION,checkout_url:`https://test.checkout.dodopayments.com/session/${SESSION}`},
    getCheckout:{id:SESSION,payment_id:null,payment_status:null},getPayment:paymentReply,refund:refundReply,getRefund:refundReply};
  const answered=(status:number)=>call(name)(new DodoProvider(dodoConfig(env),async()=>({status,body:JSON.stringify(bodies[name])})));
  for(const status of [200,201])await expect(answered(status),String(status)).resolves.toBeDefined();
  for(const status of [202,203,204,205,206,226,299]){
    const error=await failureOf(answered(status));
    expect({kind:error.kind,status:error.status},String(status)).toStrictEqual({kind:'invalid-response',status});
  }
  expect((await failureOf(call(name)(new DodoProvider(dodoConfig(env),async()=>{throw new HttpError('too-large');})))).kind).toBe('invalid-response');
});
it('refuses a reply that does not fit the documented shape or answers about something else',async()=>{
  const sessionReply={id:SESSION,payment_id:PAYMENT,payment_status:'succeeded',customer_name:null,customer_email:'buyer@example.com',created_at:'2026-10-07T03:28:12.505414Z'};
  const created={session_id:SESSION,checkout_url:`https://test.checkout.dodopayments.com/session/${SESSION}`};
  const cases:[string,string,unknown][]=[
    ['createCheckout','no session id',{checkout_url:created.checkout_url}],
    ['createCheckout','a session id that is not an id',{...created,session_id:'cks_1/../x'}],
    ['createCheckout','no payment page',{...created,checkout_url:null}],
    ['createCheckout','a payment page without https',{...created,checkout_url:`http://test.checkout.dodopayments.com/session/${SESSION}`}],
    ['createCheckout','a payment page on another site',{...created,checkout_url:`https://elsewhere.example/session/${SESSION}`}],
    ['createCheckout','a payment page on a look-alike site',{...created,checkout_url:`https://dodopayments.com.elsewhere.example/session/${SESSION}`}],
    ['createCheckout','a payment page that is not an address',{...created,checkout_url:'javascript:alert(1)'}],
    ['createCheckout','a payment page on a site whose name only ends like Dodo\'s',{...created,checkout_url:`https://xdodopayments.com/session/${SESSION}`}],
    ['createCheckout','a payment page with a user name and a password',{...created,checkout_url:`https://user:pass@test.checkout.dodopayments.com/session/${SESSION}`}],
    ['createCheckout','a payment page with a user name',{...created,checkout_url:`https://test.checkout.dodopayments.com@test.checkout.dodopayments.com/session/${SESSION}`}],
    ['createCheckout','a payment page on a host with a dot after it',{...created,checkout_url:`https://test.checkout.dodopayments.com./session/${SESSION}`}],
    ['getCheckout','another session',{...sessionReply,id:'cks_AnotherSession00001'}],
    ['getCheckout','a status the documents do not name',{...sessionReply,payment_status:'paid'}],
    ['getCheckout','a payment id that is not an id',{...sessionReply,payment_id:'pay 1'}],
    ['getPayment','another payment',{...paymentReply,payment_id:'pay_AnotherPayment00001'}],
    ['getPayment','a negative amount',{...paymentReply,total_amount:-1}],
    ['getPayment','a fractional amount',{...paymentReply,total_amount:21.28}],
    ['getPayment','an amount as text',{...paymentReply,total_amount:'2128'}],
    ['getPayment','no amount',{...paymentReply,total_amount:undefined}],
    ['getPayment','a negative tax',{...paymentReply,tax:-228}],
    ['getPayment','a tax larger than the whole amount',{...paymentReply,tax:2129}],
    ['getPayment','a session id that is not an id',{...paymentReply,checkout_session_id:'cks 1/..'}],
    ['getPayment','a product id that is not an id',{...paymentReply,product_cart:[{product_id:'pdt 1',quantity:1}]}],
    ['getPayment','a refund in a state the documents do not name',{...paymentReply,refunds:[{refund_id:REFUND,status:'done',amount:2128}]}],
    ['getPayment','a refund without an id',{...paymentReply,refunds:[{status:'succeeded',amount:2128}]}],
    ['getPayment','a currency that is not a code',{...paymentReply,currency:'usd'}],
    ['getPayment','no refund list',{...paymentReply,refunds:undefined}],
    ['getPayment','no metadata',{...paymentReply,metadata:undefined}],
    ['getPayment','a status the documents do not name',{...paymentReply,status:'paid'}],
    ['getPayment','a cart line without a quantity',{...paymentReply,product_cart:[{product_id:'pdt_FixtureStarter01'}]}],
    ['getPayment','a time that is not a time',{...paymentReply,created_at:'yesterday'}],
    ['refund','a refund of another payment',{...refundReply,payment_id:'pay_AnotherPayment00001'}],
    ['refund','a state the documents do not name',{...refundReply,status:'done'}],
    ['refund','no refund id',{...refundReply,refund_id:undefined}],
    ['refund','a negative amount',{...refundReply,amount:-1}],
    ['refund','a fractional amount',{...refundReply,amount:21.28}],
    ['refund','a currency that is not a code',{...refundReply,currency:'usd'}],
    ['refund','a time that is not a time',{...refundReply,created_at:'yesterday'}],
    ['getRefund','another refund',{...refundReply,refund_id:'ref_AnotherRefund000001'}],
    ['getRefund','a state the documents do not name',{...refundReply,status:'refunded'}],
  ];
  for(const [name,label,body] of cases){
    const error=await failureOf(call(name)(failed(async()=>json(body))));
    expect({kind:error.kind,status:error.status,code:error.code},`${name}: ${label}`).toStrictEqual({kind:'invalid-response',status:undefined,code:undefined});
  }
});
// The buyer's browser is sent to this address: what comes back is the address as a browser reads it, never Dodo's raw text.
it.each([' https://test.checkout.dodopayments.com/session/cks_1','https://test.checkout.dodopayments.com/session/cks_1\r\nSet-Cookie: a=b','\thttps://test.checkout.dodopayments.com/session/cks_1\n',
  'https://test.checkout.dodopayments.com\\@elsewhere.example/session','HTTPS://TEST.Checkout.DodoPayments.com/session/cks_1'])
('hands back the payment page %j as one clean line on Dodo\'s own host',async raw=>{
  const {provider}=wired(json({session_id:SESSION,checkout_url:raw}));
  const {url}=await provider.createCheckout(checkoutInput);
  expect(url).toBe(new URL(raw).href);expect(url).toMatch(/^https:\/\/test\.checkout\.dodopayments\.com\/[^\s\\]*$/);
});
it.each(['https://elsewhere.example/invoice.pdf','https://xdodopayments.com/invoices/1','https://dodopayments.com.elsewhere.example/invoices/1','https://user:pass@test.dodopayments.com/invoices/1','http://test.dodopayments.com/invoices/1'])
('drops the invoice link %s: only Dodo\'s own https address is kept',async link=>{
  const {provider}=wired(json({...paymentReply,invoice_url:link}));
  expect((await provider.getPayment(PAYMENT)).invoiceUrl).toBeNull();
});
it('drops an invoice link too long to keep and reads the rest of the payment: the limit is the webhook\'s own',async()=>{
  const {provider}=wired(json({...paymentReply,invoice_url:'https://test.dodopayments.com/'+'i'.repeat(5000)}));
  expect(await provider.getPayment(PAYMENT)).toMatchObject({paymentId:PAYMENT,status:'succeeded',invoiceUrl:null});
});
it('keeps the key, the Authorization header and the provider\'s raw reply out of every failure, and writes no log',async()=>{
  const logs=(['log','info','warn','error','debug'] as const).map(level=>vi.spyOn(console,level).mockImplementation(()=>{}));
  const SECRET_REPLY='raw-provider-text';
  const replies:(()=>Promise<Response>)[]=[
    async()=>json({code:'UNAUTHORIZED',message:`${SECRET_REPLY} Bearer ${KEY}`},401),
    async()=>json({code:`${SECRET_REPLY} ${KEY}`,message:null},422),
    async()=>json({code:KEY,message:null},400),
    async()=>json({code:'X'.repeat(81),message:null},400),
    async()=>new Response(`<html>${SECRET_REPLY} Authorization: Bearer ${KEY}</html>`,{status:500}),
    async()=>new Response(`{"${SECRET_REPLY}":"Bearer ${KEY}"`,{status:200}),
    async()=>json({[SECRET_REPLY]:`Bearer ${KEY}`,session_id:KEY,id:KEY,payment_id:KEY,refund_id:KEY}),
    async()=>{throw new TypeError(`fetch failed: ${SECRET_REPLY} Authorization: Bearer ${KEY}`,{cause:new Error(KEY)});},
    async()=>{throw new DOMException(`${SECRET_REPLY} Bearer ${KEY}`,'TimeoutError');},
  ];
  for(const [name,run] of calls)for(const [index,reply] of replies.entries()){
    const error=await failureOf(run(failed(reply)));
    for(const text of [error.message,String(error.stack),inspect(error,{depth:10}),JSON.stringify(error),String(error.code)]){
      expect(text,`${name}: reply ${index}`).not.toContain(KEY);
      expect(text,`${name}: reply ${index}`).not.toContain('Bearer');
      expect(text,`${name}: reply ${index}`).not.toContain(SECRET_REPLY);
    }
    expect(error.cause,`${name}: reply ${index}`).toBeUndefined();
  }
  for(const log of logs)expect(log).not.toHaveBeenCalled();
});
it('sends nothing when the request itself is wrong: an id that could change the path, an unknown pack, an overlong or empty reason, no checkout of ours, a return address that is not a plain web address',async()=>{
  const fetcher=vi.fn<typeof fetch>(),provider=new DodoProvider(dodoConfig(env),fetchHttp(fetcher));
  const wrong:[string,()=>Promise<unknown>][]=[];
  for(const bad of ['','../payments/pay_1','cks_1/extra','cks_1?expand=1','cks_1#x','cks 1','cks_1%2F..','x'.repeat(201)]){
    wrong.push([`getCheckout ${bad}`,()=>provider.getCheckout(bad)],[`getPayment ${bad}`,()=>provider.getPayment(bad)],[`getRefund ${bad}`,()=>provider.getRefund(bad)],[`refund ${bad}`,()=>provider.refund({...refundInput,paymentId:bad})]);
  }
  for(const packId of ['pack-unknown','','__proto__','constructor'])wrong.push([`createCheckout ${packId}`,()=>provider.createCheckout({...checkoutInput,packId})]);
  wrong.push(['refund with a 3001-character reason',()=>provider.refund({...refundInput,reason:'r'.repeat(3001)})]);
  for(const reason of ['','   ','\n'])wrong.push([`refund with the reason ${JSON.stringify(reason)}`,()=>provider.refund({...refundInput,reason})]);
  for(const checkoutId of ['',' ','a/b','a b','x'.repeat(201)])
    wrong.push([`createCheckout for checkout ${JSON.stringify(checkoutId)}`,()=>provider.createCheckout({...checkoutInput,checkoutId})],[`refund for checkout ${JSON.stringify(checkoutId)}`,()=>provider.refund({...refundInput,checkoutId})]);
  // Dodo sends the buyer to these two addresses: only a plain web address, written exactly as a browser would read it.
  for(const address of ['','/checkout/return','//elsewhere.example/return','javascript:alert(1)','data:text/html,x','ftp://127.0.0.1/return','https://user:pass@site.example/return','https://user@site.example/return',
    ' http://127.0.0.1:3400/return','http://127.0.0.1:3400/return\r\nSet-Cookie: a=b','http://127.0.0.1:3400\\@elsewhere.example/return','not an address'])
    wrong.push([`createCheckout returning to ${JSON.stringify(address)}`,()=>provider.createCheckout({...checkoutInput,returnUrl:address})],[`createCheckout cancelling to ${JSON.stringify(address)}`,()=>provider.createCheckout({...checkoutInput,cancelUrl:address})]);
  for(const [label,work] of wrong)expect((await failureOf(work())).kind,label).toBe('invalid-request');
  expect(fetcher).not.toHaveBeenCalled();
});
it('sends the two addresses the buyer comes back to in the form a browser reads them',async()=>{
  const {fetcher,provider}=wired(json({session_id:SESSION,checkout_url:`https://test.checkout.dodopayments.com/session/${SESSION}`}));
  await provider.createCheckout({...checkoutInput,returnUrl:"HTTP://Site.Example:80/checkout/return?returnTo=%2Fit's",cancelUrl:'https://site.example'});
  expect(sent(fetcher).body).toMatchObject({return_url:'http://site.example/checkout/return?returnTo=%2Fit%27s',cancel_url:'https://site.example/'});
});
it('accepts a reason of exactly the documented 3000 characters',async()=>{
  const {fetcher,provider}=wired(json(refundReply));
  await provider.refund({...refundInput,reason:'r'.repeat(3000)});
  expect(sent(fetcher).body.reason).toHaveLength(3000);
});
it('sends nothing, key included, when it is built with any address but Dodo\'s own test address',async()=>{
  const fetcher=vi.fn<typeof fetch>();
  for(const base of ['http://test.dodopayments.com','http://127.0.0.1:9999','https://elsewhere.example','https://live.dodopayments.com','https://test.dodopayments.com.elsewhere.example','https://test.dodopayments.com/','https://test.dodopayments.com:8443',''])for(const [name,run] of calls)
    expect((await failureOf(run(new DodoProvider({...dodoConfig(env),base},fetchHttp(fetcher))))).kind,`${name}: ${base}`).toBe('invalid-request');
  expect(fetcher).not.toHaveBeenCalled();
});
it('does not show the key when the provider object itself is printed',()=>{
  const provider=new DodoProvider(dodoConfig(env));
  for(const text of [inspect(provider,{depth:10,showHidden:true}),JSON.stringify(provider),String(provider)])expect(text).not.toContain(KEY);
});
it('has no door of its own to an arbitrary Dodo path: only the five calls can be reached from outside',()=>{
  const provider=new DodoProvider(dodoConfig(env));
  expect(Object.getOwnPropertyNames(Object.getPrototypeOf(provider)).sort()).toEqual(['constructor','createCheckout','getCheckout','getPayment','getRefund','refund']);
  expect(Object.getOwnPropertyNames(provider)).toEqual([]);
});
it('reads by an id with a dash in it: a dash cannot change the path',async()=>{
  const {fetcher,provider}=wired(json({...paymentReply,payment_id:'pay_Fixture-With-Dash'}));
  expect((await provider.getPayment('pay_Fixture-With-Dash')).paymentId).toBe('pay_Fixture-With-Dash');
  expect(sent(fetcher).url).toBe('https://test.dodopayments.com/payments/pay_Fixture-With-Dash');
});
it.each<[string,unknown]>([['a number',5],['an object',{href:`https://test.dodopayments.com/invoices/payments/${PAYMENT}`}],['a list',[`https://test.dodopayments.com/invoices/payments/${PAYMENT}`]],['true',true]])
('a payment whose invoice address is %s is still read: everything the gate decides on is as Dodo said, and no address is kept',async(_name,invoice)=>{
  const plain=await wired(json(paymentReply)).provider.getPayment(PAYMENT);
  expect(await wired(json({...paymentReply,invoice_url:invoice})).provider.getPayment(PAYMENT)).toStrictEqual({...plain,invoiceUrl:null});
});
// Dodo's own answers, word for word, from a refund asked in its test mode while the account's wallet could not cover it (2026-10-07): HTTP 409, and the payment listed no refund afterwards.
it('a refund Dodo answers with "insufficient wallet funds" is "no refund was made": the wallet could not cover it, so no money moved; the same answer to any other call, or as a failure of Dodo\'s own, is not',async()=>{
  const body={code:'INSUFFICIENT_WALLET_FUNDS',message:'Insufficient funds in wallet'};
  for(const [name,run] of calls){
    const error=await failureOf(run(failed(async()=>json(body,409))));
    expect({kind:error.kind,status:error.status,code:error.code},name).toStrictEqual({kind:name==='refund'?'no-refund':'client',status:409,code:'INSUFFICIENT_WALLET_FUNDS'});
  }
  expect((await failureOf(failed(async()=>json(body,500)).refund(refundInput))).kind).toBe('server');
  for(const other of [{code:'INSUFFICIENT_WALLET_FUND'},{code:'insufficient_wallet_funds'},{message:'Insufficient funds in wallet'}])
    expect((await failureOf(failed(async()=>json(other,409)).refund(refundInput))).kind,JSON.stringify(other)).toBe('client');
});
it('Dodo\'s real answer to a refund of a payment whose refund is done (HTTP 400, not 422) is still "a refund of this payment exists"',async()=>{
  const error=await failureOf(failed(async()=>json({code:'PAYMENT_ALREADY_REFUNDED',message:'This payment has already been refunded'},400)).refund(refundInput));
  expect({kind:error.kind,status:error.status,code:error.code}).toStrictEqual({kind:'refund-exists',status:400,code:'PAYMENT_ALREADY_REFUNDED'});
});
it('a refund in the payment\'s own list carries Dodo\'s word that it is a part of the payment, as a refund read by itself does; one the list does not call so carries none',async()=>{
  const listed=(over:object)=>wired(json({...paymentReply,refunds:[{refund_id:REFUND,status:'succeeded',amount:1000,currency:'USD',...over}]})).provider.getPayment(PAYMENT).then(payment=>payment.refunds);
  expect(await listed({is_partial:true})).toStrictEqual([{refundId:REFUND,status:'succeeded',amount:1000,partial:true}]);
  for(const is_partial of [false,null,undefined,'yes',1])expect(await listed({is_partial}),String(is_partial)).toStrictEqual([{refundId:REFUND,status:'succeeded',amount:1000}]);
});
