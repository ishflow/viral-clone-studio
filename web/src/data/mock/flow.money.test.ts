// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '../index';
import { InsufficientCreditsError } from '../ports';
import { resetStore } from './store';
import { START, generateInput as input, startConfirmed } from './test-helpers';

// The flow contract's money and account rules in the fake (task D0): B4, B5/B16, B14, B19/B25, B22, B24.
const DAY_MS = 86_400_000;
const ADMIN = 'usr-admin';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  resetStore();
});
afterEach(() => {
  vi.useRealTimers();
});

/** A Starter pack bought by usr-new (balance 0 before). */
async function starter() {
  const { checkoutId } = await data.payments.startCheckout('usr-new', 'pack-starter', '/gallery');
  return data.payments.complete(checkoutId, 'paid');
}

describe('B4: the payment return', () => {
  it('open → pending → delayed after 60 s → paid; a later answer changes nothing', async () => {
    const { checkoutId } = await data.payments.startCheckout('usr-new', 'pack-starter', '/gallery');
    expect(await data.payments.getCheckout(checkoutId, 'usr-new')).toMatchObject({ status: 'open', delayed: false, startedAt: START.toISOString() });
    expect(await data.payments.notify(checkoutId, 'pending')).toMatchObject({ status: 'pending', delayed: false });
    vi.advanceTimersByTime(61_000);
    expect(await data.payments.getCheckout(checkoutId, 'usr-new')).toMatchObject({ status: 'pending', delayed: true });
    await data.payments.complete(checkoutId, 'paid');
    expect(await data.payments.notify(checkoutId, 'cancelled')).toMatchObject({ status: 'paid', delayed: false });
    expect(await data.ledger.balance('usr-new')).toBe(10);
  });

  it('cancelled and expired write no purchase, and stay', async () => {
    const { checkoutId } = await data.payments.startCheckout('usr-new', 'pack-starter', '/gallery');
    expect(await data.payments.notify(checkoutId, 'cancelled')).toMatchObject({ status: 'cancelled', purchaseId: null });
    expect(await data.payments.notify(checkoutId, 'expired')).toMatchObject({ status: 'cancelled' });
    await expect(data.payments.complete(checkoutId, 'paid')).rejects.toThrow('checkout-closed');
    expect(await data.payments.purchasesFor('usr-new')).toEqual([]);
    const other = await data.payments.startCheckout('usr-new', 'pack-starter', '/gallery');
    expect(await data.payments.notify(other.checkoutId, 'expired')).toMatchObject({ status: 'expired' });
  });

  it('rates are the contract table', async () => {
    expect(await data.payments.rates()).toEqual({ perVideo: { 'no-talking': { fast: 2, best: 5 }, talking: { fast: 4, best: 8 } }, ownTemplate: 1 });
  });
});

describe('B5 / B16: refunds', () => {
  it('an unused pack bought less than 14 days ago is refundable; spent credits or age end that', async () => {
    const purchase = await starter();
    expect(purchase).toMatchObject({ status: 'paid', amount: '$19.00', refundable: { ok: true, until: new Date(START.getTime() + 14 * DAY_MS).toISOString() } });
    const purchases = Object.fromEntries((await data.payments.purchasesFor('usr-demo')).map((item) => [item.id, item.refundable]));
    expect(purchases['pur-demo-standard']).toEqual({ ok: false, reason: 'used' });
    vi.advanceTimersByTime(15 * DAY_MS);
    expect((await data.payments.purchasesFor('usr-new'))[0]?.refundable).toEqual({ ok: false, reason: 'too-old' });
  });

  it('K23: credits that came back from a stopped job leave the pack unused', async () => {
    await starter();
    await data.auth.verifyEmail('usr-new');
    const job = await startConfirmed('usr-new', input('tpl-stop', { quality: 'best' }), 'paid-job');
    expect((await data.payments.purchasesFor('usr-new'))[0]?.refundable).toEqual({ ok: false, reason: 'used' });
    vi.advanceTimersByTime(60_000);
    expect((await data.jobs.get(job.id, 'usr-new'))?.status).toBe('stopped');
    expect((await data.payments.purchasesFor('usr-new'))[0]?.refundable).toMatchObject({ ok: true });
  });

  it('request → held, cancel → free again; send → removed; failed → back; sent again → refunded', async () => {
    const purchase = await starter();
    const requested = await data.payments.requestRefund('usr-new', purchase.id);
    expect(requested).toMatchObject({ status: 'refund-requested', refundable: null, refund: { requestedAt: START.toISOString(), sentAt: null, by: { kind: 'customer' } } });
    expect(await data.ledger.balance('usr-new')).toBe(0);
    expect(await data.ledger.held('usr-new')).toBe(10);
    expect((await data.admin.overview('all')).refundRequests).toBe(1);
    await expect(startConfirmed('usr-new', input('tpl-eye', { quality: 'best' }), 'held')).rejects.toThrow(InsufficientCreditsError);
    expect(await data.payments.cancelRefund('usr-new', purchase.id)).toMatchObject({ status: 'paid', refund: null });
    expect(await data.ledger.balance('usr-new')).toBe(10);

    await data.payments.requestRefund('usr-new', purchase.id);
    await expect(data.admin.refundPurchase(ADMIN, purchase.id, ' ', 'k1')).rejects.toThrow('reason-required');
    await expect(data.admin.refundPurchase('usr-demo', purchase.id, 'ok', 'k1')).rejects.toThrow('forbidden');
    const sent = await data.admin.refundPurchase(ADMIN, purchase.id, 'Unused pack', 'k1');
    expect(sent).toMatchObject({ outcome: 'done', value: { status: 'refund-sent', refund: { by: { kind: 'admin', id: ADMIN, name: 'Admin' } } } });
    expect(await data.admin.refundPurchase(ADMIN, purchase.id, 'Unused pack', 'k2')).toMatchObject({ outcome: 'already-done', at: sent.at });
    expect((await data.ledger.entries('usr-new'))[0]).toMatchObject({
      type: 'refund', change: -10, reason: 'Unused pack', relatedPurchaseId: purchase.id, by: { kind: 'admin', name: 'Admin' },
    });
    expect([await data.ledger.balance('usr-new'), await data.ledger.held('usr-new')]).toEqual([0, 0]);

    expect(await data.payments.refundSettled(purchase.id, 'failed')).toMatchObject({ status: 'refund-failed' });
    expect((await data.ledger.entries('usr-new'))[0]).toMatchObject({ type: 'returned', change: 10, by: { kind: 'system' } });
    expect(await data.ledger.balance('usr-new')).toBe(10);
    expect(await data.admin.refundPurchase(ADMIN, purchase.id, 'Try the refund again', 'k3')).toMatchObject({ outcome: 'done', value: { status: 'refund-sent' } });
    expect(await data.payments.refundSettled(purchase.id, 'refunded')).toMatchObject({ status: 'refunded' });
    expect(await data.ledger.balance('usr-new')).toBe(0);
  });

  it('refuses a pack that is not refundable, and a refund nobody asked for', async () => {
    await expect(data.payments.requestRefund('usr-demo', 'pur-demo-standard')).rejects.toThrow('not-refundable');
    await expect(data.admin.refundPurchase(ADMIN, 'pur-demo-standard', 'x', 'k')).rejects.toThrow('not-requested');
  });
});

describe('B19 / B25: admin actions name the admin and the reason', () => {
  it('add credits, block, unblock, return credits, retry: by, reason, related id, already-done', async () => {
    expect(await data.admin.addCredits(ADMIN, 'usr-new', 3, 'Goodwill', 'a1')).toMatchObject({ by: { kind: 'admin', id: ADMIN, name: 'Admin' }, reason: 'Goodwill' });
    await expect(data.admin.setAccess(ADMIN, 'usr-demo', true, '')).rejects.toThrow('reason-required');
    await expect(data.admin.setAccess(ADMIN, ADMIN, true, 'x')).rejects.toThrow('self');
    const blocked = await data.admin.setAccess(ADMIN, 'usr-demo', true, 'Chargeback');
    expect(blocked).toMatchObject({ outcome: 'done', value: { blocked: true, block: { reason: 'Chargeback', at: START.toISOString() } } });
    expect(await data.admin.setAccess(ADMIN, 'usr-demo', true, 'Again')).toMatchObject({ outcome: 'already-done' });
    expect(await data.admin.setAccess(ADMIN, 'usr-demo', false, 'Sorted')).toMatchObject({ outcome: 'done', value: { blocked: false, block: null } });

    const returned = await data.admin.returnJobCredits(ADMIN, 'job-demo-shower', 'Came out wrong', 'r1');
    expect(returned).toMatchObject({ outcome: 'done', value: { type: 'returned', change: 5, relatedJobId: 'job-demo-shower', reason: 'Came out wrong' } });
    expect(await data.admin.returnJobCredits(ADMIN, 'job-demo-shower', 'Again', 'r2')).toMatchObject({ outcome: 'already-done' });
    expect(await data.admin.returnJobCredits(ADMIN, 'job-demo-stopped', 'x', 'r3')).toMatchObject({ outcome: 'already-done' }); // returned at the stop

    const balance = await data.ledger.balance('usr-demo');
    expect(await data.admin.retryStoppedJob(ADMIN, 'job-demo-stopped', 'Provider back')).toMatchObject({ outcome: 'done', value: { status: 'running' } });
    expect(await data.admin.retryStoppedJob(ADMIN, 'job-demo-stopped', 'Again')).toMatchObject({ outcome: 'already-done' });
    expect(await data.ledger.balance('usr-demo')).toBe(balance);
  });

  it('the daily series counts the money of the purchases of each day; the cost stays null', async () => {
    await starter();
    const days = await data.admin.dailySeries('7d');
    expect(days.at(-1)).toEqual({ date: '2026-10-04', revenueCents: 1900, generationCostCents: null });
    expect(days.every((day) => day.generationCostCents === null)).toBe(true);
  });
});

describe('B14: account access', () => {
  it('5 failed log-ins lock the email for 15 minutes', async () => {
    for (let i = 0; i < 4; i += 1) expect(await data.auth.logIn('Nobody@x.com', 'x')).toMatchObject({ reason: 'invalid' });
    expect(await data.auth.logIn('nobody@x.com', 'x')).toEqual({ ok: false, reason: 'too-many', retryAfter: 900 });
    vi.advanceTimersByTime(60_000);
    expect(await data.auth.logIn('nobody@x.com', 'x')).toEqual({ ok: false, reason: 'too-many', retryAfter: 840 });
    vi.advanceTimersByTime(15 * 60_000);
    expect(await data.auth.logIn('nobody@x.com', 'x')).toMatchObject({ reason: 'invalid' });
  });

  it('the verification link: once, for 24 hours; a resend at most every 60 seconds', async () => {
    const user = await data.auth.signUp('fresh@example.com', 'password1');
    const token = (await data.mailer.outbox())[0]?.data.token ?? '';
    expect(await data.auth.resendVerification(user.id)).toEqual({ sent: false, retryAfter: 60 });
    vi.advanceTimersByTime(60_000);
    expect(await data.auth.resendVerification(user.id)).toEqual({ sent: true, retryAfter: 60 });
    // Without the session of this account (nobody signed in, or somebody else) nothing is verified and the link stays good.
    for (const other of [null, 'usr-demo']) expect(await data.auth.confirmEmailLink(token, other)).toEqual({ ok: false, reason: 'login-required' });
    expect((await data.auth.getUser(user.id))?.emailVerified).toBe(false);
    expect(await data.auth.confirmEmailLink(token, user.id)).toMatchObject({ ok: true, purpose: 'verify', user: { emailVerified: true, freeVideoAvailable: true } });
    expect(await data.auth.confirmEmailLink(token, user.id)).toEqual({ ok: false, reason: 'used' });
    expect(await data.auth.confirmEmailLink('nope', null)).toEqual({ ok: false, reason: 'invalid' });
    const late = await data.auth.signUp('late@example.com', 'password1');
    const lateToken = (await data.mailer.outbox()).find((email) => email.data.userId === late.id)?.data.token ?? '';
    vi.advanceTimersByTime(24 * 3_600_000 + 1);
    expect(await data.auth.confirmEmailLink(lateToken, late.id)).toEqual({ ok: false, reason: 'expired' });
  });

  it('the reset link: once, for 1 hour', async () => {
    expect(await data.auth.requestPasswordReset('demo@viralclone.app')).toEqual({ sent: true, retryAfter: 60 });
    expect(await data.auth.requestPasswordReset('demo@viralclone.app')).toMatchObject({ sent: false });
    const token = (await data.mailer.outbox())[0]?.data.token ?? '';
    expect(await data.auth.checkResetLink(token)).toEqual({ ok: true, email: 'demo@viralclone.app' });
    expect(await data.auth.resetPasswordWithLink(token, 'new-password')).toEqual({ ok: true, email: 'demo@viralclone.app' });
    expect(await data.auth.resetPasswordWithLink(token, 'new-password')).toEqual({ ok: false, reason: 'used' });
    vi.advanceTimersByTime(60_000);
    await data.auth.requestPasswordReset('demo@viralclone.app');
    const second = (await data.mailer.outbox())[0]?.data.token ?? '';
    vi.advanceTimersByTime(3_600_001);
    expect(await data.auth.checkResetLink(second)).toEqual({ ok: false, reason: 'expired' });
  });

  it('Google: cancelled, failed, a new verified Google account, a blocked one', async () => {
    expect(await data.auth.signInWithGoogle({ error: 'cancelled' })).toEqual({ ok: false, reason: 'cancelled', retryAfter: null });
    expect(await data.auth.signInWithGoogle({ error: 'failed' })).toMatchObject({ reason: 'failed' });
    expect(await data.auth.signInWithGoogle({ email: 'g@example.com', name: 'G' })).toMatchObject({
      ok: true, user: { email: 'g@example.com', authProvider: 'google', emailVerified: true, freeVideoAvailable: true },
    });
    expect(await data.auth.signInWithGoogle({ email: 'blocked@example.com', name: 'B' })).toMatchObject({ ok: false, reason: 'blocked' });
  });
});

describe('B22: support', () => {
  it('one reference per form; a report only on a delivered job within 7 days', async () => {
    const first = await data.support.send({ topic: 'refund', email: 'a@x.com', message: 'Hello', key: 'form-1' });
    expect(first).toEqual({ reference: 'S-000001', duplicate: false });
    expect(await data.support.send({ topic: 'refund', email: 'a@x.com', message: 'Hello', key: 'form-1' })).toEqual({ reference: 'S-000001', duplicate: true });
    const job = await startConfirmed('usr-demo', input('tpl-eye'), 'r');
    await expect(data.support.report('usr-demo', job.id, 'other', '', 'rep-0')).rejects.toThrow('report-closed');
    vi.advanceTimersByTime(60_000);
    expect(await data.support.report('usr-demo', job.id, 'looks-different', 'The label', 'rep-1')).toMatchObject({ duplicate: false });
    vi.advanceTimersByTime(8 * DAY_MS);
    await expect(data.support.report('usr-demo', job.id, 'other', '', 'rep-2')).rejects.toThrow('report-closed');
    expect((await data.support.messages())[0]).toMatchObject({ topic: 'video', jobId: job.id, problem: 'looks-different', email: 'demo@viralclone.app' });
  });
});
