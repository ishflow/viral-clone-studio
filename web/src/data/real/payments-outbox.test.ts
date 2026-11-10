// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { resetStore, getStore } from '../mock/store';
import { keepEmail } from '../mock/mailer';
import { MailDeliveryError, drainOutbox, requeueDelivery } from './payments-outbox';
import { paymentStore } from './payments-store';
beforeEach(()=>{resetStore();vi.useRealTimers();});
it('captures existing auth/job emails, retries five times and records only safe attention ids',async()=>{
 vi.useFakeTimers();
 keepEmail('ready','owner@example.com',{jobId:'job'});keepEmail('reset','owner@example.com',{token:'placeholder'});
 const send=vi.fn().mockRejectedValue(new Error('sensitive provider error'));
 for(let n=0;n<5;n++){await drainOutbox({send});vi.advanceTimersByTime(3600000);}
 expect(send).toHaveBeenCalledTimes(10);expect(paymentStore().deliveries.every(d=>d.status==='failed'&&d.attempts===5)).toBe(true);
 expect(paymentStore().attention.join()).not.toContain('sensitive');vi.useRealTimers();
});
it('success is durable and a second sweep sends nothing again',async()=>{
 keepEmail('verify','owner@example.com',{token:'placeholder'});
 const send=vi.fn().mockResolvedValue({id:'fake-delivered'});await drainOutbox({send});await drainOutbox({send});
 expect(send).toHaveBeenCalledTimes(1);expect(paymentStore().deliveries[0]?.status).toBe('sent');expect(getStore().outbox).toHaveLength(1);
});
it('an admin can queue a failed or blocked email again; a sent one is left alone',async()=>{
 keepEmail('verify','a@example.com',{token:'placeholder'});keepEmail('reset','b@example.com',{token:'placeholder'});
 const failing=vi.fn().mockRejectedValue(new MailDeliveryError('permanent'));await drainOutbox({send:failing});
 expect(paymentStore().deliveries.map(d=>d.status)).toEqual(['failed','failed']);
 const [first,second]=paymentStore().deliveries;
 expect(requeueDelivery(first!.emailId)).toBe(true);
 expect(paymentStore().deliveries[0]).toMatchObject({status:'queued',attempts:0,nextTryAt:0});
 expect(paymentStore().attention.some(a=>a.includes(first!.emailId))).toBe(false);
 expect(paymentStore().attention.some(a=>a.includes(second!.emailId))).toBe(true);
 const send=vi.fn().mockResolvedValue({id:'fake-delivered'});await drainOutbox({send});
 expect(send).toHaveBeenCalledTimes(1);expect(paymentStore().deliveries[0]?.status).toBe('sent');
 expect(requeueDelivery(first!.emailId)).toBe(false);   // already sent: never twice
 expect(requeueDelivery('no-such-email')).toBe(false);
});
