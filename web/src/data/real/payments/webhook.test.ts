// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStore, getStore } from '../../mock/store';
import { paymentsGateway } from '../payments-gateway';
import { paymentStore } from '../payments-store';
import { paymentWebhook } from './webhook';
import { sign } from './signature';
import { signDodoWebhook } from './dodo-test-helpers';
import { POST as sweep } from '@/app/api/payments/sweep/route';
let secret:string;
beforeEach(()=>{secret=randomBytes(32).toString('hex');vi.stubEnv('VC_PAYMENTS','fake');vi.stubEnv('VC_PAYMENTS_WEBHOOK_SECRET',secret);resetStore();});
it('bad signature writes nothing; signed duplicates return 200; storage errors return 500',async()=>{
 const user=getStore().users.find(u=>u.role==='customer')!;
 const c=await paymentsGateway.startCheckout(user.id,'pack-starter','/gallery');const r=paymentStore().records[0]!;
 const e={eventId:'fixture-event',kind:'paid',checkoutId:c.checkoutId,providerSessionId:r.sessionId,providerPaymentId:r.paymentId,amountMinor:r.amountMinor,currency:'USD',occurredAt:new Date().toISOString()};
 const raw=JSON.stringify(e);const headers=new Headers({'webhook-id':e.eventId,'webhook-timestamp':String(Math.floor(Date.now()/1000))});
 expect((await paymentWebhook(new Request('http://localhost/api/payments/webhook',{method:'POST',body:raw,headers}))).status).toBe(400);expect(paymentStore().events).toHaveLength(0);
 headers.set('webhook-signature',sign(raw,headers,secret));
 for(let n=0;n<2;n++)expect((await paymentWebhook(new Request('http://localhost/api/payments/webhook',{method:'POST',body:raw,headers}))).status).toBe(200);
 expect(paymentStore().events).toHaveLength(1);
 const invalid=JSON.stringify({...e,eventId:'unknown-checkout',checkoutId:'unknown'});headers.set('webhook-id','unknown-checkout');headers.set('webhook-signature',sign(invalid,headers,secret));
 expect((await paymentWebhook(new Request('http://localhost/api/payments/webhook',{method:'POST',body:invalid,headers}))).status).toBe(500);
});
it('internal sweep fails closed without cron authentication',async()=>{
 vi.stubEnv('INTERNAL_CRON_SECRET','');expect((await sweep(new Request('http://localhost/api/payments/sweep',{method:'POST'}))).status).toBe(401);
});
const knock=(bearer:string)=>sweep(new Request('http://localhost/api/payments/sweep',{method:'POST',headers:{authorization:`Bearer ${bearer}`}}));
it('the sweep\'s door opens to the whole secret only: a secret too short to be one opens it to nobody, and a part of the right one is not the right one',async()=>{
 vi.stubEnv('INTERNAL_CRON_SECRET','a-short-made-up-secret');
 expect((await knock('a-short-made-up-secret')).status).toBe(401);
 const whole='a-made-up-sweep-secret-of-32-chr';vi.stubEnv('INTERNAL_CRON_SECRET',whole);
 for(const part of [whole.slice(0,31),whole.slice(1),whole+'x',whole.toUpperCase(),' '+whole])expect((await knock(part)).status,part).toBe(401);
 expect((await knock(whole)).status).toBe(200);
});
it('a sweep that fails is answered 500 with no reason, so the minute\'s job sees it: never 200',async()=>{
 const whole='a-made-up-sweep-secret-of-32-chr';vi.stubEnv('INTERNAL_CRON_SECRET',whole);
 vi.stubEnv('VC_PAYMENTS','live');
 const response=await knock(whole);
 expect(response.status).toBe(500);expect(await response.text()).toBe('{"error":"payment-sweep-failed"}');
});
describe('Dodo test mode',()=>{
  const dodoSecret='whsec_'+randomBytes(32).toString('base64');
  const url='https://site.example/api/payments/webhook';
  const body=JSON.stringify({business_id:'bus_madeup',type:'payment.succeeded',timestamp:new Date().toISOString(),data:{payload_type:'Payment',payment_id:'pay_A',status:'succeeded',total_amount:1900,tax:0,currency:'USD',metadata:{}}});
  function signed(raw:string,over:{secret?:string;seconds?:number}={}):Headers {
    const seconds=over.seconds??Math.floor(Date.now()/1000);
    return new Headers({'webhook-id':'msg_madeup','webhook-timestamp':String(seconds),'webhook-signature':signDodoWebhook(raw,'msg_madeup',seconds,over.secret??dodoSecret)});
  }
  const post=(raw:BodyInit,headers:Headers)=>paymentWebhook(new Request(url,{method:'POST',body:raw,headers}));
  beforeEach(()=>{
    for(const [name,value] of Object.entries({VC_PAYMENTS:'test',DODO_API_KEY_TEST:'made-up-dodo-test-key',DODO_WEBHOOK_SECRET_TEST:dodoSecret,
      DODO_PRODUCT_PACK_STARTER:'pdt_madeupstarter',DODO_PRODUCT_PACK_STANDARD:'pdt_madeupstandard',DODO_PRODUCT_PACK_STUDIO:'pdt_madeupstudio'}))vi.stubEnv(name,value);
    resetStore();
  });
  it('a signed example that is tied to no checkout of ours is answered 200 without saying why, and changes nothing but the note kept of it',async()=>{
    const before=JSON.stringify({...getStore(),paymentsState:undefined});
    const response=await post(body,signed(body));
    expect(response.status).toBe(200);expect(await response.text()).toBe('{"ok":true}');
    expect(JSON.stringify({...getStore(),paymentsState:undefined})).toBe(before);
    expect(paymentStore()).toMatchObject({records:[],events:[],unhandled:[{eventId:'msg_madeup',reason:'checkout-id-missing'}]});
  });
  it.each<[string,()=>[BodyInit,Headers],number]>([
    ['no signature',()=>[body,new Headers()],400],
    ['another secret',()=>[body,signed(body,{secret:'whsec_'+randomBytes(32).toString('base64')})],400],
    ['one changed byte',()=>[body+' ',signed(body)],400],
    ['a signature of six minutes ago',()=>[body,signed(body,{seconds:Math.floor(Date.now()/1000)-360})],400],
    ['our own fake scheme',()=>{const headers=new Headers({'webhook-id':'msg_madeup','webhook-timestamp':String(Math.floor(Date.now()/1000))});headers.set('webhook-signature',sign(body,headers,dodoSecret));return [body,headers];},400],
    // Nobody proved who sent these: an unreadable body is the sender's fault (400), never ours (5xx).
    ['bytes that are not UTF-8',()=>[new Uint8Array([0xff,0xfe,0x7b]),signed('��{')],400],
    ['a body cut in the middle of a letter',()=>[new Uint8Array([...new TextEncoder().encode(body),0xc3]),signed(body)],400],
    // The signature is over the bytes received: a byte order mark in front is part of them.
    ['a byte order mark in front of a body signed without it',()=>[new Uint8Array([0xef,0xbb,0xbf,...new TextEncoder().encode(body)]),signed(body)],400],
    ['a length header above 64 KB',()=>{const headers=signed(body);headers.set('content-length','65537');return [body,headers];},413],
    ['more than 64 KB',()=>{const big=body+' '.repeat(65536);return [big,signed(big)];},413],
  ])('a delivery with %s is refused and nothing is kept',async(_name,delivery,status)=>{
    const response=await post(...delivery());
    expect(response.status).toBe(status);
    expect(await response.text()).not.toMatch(/whsec|secret|reason|payment_id/);
    expect(getStore().paymentsState).toBeUndefined();
  });
  it('a failure to store a verified notice is answered 500, so Dodo delivers it again',async()=>{
    vi.spyOn(globalThis,'structuredClone').mockImplementationOnce(()=>{throw new Error('made-up-storage-failure');});
    expect((await post(body,signed(body))).status).toBe(500);
    vi.restoreAllMocks();
    expect((await post(body,signed(body))).status).toBe(200);
  });
  it('fake mode does not take a Dodo-signed delivery',async()=>{
    vi.stubEnv('VC_PAYMENTS','fake');vi.stubEnv('VC_PAYMENTS_WEBHOOK_SECRET',dodoSecret);
    expect((await post(body,signed(body))).status).toBe(400);expect(getStore().paymentsState).toBeUndefined();
  });
});
