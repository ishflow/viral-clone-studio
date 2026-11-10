import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { World, unique, ADMIN_EMAIL, ADMIN_PASSWORD, fillGenerateForm, confirmJob, expectReady } from './world';
import { sign } from '../../src/data/real/payments/signature';
let world:World,server:Server;
const secret=randomBytes(32).toString('hex'),cron=randomBytes(32).toString('hex');
const delivered:{key:string;to:string;subject:string;text:string;html:string}[]=[];
test.beforeAll(async()=>{
 server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);delivered.push({key:String(req.headers['idempotency-key']),...body});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:`local-mail-${delivered.length}`}));});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();if(!address||typeof address==='string')throw Error('address');
 world=await World.start({port:3202,distDir:'.next-codexm',failClip:1,siteEnv:{VC_MAIL:'resend',VC_MAIL_TEST:'1',RESEND_BASE_URL:`http://127.0.0.1:${address.port}`,RESEND_API_KEY:'test-placeholder',MAIL_FROM:'no-reply@ishflow.com',VC_MAIL_ALLOW:'example.com',VC_DEMO_LINKS:'1',VC_PAYMENTS:'fake',VC_PAYMENTS_WEBHOOK_SECRET:secret,PUBLIC_BASE_URL:'http://127.0.0.1:3202',INTERNAL_CRON_SECRET:cron}});
});
test.afterAll(async()=>{await world?.stop();if(server)await new Promise<void>(r=>server.close(()=>r()));});
function state(){return JSON.parse(readFileSync(join(world.dir,'site.json'),'utf8'));}
async function sweep(){expect((await fetch(`${world.base}/api/payments/sweep`,{method:'POST',headers:{Authorization:`Bearer ${cron}`}})).status).toBe(200);}
function mailLink(subject:string,to:string){const mail=delivered.findLast(m=>m.subject===subject&&m.to===to);expect(mail).toBeDefined();const link=mail!.text.match(/http:\/\/127\.0\.0\.1:3202\/[^\s]+/)?.[0];expect(link).toBeDefined();return link!;}
async function notice(checkoutId:string,kind:'paid'|'refunded'){
 const r=state().paymentsState.records.find((r:{checkoutId:string})=>r.checkoutId===checkoutId),eventId=crypto.randomUUID();
 const raw=JSON.stringify({eventId,checkoutId,kind,providerSessionId:r.sessionId,providerPaymentId:r.paymentId,amountMinor:r.amountMinor,currency:'USD',occurredAt:new Date().toISOString(),...(kind==='refunded'?{providerRefundId:r.refundId}:{})});
 const headers=new Headers({'webhook-id':eventId,'webhook-timestamp':String(Math.floor(Date.now()/1000))});headers.set('webhook-signature',sign(raw,headers,secret));expect((await fetch(`${world.base}/api/payments/webhook`,{method:'POST',headers,body:raw})).status).toBe(200);
}
test('production site + worker + local Resend: auth, jobs, receipt, refund, allowlist and no duplicate sweep',async({page,browser,context})=>{
 const email=unique('mail'),changed=unique('changed'),password='mail-password-for-e2e';
 await context.addCookies([{name:'vc_cookies',value:'necessary',url:world.base}]);
 expect((await fetch(`${world.base}/api/payments/sweep`,{method:'POST'})).status).toBe(401);
 await page.goto(`${world.base}/signup`);await page.getByLabel('Email').fill(email);await page.getByLabel('Password').fill(password);await page.getByRole('button',{name:'Sign up',exact:true}).click();await expect(page).toHaveURL(/verify-email$/);
 await expect(page.getByText(/Demo:/)).toHaveCount(0);await sweep();expect(delivered.filter(m=>m.to===email)).toHaveLength(1);
 await page.getByRole('button',{name:'Send again',exact:true}).click();await expect(page.getByRole('button',{name:/Send again in/})).toBeVisible();await sweep();expect(delivered.filter(m=>m.to===email&&m.subject==='Verify your email')).toHaveLength(1); // The immediate resend is correctly throttled.
 await page.goto(mailLink('Verify your email',email));await expect(page).toHaveURL(/welcome$/);
 // A real worker fails one clip, then the approved retry completes. Both notifications leave through sweep.
 await page.goto(`${world.base}/templates/layering-01/generate`);await fillGenerateForm(page,'Fast');await page.getByRole('button',{name:'Generate',exact:true}).click();await confirmJob(page);
 await expect(page.getByRole('heading',{name:/clips? (is|are) missing/})).toBeVisible({timeout:120000});await sweep();expect(delivered.some(m=>m.to===email&&m.subject==='Your video stopped halfway')).toBe(true);
 await page.getByRole('button',{name:/Try again/}).first().click();await page.getByRole('dialog').getByRole('button',{name:'Confirm and continue'}).click();await expectReady(page);await sweep();expect(delivered.some(m=>m.to===email&&m.subject==='Your video is ready')).toBe(true);
 await page.goto(`${world.base}/account`);await page.getByLabel('Name',{exact:true}).fill('Mail E2E');await page.getByLabel('Email',{exact:true}).fill(changed);await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByText(changed,{exact:false}).first()).toBeVisible();await sweep();await page.goto(mailLink('Verify your email',changed));
 await page.goto(`${world.base}/pricing`);await page.getByRole('button',{name:'Buy',exact:true}).first().click();await expect(page).toHaveURL(/checkout\/mock\//);const checkoutId=new URL(page.url()).pathname.split('/').pop()!;await notice(checkoutId,'paid');await sweep();
 expect(delivered.some(m=>m.to===changed&&m.subject==='Payment received: 10 credits added')).toBe(true);
 await page.goto(`${world.base}/account`);await page.getByRole('button',{name:'Request a refund',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Request refund',exact:true}).click();
 const adminContext=await browser.newContext(),admin=await adminContext.newPage();await admin.goto(`${world.base}/login`);await admin.getByLabel('Email').fill(ADMIN_EMAIL);await admin.getByLabel('Password').fill(ADMIN_PASSWORD);await admin.getByRole('button',{name:'Log in',exact:true}).click();await expect(admin).not.toHaveURL(/login/);
 await admin.goto(`${world.base}/admin/revenue`);await admin.getByRole('row').filter({hasText:changed}).getByRole('button',{name:'Refund',exact:true}).click();await admin.getByRole('dialog').getByLabel('Reason').fill('Mail E2E unused pack');await admin.getByRole('dialog').getByRole('button',{name:'Refund',exact:true}).click();await expect(admin.getByRole('dialog',{name:'Done'})).toBeVisible();await notice(checkoutId,'refunded');await sweep();expect(delivered.some(m=>m.to===changed&&m.subject==='Your refund is complete')).toBe(true);
 await context.clearCookies({name:'vc_session'});await page.goto(`${world.base}/forgot-password`);await page.getByLabel('Email').fill(changed);await page.getByRole('button',{name:'Send reset link'}).click();await expect(page).toHaveURL(/forgot-password\/sent/);await expect(page.getByText(/Demo:/)).toHaveCount(0);await sweep();await page.goto(mailLink('Set a new password',changed));await expect(page.getByRole('heading',{name:'Set a new password.'})).toBeVisible();
 const other=await browser.newContext(),stranger=await other.newPage();const blocked=`stranger-${Date.now()}@outside.invalid`;await stranger.goto(`${world.base}/signup`);await stranger.getByLabel('Email').fill(blocked);await stranger.getByLabel('Password').fill(password);await stranger.getByRole('button',{name:'Sign up',exact:true}).click();await expect(stranger).toHaveURL(/verify-email$/);await sweep();expect(delivered.some(m=>m.to===blocked)).toBe(false);
 await admin.goto(`${world.base}/admin/emails`);await expect(admin.getByText('Blocked by recipient allowlist')).toBeVisible();await expect(admin.getByText(blocked)).toBeVisible();
 const count=delivered.length;await sweep();await world.restartSite();await sweep();expect(delivered).toHaveLength(count);expect(new Set(delivered.map(m=>m.key)).size).toBe(count);expect(delivered.every(m=>!m.html.includes('[COMPANY NAME]')&&!m.html.includes('[ADDRESS]'))).toBe(true);
 await adminContext.close();await other.close();
});
