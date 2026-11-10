import { z } from 'zod';
import { dodoAddress } from '@/core/payments/dodo-address';
import { PACKS } from '../../mock/demo-values';
import { fetchHttp, HttpError } from './http';
import type { Http, HttpResponse } from './http';
const TEST_BASE='https://test.dodopayments.com';
/** `key` is a function: printing the settings (a log line, `inspect`, JSON) cannot show the key. */
export interface DodoConfig { base:string; key:()=>string; products:ReadonlyMap<string,string> }
/** Fail-closed Dodo settings for test mode. No error contains an environment value. */
export function dodoConfig(env:Record<string,string|undefined>=process.env):DodoConfig {
  const key=env.DODO_API_KEY_TEST;
  // Visible ASCII only: anything else cannot travel in a header, and every call would fail later as a dead line.
  if(!key||!/^[\x21-\x7e]+$/.test(key))throw new Error('dodo-key-required');
  let base:URL;
  try{base=new URL(env.DODO_API_BASE_TEST??TEST_BASE);}catch{throw new Error('invalid-dodo-base');}
  // The key is sent to the provider's own test address and nowhere else.
  if(base.origin!==TEST_BASE||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw new Error('invalid-dodo-base');
  const products=new Map<string,string>();
  for(const pack of PACKS){
    if(pack.priceCents===null)continue;
    const name=`DODO_PRODUCT_${pack.id.toUpperCase().replaceAll('-','_')}`,product=env[name];
    if(!product||!/^pdt_[A-Za-z0-9]{1,100}$/.test(product))throw new Error(`dodo-product-required:${name}`);
    if([...products.values()].includes(product))throw new Error('dodo-product-duplicate');
    products.set(pack.id,product);
  }
  return {base:TEST_BASE,key:()=>key,products};
}
// Provider ids are put into request paths: nothing but these characters may pass, in either direction.
const ID=/^[A-Za-z0-9_-]{1,200}$/;
const id=z.string().regex(ID);
const at=z.iso.datetime({offset:true}).transform(value=>new Date(value).toISOString());
const count=z.number().int().nonnegative().safe();
const paymentStatus=z.enum(['succeeded','failed','cancelled','processing','requires_customer_action','requires_merchant_action','requires_payment_method','requires_confirmation','requires_capture','partially_captured','partially_captured_and_capturable']);
const refundStatus=z.enum(['succeeded','failed','pending','review']);
const paymentPage=z.string().transform(dodoAddress).pipe(z.string());
// Each schema keeps only what the gate decides on; the provider's other fields are ignored.
const createdSession=z.object({session_id:id,checkout_url:paymentPage})
  .transform(r=>({sessionId:r.session_id,url:r.checkout_url}));
const session=z.object({id,payment_id:id.nullish(),payment_status:paymentStatus.nullish()})
  .transform(r=>({sessionId:r.id,paymentId:r.payment_id??null,paymentStatus:r.payment_status??null}));
const payment=z.object({payment_id:id,status:paymentStatus.nullish(),total_amount:count,tax:count.nullish(),currency:z.string().regex(/^[A-Z]{3}$/),metadata:z.record(z.string(),z.unknown()),
  checkout_session_id:id.nullish(),product_cart:z.array(z.object({product_id:id,quantity:count})).nullish(),refunds:z.array(z.object({refund_id:id,status:refundStatus,amount:count.nullish(),currency:z.unknown().optional(),is_partial:z.unknown().optional()})),
  invoice_url:z.unknown().optional(),created_at:at})
  .refine(r=>(r.tax??0)<=r.total_amount)
  .transform(r=>({paymentId:r.payment_id,status:r.status??null,totalAmount:r.total_amount,tax:r.tax??null,currency:r.currency,
    checkoutId:typeof r.metadata.checkout_id==='string'?r.metadata.checkout_id:null,sessionId:r.checkout_session_id??null,
    products:(r.product_cart??[]).map(item=>({productId:item.product_id,quantity:item.quantity})),
    // A refund listed in another currency than the payment's has no amount here: that number is no part of the payment's sum.
    // `partial`, as in a refund read by itself: there only where Dodo's list itself calls the refund a part of the payment.
    refunds:r.refunds.map(item=>({refundId:item.refund_id,status:item.status,amount:typeof item.currency==='string'&&item.currency!==r.currency?null:item.amount??null,...(item.is_partial===true?{partial:true as const}:{})})),
    invoiceUrl:dodoAddress(r.invoice_url),createdAt:r.created_at}));
// `partial`: Dodo itself calls the refund a part of the payment. Whatever else stands in that field is no such word, and never a reason not to read the refund.
const refund=z.object({refund_id:id,payment_id:id,status:refundStatus,amount:count.nullish(),currency:z.string().regex(/^[A-Z]{3}$/).nullish(),is_partial:z.unknown().optional(),created_at:at})
  .transform(r=>({refundId:r.refund_id,paymentId:r.payment_id,status:r.status,amount:r.amount??null,currency:r.currency??null,createdAt:r.created_at,...(r.is_partial===true?{partial:true as const}:{})}));
export type DodoPaymentStatus=z.infer<typeof paymentStatus>;
export type DodoRefundStatus=z.infer<typeof refundStatus>;
export type DodoSession=z.infer<typeof session>;
export type DodoPayment=z.infer<typeof payment>;
export type DodoRefund=z.infer<typeof refund>;
export type DodoFailure='invalid-request'|'timeout'|'network'|'redirect'|'client'|'server'|'invalid-response'|'refund-exists'|'no-refund';
/** Dodo's refusals of a refund that say the payment has one already, in work or done. */
const REFUND_EXISTS=['EXISTING_REFUND_REQUEST_PROCESSING','PAYMENT_ALREADY_REFUNDED','PAYMENT_HAS_BEEN_REFUNDED'];
/**
 * Dodo's refusals of a refund that can only mean no refund was made. A short list on purpose: a code that is not here proves nothing.
 * The last one is not in Dodo's documents: it is what Dodo answered (HTTP 409) each time its wallet could not cover a refund, and each time the payment listed no refund afterwards.
 */
export const NO_WALLET_FUNDS='INSUFFICIENT_WALLET_FUNDS';
const NO_REFUND=['REFUND_WINDOW_EXPIRED','PAYMENT_NOT_SUCCEEDED','ZERO_AMOUNT_PAYMENT_REFUND_NOT_ALLOWED',NO_WALLET_FUNDS];
export class DodoError extends Error {
  constructor(readonly kind:DodoFailure,readonly status?:number,readonly code?:string){super([`dodo-${kind}`,status,code].filter(part=>part!==undefined).join(':'));this.name='DodoError';}
}
/** Our own checkout id travels as metadata: Dodo hands it back in every notice, and it is what ties a payment to a checkout. */
function ourId(value:string):string {
  if(!/^[A-Za-z0-9-]{1,200}$/.test(value))throw new DodoError('invalid-request');
  return value;
}
/**
 * Where Dodo sends the buyer back to: a plain web address without credentials, sent in the form a browser reads it.
 * `http` passes because test mode runs on a local address. Before live mode is opened this must take `https` only.
 */
function webAddress(value:string):string {
  let url:URL|null=null;
  try{url=/[\s\\\x00-\x1f\x7f]/.test(value)?null:new URL(value);}catch{}
  if(!url||!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new DodoError('invalid-request');
  return url.href;
}
function checkedId(value:string):string {
  if(!ID.test(value))throw new DodoError('invalid-request');
  return value;
}
/** A reply about another object than the one asked for is not an answer. */
function sameId(asked:string,answered:string):void {
  if(asked!==answered)throw new DodoError('invalid-response');
}
function parsed(text:string):unknown {
  try{return JSON.parse(text);}catch{return undefined;}
}
/** Dodo's machine code for a refusal (e.g. PAYMENT_ALREADY_REFUNDED). Its free-text message is never kept. */
function refusalCode(text:string):string|undefined {
  const code=z.object({code:z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/)}).safeParse(parsed(text));
  return code.success?code.data.code:undefined;
}
/** Dodo's five calls of the payment flow. Nothing here writes credits or logs; a call either returns a checked reply or throws. */
export class DodoProvider {
  // Runtime-private on purpose: printing the provider object must not show the key.
  readonly #config:DodoConfig;
  readonly #http:Http;
  constructor(config:DodoConfig,http:Http=fetchHttp()){this.#config=config;this.#http=http;}
  async createCheckout(input:{checkoutId:string;packId:string;email:string;returnUrl:string;cancelUrl:string}):Promise<{sessionId:string;url:string}> {
    const product=this.#config.products.get(input.packId);
    if(!product)throw new DodoError('invalid-request');
    // Dodo's page lets the buyer change the currency and enter a discount code unless told otherwise; either one makes a payment the gate can never credit.
    return this.#call('POST','/checkouts',createdSession,{product_cart:[{product_id:product,quantity:1}],customer:{email:input.email},metadata:{checkout_id:ourId(input.checkoutId)},
      return_url:webAddress(input.returnUrl),cancel_url:webAddress(input.cancelUrl),billing_currency:'USD',feature_flags:{allow_currency_selection:false,allow_discount_code:false}});
  }
  async getCheckout(sessionId:string):Promise<DodoSession> {
    const reply=await this.#call('GET',`/checkouts/${checkedId(sessionId)}`,session);
    sameId(sessionId,reply.sessionId);return reply;
  }
  async getPayment(paymentId:string):Promise<DodoPayment> {
    const reply=await this.#call('GET',`/payments/${checkedId(paymentId)}`,payment);
    sameId(paymentId,reply.paymentId);return reply;
  }
  /**
   * Always the whole payment. Dodo documents no idempotency key, so a failure says one of three things. `no-refund` (a refusal Dodo names as
   * such) or `invalid-request` (nothing was sent): there is no refund. `refund-exists`: the payment has a refund already (often ours, whose
   * answer never came), so money is going back. Any other, `client` included: not known. Only after the first may the refund be asked again
   * or its credits given back; after the others, read the payment's refunds.
   * `idempotencyKey` protects nothing at Dodo: it is written into the refund's metadata as a trace, and no later read returns it.
   */
  async refund(input:{paymentId:string;reason:string;checkoutId:string;idempotencyKey:string}):Promise<DodoRefund> {
    if(!input.reason.trim()||input.reason.length>3000)throw new DodoError('invalid-request');
    const reply=await this.#call('POST','/refunds',refund,{payment_id:checkedId(input.paymentId),reason:input.reason,metadata:{checkout_id:ourId(input.checkoutId),refund_key:input.idempotencyKey}})
      .catch((error:unknown)=>{
        const code=error instanceof DodoError&&error.kind==='client'?error.code??'':'', kind=REFUND_EXISTS.includes(code)?'refund-exists':NO_REFUND.includes(code)?'no-refund':null;
        throw kind?new DodoError(kind,(error as DodoError).status,code):error;
      });
    sameId(input.paymentId,reply.paymentId);return reply;
  }
  async getRefund(refundId:string):Promise<DodoRefund> {
    const reply=await this.#call('GET',`/refunds/${checkedId(refundId)}`,refund);
    sameId(refundId,reply.refundId);return reply;
  }
  async #call<T>(method:'GET'|'POST',path:string,schema:z.ZodType<T>,payload?:unknown):Promise<T> {
    // Settings put together by hand may name another address: the key leaves for Dodo's own test address only.
    if(this.#config.base!==TEST_BASE)throw new DodoError('invalid-request');
    const url=TEST_BASE+path,headers={Authorization:`Bearer ${this.#config.key()}`,Accept:'application/json'};
    let reply:HttpResponse;
    try{
      reply=await this.#http(payload===undefined?{method,url,headers}:{method,url,headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(payload)});
    }catch(error){
      const kind=error instanceof HttpError?error.kind:'network';
      throw new DodoError(kind==='insecure-url'?'invalid-request':kind==='too-large'?'invalid-response':kind);
    }
    if(reply.status<200||reply.status>=300)throw new DodoError(reply.status>=500?'server':'client',reply.status,refusalCode(reply.body));
    // "Here is the object" is 200 or 201. Any other success status (accepted, no content, partial) is not an answer to rely on.
    if(reply.status>201)throw new DodoError('invalid-response',reply.status);
    const result=schema.safeParse(parsed(reply.body));
    if(!result.success)throw new DodoError('invalid-response');
    return result.data;
  }
}
