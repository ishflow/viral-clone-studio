// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { getStore, resetStore } from '../mock/store';
import { paymentsGateway, receivePayment } from './payments-gateway';
import { paymentStore, paymentTransaction } from './payments-store';
import { saveStore } from '../mock/persist';
import { balanceOf } from '../mock/ledger';
import { addDemoCustomers } from '../mock/test-helpers';
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();resetStore();});
it('fsync/rename commit survives restart with events, lot, receipt and one payment email; failed save rolls back',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'vc-payment-store-'));
 vi.stubEnv('VC_ENGINE','sqlite');vi.stubEnv('VC_DATA_DIR',dir);vi.stubEnv('VC_ADMIN_PASSWORD',randomBytes(24).toString('hex'));vi.stubEnv('VC_PAYMENTS','fake');vi.stubEnv('VC_PAYMENTS_WEBHOOK_SECRET',randomBytes(32).toString('hex'));
 resetStore();addDemoCustomers();const user=getStore().users.find(u=>u.role==='customer')!.id;
 const before=balanceOf(user);const c=await paymentsGateway.startCheckout(user,'pack-starter','/gallery','click');
 const r=paymentStore().records[0]!;const event={eventId:'evt-durable',checkoutId:c.checkoutId,providerSessionId:r.sessionId,providerPaymentId:r.paymentId,kind:'paid' as const,amountMinor:r.amountMinor,currency:'USD',occurredAt:new Date().toISOString()};
 receivePayment(event,'durable');const disk=readFileSync(join(dir,'site.json'),'utf8');
 resetStore();receivePayment(event,'durable');expect(balanceOf(user)).toBe(before+10);expect(paymentStore().events).toHaveLength(1);expect(getStore().outbox.filter(m=>m.kind==='payment')).toHaveLength(1);
 expect(readFileSync(join(dir,'site.json'),'utf8')).toBe(disk);
 expect(()=>paymentTransaction(()=>{paymentTransaction(()=>{getStore().users[0]!.name='must rollback';});throw new Error('crash');})).toThrow('crash');
 expect(readFileSync(join(dir,'site.json'),'utf8')).toBe(disk);
 const fs=process.getBuiltinModule('node:fs');const rename=vi.spyOn(fs,'renameSync').mockImplementation(()=>{throw new Error('disk-failed');});
 expect(()=>paymentTransaction(()=>{getStore().users[0]!.name='must not stay';})).toThrow('disk-failed');rename.mockRestore();
 expect(getStore().users[0]!.name).not.toBe('must not stay');saveStore(getStore());
 expect(readFileSync(join(dir,'site.json'),'utf8')).toBe(disk);
});
