import type { SentEmail } from '@/data/ports';
import type { EmailTransport } from '@/data/real/payments-outbox';
import { MailDeliveryError } from '@/data/real/payments-outbox';
import { getStore } from '@/data/mock/store';
import { renderEmail } from './email';
import { allowedRecipient, mailConfig } from './mail-config';
import type { ResendConfig } from './mail-config';
import { FakeMailer } from '@/data/real/payments-outbox';
/** Provider contract/idempotency remains unverified until the owner runs live smoke. */
export class ResendMailer implements EmailTransport {
  constructor(private config:ResendConfig,private fetcher:typeof fetch=fetch){}
  async send(mail:SentEmail,idempotencyKey:string):Promise<{id:string}>{
    if(!allowedRecipient(mail.to,this.config.allow))throw new MailDeliveryError('blocked-by-allowlist');
    if(!/^[A-Za-z0-9:_-]{1,200}$/.test(idempotencyKey))throw new MailDeliveryError('permanent');
    const rendered=renderEmail(mail,getStore().users.find(u=>u.id===mail.data.userId||u.email===mail.to||u.pendingEmail===mail.to)?.locale??'en',this.config.base);
    try{
      const response=await this.fetcher(`${this.config.endpoint}/emails`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${this.config.key}`,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify({from:this.config.from,to:mail.to,...rendered})});
      if(!response.ok){await response.body?.cancel();throw new MailDeliveryError(response.status===429||response.status>=500?'transient':'permanent');}
      const result:unknown=await response.json();
      const id=typeof result==='object'&&result!==null&&'id' in result?result.id:null;
      if(typeof id!=='string'||! /^[A-Za-z0-9_-]{1,200}$/.test(id))throw new MailDeliveryError('transient');
      return {id};
    }catch(error){if(error instanceof MailDeliveryError)throw error;throw new MailDeliveryError('transient');}
  }
}
export function configuredMailer():EmailTransport {
  const config=mailConfig();
  return config.mode==='resend'?new ResendMailer(config):new FakeMailer();
}
