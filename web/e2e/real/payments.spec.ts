import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { World, unique, ADMIN_EMAIL, ADMIN_PASSWORD } from './world';
import { sign } from '../../src/data/real/payments/signature';
let world:World;
const secret=randomBytes(32).toString('hex');
test.beforeAll(async()=>{world=await World.start({port:3201,distDir:'.next-payments',siteEnv:{VC_PAYMENTS:'fake',VC_PAYMENTS_WEBHOOK_SECRET:secret,PUBLIC_BASE_URL:'http://127.0.0.1:3201'}});});
test.afterAll(async()=>{await world?.stop();});
function state(){return JSON.parse(readFileSync(join(world.dir,'site.json'),'utf8'));}
async function notice(checkoutId:string,kind:'paid'|'refunded'|'refund-failed'){
  const r=state().paymentsState.records.find((r:{checkoutId:string})=>r.checkoutId===checkoutId);
  const eventId=crypto.randomUUID();
  const event={eventId,checkoutId,providerSessionId:r.sessionId,providerPaymentId:r.paymentId,amountMinor:r.amountMinor,currency:'USD',kind,occurredAt:new Date().toISOString(),...(kind==='paid'?{}:{providerRefundId:r.refundId})};
  const raw=JSON.stringify(event),headers=new Headers({'webhook-id':eventId,'webhook-timestamp':String(Math.floor(Date.now()/1000))});
  headers.set('webhook-signature',sign(raw,headers,secret));
  const response=await fetch(`${world.base}/api/payments/webhook`,{method:'POST',headers,body:raw});
  expect(response.status).toBe(200);return {raw,headers};
}
test('checkout → signed notice → one credit lot → refund failure/retry → refunded → restart',async({page,browser})=>{
  const email=unique('payment'),password='payment-customer-password';
  await page.goto(`${world.base}/signup`);await page.getByLabel('Email').fill(email);await page.getByLabel('Password').fill(password);await page.getByRole('button',{name:'Sign up',exact:true}).click();
  await expect(page).toHaveURL(/verify-email$/);await page.goto(await world.link(email,'verify'));await expect(page).toHaveURL(/welcome$/);
  await page.goto(`${world.base}/pricing`);await page.getByRole('button',{name:'Buy',exact:true}).first().click();await expect(page).toHaveURL(/checkout\/mock\//);
  const checkoutId=new URL(page.url()).pathname.split('/').pop()!;
  await page.goto(`${world.base}/checkout/return?c=${checkoutId}`);await expect(page.getByRole('heading',{name:'Confirming your payment…'})).toBeVisible();
  const delivered=await notice(checkoutId,'paid');expect((await fetch(`${world.base}/api/payments/webhook`,{method:'POST',headers:delivered.headers,body:delivered.raw})).status).toBe(200);
  await page.reload();await expect(page.getByRole('heading',{name:/10 credits added/})).toBeVisible();
  await page.goto(`${world.base}/account`);await page.getByRole('button',{name:'Request a refund',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Request refund',exact:true}).click();await expect(page.getByRole('region',{name:'Purchases'})).toContainText('Refund requested');
  const p=state().purchases.find((p:{userId:string})=>p.userId===state().users.find((u:{email:string})=>u.email===email).id);
  const adminContext=await browser.newContext();const admin=await adminContext.newPage();
  await admin.goto(`${world.base}/login`);await admin.getByLabel('Email').fill(ADMIN_EMAIL);await admin.getByLabel('Password').fill(ADMIN_PASSWORD);await admin.getByRole('button',{name:'Log in',exact:true}).click();await expect(admin).not.toHaveURL(/\/login/);
  await admin.goto(`${world.base}/admin/revenue`);
  const row=admin.getByRole('row').filter({hasText:email});await row.getByRole('button',{name:'Refund',exact:true}).click();await admin.getByRole('dialog').getByLabel('Reason').fill('Unused pack request');await admin.getByRole('dialog').getByRole('button',{name:'Refund',exact:true}).click();
  await expect(admin.getByRole('dialog',{name:'Done'})).toBeVisible();await notice(checkoutId,'refund-failed');
  await page.reload();await expect(page.getByRole('region',{name:'Purchases'})).toContainText('Refund failed');
  await admin.reload();await row.getByRole('button',{name:'Try the refund again',exact:true}).click();await admin.getByRole('dialog').getByLabel('Reason').fill('Retry requested');await admin.getByRole('dialog').getByRole('button',{name:'Try the refund again',exact:true}).click();await expect(admin.getByRole('dialog',{name:'Done'})).toBeVisible();
  await notice(checkoutId,'refunded');await page.reload();await expect(page.getByRole('region',{name:'Purchases'})).toContainText('Refunded');
  expect(state().ledger.filter((e:{type:string;relatedPurchaseId:string})=>e.type==='purchase'&&e.relatedPurchaseId===p.id)).toHaveLength(1);
  expect(state().outbox.filter((m:{kind:string;to:string})=>m.kind==='payment'&&m.to===email)).toHaveLength(1);
  await world.restartSite();await page.reload();await expect(page.getByRole('region',{name:'Purchases'})).toContainText('Refunded');await adminContext.close();
});
