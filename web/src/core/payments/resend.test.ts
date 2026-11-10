// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { mailConfig, type ResendConfig } from './mail-config';
import { ResendMailer } from './resend';
import { keepEmail } from '@/data/mock/mailer';
import { resetStore } from '@/data/mock/store';
import { drainOutbox } from '@/data/real/payments-outbox';
import { paymentStore } from '@/data/real/payments-store';
function realConfig(env:Record<string,string|undefined>):ResendConfig {const config=mailConfig(env);if(config.mode!=='resend')throw Error('resend required');return config;}
const env={VC_MAIL:'resend',RESEND_API_KEY:'test-placeholder',MAIL_FROM:'no-reply@ishflow.com',VC_MAIL_ALLOW:'owner@example.com',PUBLIC_BASE_URL:'http://127.0.0.1:3202'};
afterEach(()=>vi.unstubAllEnvs());
it('fails closed without a valid sender, key, allowlist or safe endpoint',()=>{
 for(const key of ['RESEND_API_KEY','MAIL_FROM','VC_MAIL_ALLOW'])expect(()=>mailConfig({...env,[key]:''})).toThrow();
 expect(()=>mailConfig({...env,VC_MAIL_ALLOW:'example.com.evil/'})).toThrow();
 expect(()=>mailConfig({...env,RESEND_BASE_URL:'http://evil.example'})).toThrow();
 expect(()=>mailConfig({...env,RESEND_BASE_URL:'http://127.0.0.1:9999',VC_MAIL_TEST:'1'})).not.toThrow();
});
it('posts all mail kinds to a local HTTP server once, preserves keys, blocks strangers, retries 429/5xx and permanently fails 4xx',async()=>{
 resetStore();let status=200;const requests:{headers:Record<string,unknown>;body:Record<string,unknown>}[]=[];
 const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;requests.push({headers:req.headers,body:JSON.parse(raw)});res.writeHead(status,{'content-type':'application/json'});res.end(status===200?JSON.stringify({id:`mail-${requests.length}`}):'sensitive-provider-body');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();if(!address||typeof address==='string')throw Error('address');
 try{
 const transport=new ResendMailer(realConfig({...env,VC_MAIL_TEST:'1',RESEND_BASE_URL:`http://127.0.0.1:${address.port}`}));
 for(const kind of ['verify','reset','ready','stopped','payment'] as const)keepEmail(kind,'owner@example.com',{token:'test-token',jobId:'job',credits:'10'});
 keepEmail('payment','owner@example.com',{refund:'true',credits:'10',packName:'Pack'});
 keepEmail('verify','stranger@example.com',{token:'secret'});
 await drainOutbox(transport);await drainOutbox(transport);
 expect(requests).toHaveLength(6);expect(requests[0]!.headers.authorization).toBe('Bearer test-placeholder');
 for(const r of requests){expect(r.headers['idempotency-key']).toEqual(expect.any(String));expect(r.body).toMatchObject({from:env.MAIL_FROM,to:'owner@example.com',subject:expect.any(String),html:expect.any(String),text:expect.any(String)});}
 expect(requests[5]!.body.subject).toContain('refund');expect(paymentStore().deliveries.at(-1)?.status).toBe('blocked-by-allowlist');
 status=429;keepEmail('ready','owner@example.com',{jobId:'retry'});await drainOutbox(transport);const retry=paymentStore().deliveries.at(-1)!;expect(retry.status).toBe('queued');expect(retry.attempts).toBe(1);await drainOutbox(transport);expect(requests).toHaveLength(7);
 status=503;retry.nextTryAt=0;await drainOutbox(transport);expect(retry.attempts).toBe(2);expect(requests[6]!.headers['idempotency-key']).toBe(requests[7]!.headers['idempotency-key']);
 status=422;retry.nextTryAt=0;await drainOutbox(transport);expect(retry.status).toBe('failed');expect(paymentStore().attention).toContain(`email-failed:${retry.emailId}`);expect(JSON.stringify(paymentStore())).not.toContain('sensitive-provider-body');
 status=200;await drainOutbox(new ResendMailer(realConfig({...env,VC_MAIL_ALLOW:'example.com',VC_MAIL_TEST:'1',RESEND_BASE_URL:`http://127.0.0.1:${address.port}`})));expect(paymentStore().deliveries.find(d=>d.status==='blocked-by-allowlist')).toBeUndefined();
 }finally{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));}
});
it('timeout is retryable, redirects never leak authorization and unsafe provider IDs never enter storage',async()=>{
 const config=realConfig(env),mail={id:'mail',kind:'ready' as const,to:'owner@example.com',at:'2026-10-05',data:{jobId:'job'}};
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({id:'private response with spaces'})));
 await expect(new ResendMailer(config,fetcher).send(mail,mail.id)).rejects.toThrow('mail-transient');
 expect(fetcher.mock.calls[0]![1].redirect).toBe('error');expect(fetcher.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
});
it('recipient allowlist is exact, supports domains, and fails closed on injected addresses',async()=>{
 const {allowedRecipient}=await import('./mail-config');
 expect(allowedRecipient('Owner@Example.com',['example.com'])).toBe(true);
 for(const to of ['owner@sub.example.com','owner@example.com.evil','owner@example.com\r\nBcc: evil@example.org'])expect(allowedRecipient(to,['example.com'])).toBe(false);
});
it('a lone * lets mail go to every valid address, while unset, mixed or partial wildcards still stop the site',async()=>{
 const {allowedRecipient}=await import('./mail-config');
 expect(mailConfig({...env,VC_MAIL_ALLOW:' * '})).toMatchObject({mode:'resend',allow:['*']});
 for(const to of ['owner@example.com','Anyone@Other.org'])expect(allowedRecipient(to,['*'])).toBe(true);
 for(const to of ['not-an-address','owner@example.com\r\nBcc: evil@example.org','owner@localhost',''])expect(allowedRecipient(to,['*'])).toBe(false);
 for(const bad of ['','*,a.com','a.com,*','*,*','*.com','*@x.com','**','a*.com'])expect(()=>mailConfig({...env,VC_MAIL_ALLOW:bad}),bad).toThrow('mail-allowlist-required');
 expect(()=>mailConfig({...env,VC_MAIL_ALLOW:undefined})).toThrow('mail-allowlist-required');
 try{mailConfig({...env,VC_MAIL_ALLOW:'*.private-value.com'});}catch(e){expect(String(e)).not.toContain('private-value');}
});
it('with * the outbox sends to a stranger instead of blocking them',async()=>{
 resetStore();const requests:string[]=[];
 const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;requests.push(JSON.parse(raw).to);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:`mail-${requests.length}`}));});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();if(!address||typeof address==='string')throw Error('address');
 try{
 keepEmail('verify','stranger@example.org',{token:'t'});
 await drainOutbox(new ResendMailer(realConfig({...env,VC_MAIL_ALLOW:'*',VC_MAIL_TEST:'1',RESEND_BASE_URL:`http://127.0.0.1:${address.port}`})));
 expect(requests).toEqual(['stranger@example.org']);expect(paymentStore().deliveries.at(-1)?.status).toBe('sent');
 }finally{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));}
});
it('Resend disables demo aids even with explicit demo links',async()=>{
 vi.stubEnv('VC_MAIL','resend');vi.stubEnv('VC_DEMO_LINKS','1');
 const {demoAidsAllowed}=await import('../paid-mode');expect(demoAidsAllowed()).toBe(false);
});
it('signup, successful resend, reset and email change enqueue real tokens and leave through local HTTP',async()=>{
 const {auth}=await import('@/data/mock/auth');resetStore();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
 const bodies:{to:string;text:string}[]=[];
 const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;bodies.push(JSON.parse(raw));res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:`auth-${bodies.length}`}));});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();if(!address||typeof address==='string')throw Error('address');
 try{
 const user=await auth.signUp('owner@example.com','a-long-test-password');
 vi.setSystemTime(new Date('2026-10-05T12:02:00Z'));expect((await auth.resendVerification(user.id)).sent).toBe(true);
 await auth.requestPasswordReset(user.email);await auth.updateProfile(user.id,{email:'changed@example.com',locale:'tr'});
 const transport=new ResendMailer(realConfig({...env,VC_MAIL_ALLOW:'example.com',VC_MAIL_TEST:'1',RESEND_BASE_URL:`http://127.0.0.1:${address.port}`}));
 await drainOutbox(transport);await drainOutbox(transport);expect(bodies).toHaveLength(4);
 expect(bodies.slice(0,2).every(b=>b.text.includes('/verify-email/confirm?token='))).toBe(true);expect(bodies[2]!.text).toContain('/reset-password?token=');expect(bodies[3]!.to).toBe('changed@example.com');expect(bodies[3]!.text).toContain('/verify-email/confirm?token=');expect(bodies[3]!.text).toContain('Yeni e-posta adresini onayla');
 }finally{vi.useRealTimers();await new Promise<void>(r=>server.close(()=>r()));}
});
