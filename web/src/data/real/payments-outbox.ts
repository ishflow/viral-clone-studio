import type { Mailer, SentEmail } from '../ports';
import { getStore, now } from '../mock/store';
import { mailer } from '../mock/mailer';
import { paymentStore, paymentTransaction } from './payments-store';
export interface EmailTransport { send(mail:SentEmail, idempotencyKey:string):Promise<{id:string}> }
export class FakeMailer implements EmailTransport {
  constructor(private render?: (mail: SentEmail) => {html:string;text:string;subject:string}) {}
  async send(mail:SentEmail,idempotencyKey:string){this.render?.(mail);return {id:`fake:${idempotencyKey}`};}
}
export class MailDeliveryError extends Error {
  constructor(readonly disposition:'transient'|'permanent'|'blocked-by-allowlist'){super(`mail-${disposition}`);}
}
const holder=globalThis as typeof globalThis & {__vcPaymentsOutboxDraining?:boolean};
/** Captures all five existing site email kinds. No transport is contacted until after their site transaction commits. */
export async function drainOutbox(transport:EmailTransport=new FakeMailer()):Promise<void>{
  if(holder.__vcPaymentsOutboxDraining)return;holder.__vcPaymentsOutboxDraining=true;
  try{
    paymentTransaction(()=>{for(const mail of getStore().outbox)if(!paymentStore().deliveries.some(d=>d.emailId===mail.id))paymentStore().deliveries.push({emailId:mail.id,status:'queued',attempts:0,nextTryAt:0});});
    for(const delivery of paymentStore().deliveries.filter(d=>(d.status==='queued'||d.status==='blocked-by-allowlist')&&d.nextTryAt<=now().getTime())){
      const mail=getStore().outbox.find(m=>m.id===delivery.emailId);if(!mail)continue;
      // Failure after an external acceptance would retry with the same key; provider idempotency is a C4/C10 gate.
      let id:string|undefined, failure:MailDeliveryError['disposition']='transient';
      try{id=(await transport.send(structuredClone(mail),mail.id)).id;}catch(error){if(error instanceof MailDeliveryError)failure=error.disposition;/* Never retain provider errors. */}
      paymentTransaction(()=>{const d=paymentStore().deliveries.find(d=>d.emailId===delivery.emailId)!;
        if(failure==='blocked-by-allowlist'&&!id){d.status='blocked-by-allowlist';const marker=`email-blocked-by-allowlist:${d.emailId}`;if(!paymentStore().attention.includes(marker))paymentStore().attention.push(marker);return;}
        d.attempts++;
        if(id){d.status='sent';d.providerId=id;}else{d.nextTryAt=now().getTime()+Math.min(3600000,60000*2**(d.attempts-1));if(failure==='permanent'||d.attempts>=5){d.status='failed';paymentStore().attention.push(`email-failed:${d.emailId}`);}}});
    }
  }finally{holder.__vcPaymentsOutboxDraining=false;}
}
/** The admin's "Send again": a failed or blocked email goes back in the queue (the next sweep sends it). A sent email is never queued again. */
export function requeueDelivery(emailId:string):boolean{
  let changed=false;
  paymentTransaction(()=>{const d=paymentStore().deliveries.find(d=>d.emailId===emailId);
    if(!d||(d.status!=='failed'&&d.status!=='blocked-by-allowlist'))return;
    d.status='queued';d.attempts=0;d.nextTryAt=0;changed=true;
    paymentStore().attention=paymentStore().attention.filter(a=>a!==`email-failed:${emailId}`&&a!==`email-blocked-by-allowlist:${emailId}`);});
  return changed;
}
export const durableMailer:Mailer={
  async send(kind,to,data){await mailer.send(kind,to,data);},
  outbox:()=>mailer.outbox(),
};
