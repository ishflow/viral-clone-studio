// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/core/session/session', async () => {
  const { data } = await import('@/data');
  const readUser = async () => data.auth.getUser('usr-admin');
  return { getSessionUser: readUser, getSessionState: async () => ({ kind: 'active', user: await readUser() }) };
});
vi.mock('next/navigation', () => ({
  forbidden: () => { throw new Error('NEXT_FORBIDDEN'); },
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));

import { data } from '@/data';
import { writeEntry } from '@/data/mock/ledger';
import { getStore, resetStore } from '@/data/mock/store';
import { paymentStore } from '@/data/real/payments-store';
import { loadCredits, loadRevenue } from './load';

beforeEach(() => resetStore());
afterEach(() => vi.unstubAllEnvs());

describe('loadRevenue', () => {
  it('a purchase the provider added tax to carries its tax and its total, and the revenue, the average and the refunds still count the pack price only', async () => {
    const before = await loadRevenue({ period: 'all' });
    const { checkoutId } = await data.payments.startCheckout('usr-demo', 'pack-starter', '/credits');
    const paid = await data.payments.complete(checkoutId, 'paid');
    const plain = await loadRevenue({ period: 'all' });
    expect(plain.purchases.find((p) => p.id === paid.id)).toMatchObject({ amount: '$19.00', tax: null, total: null });
    expect(plain.purchases.find((p) => p.id === paid.id)!.invoiceUrl).toBeNull();
    Object.assign(getStore().purchases.find((p) => p.id === paid.id)!, { taxCents: 361, totalCents: 2261, invoiceUrl: 'https://test.dodopayments.com/invoices/payments/pay_A' });
    const taxed = await loadRevenue({ period: 'all' });
    expect(taxed.purchases.find((p) => p.id === paid.id)).toMatchObject({ amount: '$19.00', tax: '$3.61', total: '$22.61', invoiceUrl: 'https://test.dodopayments.com/invoices/payments/pay_A' });
    expect(taxed.tiles).toEqual(plain.tiles);
    expect(taxed.packs).toEqual(plain.packs);
    expect(plain.tiles.revenue).not.toBe(before.tiles.revenue);
  });
  it('a purchase carries what is left of its pack: all of it while nothing was spent, less once credits of it were', async () => {
    const { checkoutId } = await data.payments.startCheckout('usr-demo', 'pack-starter', '/credits');
    const paid = await data.payments.complete(checkoutId, 'paid');
    expect((await loadRevenue({ period: 'all' })).purchases.find((p) => p.id === paid.id)).toMatchObject({ credits: 10, creditsLeft: 10 });
    writeEntry(paid.userId, 'generation', -3, 'made-up job', { from: paid.id });
    expect((await loadRevenue({ period: 'all' })).purchases.find((p) => p.id === paid.id)).toMatchObject({ credits: 10, creditsLeft: 7 });
  });
  it('a refund that was sent counts in the refunds tile at once', async () => {
    expect((await loadRevenue({ period: 'all' })).tiles.refunds).toBe('$19');
    const { checkoutId } = await data.payments.startCheckout('usr-demo', 'pack-starter', '/credits');
    const paid = await data.payments.complete(checkoutId, 'paid');
    await data.payments.requestRefund(paid.userId, paid.id);
    const sent = await data.admin.refundPurchase('usr-admin', paid.id, 'Within the 14 days', 'k-1');
    expect(sent.value.status).toBe('refund-sent');

    expect((await loadRevenue({ period: 'all' })).tiles.refunds).toBe('$38');
  });
  it('a refund of a Dodo payment counts in the refunds tile only once it is "refunded", and with all that went back, the tax included; while it is only sent it stands beside the tile as awaited, and one that failed counts nowhere', async () => {
    const before = (await loadRevenue({ period: 'all' })).tiles;
    expect(before).toMatchObject({ refunds: '$19', refundsPending: null });
    const { checkoutId } = await data.payments.startCheckout('usr-demo', 'pack-starter', '/credits');
    const paid = await data.payments.complete(checkoutId, 'paid');
    const purchase = getStore().purchases.find((p) => p.id === paid.id)!;
    Object.assign(purchase, { taxCents: 361, totalCents: 2261, status: 'refund-sent' });
    vi.stubEnv('VC_PAYMENTS', 'fake');
    vi.stubEnv('VC_PAYMENTS_WEBHOOK_SECRET', 'a-made-up-secret-of-thirty-two-characters');
    paymentStore().records.push({ checkoutId: 'c-1', sessionId: 's-1', paymentId: 'pay-1', amountMinor: 1900, currency: 'USD', status: 'paid', providerStatus: 'paid', expiresAt: '2026-10-08T00:00:00.000Z', key: 'k-1', purchaseId: paid.id, provider: 'dodo' });
    expect((await loadRevenue({ period: 'all' })).tiles).toMatchObject({ refunds: '$19', refundsPending: '$22.61' });
    purchase.status = 'refund-failed';
    expect((await loadRevenue({ period: 'all' })).tiles).toMatchObject({ refunds: '$19', refundsPending: null });
    purchase.status = 'refunded';
    expect((await loadRevenue({ period: 'all' })).tiles).toMatchObject({ refunds: '$41.61', refundsPending: null });
    // A payment the offline provider took has no notice that settles its refund by itself: it counts when it is sent, as before.
    delete paymentStore().records[0]!.provider;
    purchase.status = 'refund-sent';
    expect((await loadRevenue({ period: 'all' })).tiles).toMatchObject({ refunds: '$38', refundsPending: null });
  });
  it('the purchases tile counts the purchases the revenue and the average are made of: one with a refund requested counts, a refund-sent one does not', async () => {
    const before = await loadRevenue({ period: 'all' });
    const { checkoutId } = await data.payments.startCheckout('usr-demo', 'pack-starter', '/credits');
    const paid = await data.payments.complete(checkoutId, 'paid');
    expect((await loadRevenue({ period: 'all' })).tiles.purchases).toBe(before.tiles.purchases + 1);

    await data.payments.requestRefund(paid.userId, paid.id);
    const asked = await loadRevenue({ period: 'all' });
    expect(asked.tiles.purchases).toBe(before.tiles.purchases + 1);

    await data.admin.refundPurchase('usr-admin', paid.id, 'Within the 14 days', 'k-1');
    expect((await loadRevenue({ period: 'all' })).tiles.purchases).toBe(before.tiles.purchases);
  });
  it('a purchase the payment gate marked for the owner carries its mark; without the signed payment pipeline nothing is marked', async () => {
    expect((await loadRevenue({ period: 'all' })).purchases.every((p) => p.review === null)).toBe(true);
    vi.stubEnv('VC_PAYMENTS', 'fake');
    vi.stubEnv('VC_PAYMENTS_WEBHOOK_SECRET', 'a-made-up-secret-of-thirty-two-characters');
    const [marked, plain] = getStore().purchases;
    paymentStore().records.push(
      { checkoutId: 'c-1', sessionId: 's-1', paymentId: 'pay-1', amountMinor: 1900, currency: 'USD', status: 'paid', providerStatus: 'paid', expiresAt: '2026-10-08T00:00:00.000Z', key: 'k-1', purchaseId: marked!.id, flag: 'refund-review' },
      { checkoutId: 'c-2', sessionId: 's-2', paymentId: 'pay-2', amountMinor: 1900, currency: 'USD', status: 'paid', providerStatus: 'paid', expiresAt: '2026-10-08T00:00:00.000Z', key: 'k-2', purchaseId: plain!.id },
    );
    const rows = (await loadRevenue({ period: 'all' })).purchases;
    expect(rows.find((p) => p.id === marked!.id)!.review).toBe('refund-review');
    expect(rows.filter((p) => p.review !== null)).toHaveLength(1);
  });
  it('a purchase a part of whose money went back at the provider carries that amount, for the owner to decide on; one whose whole payment went back, or none of it, carries none', async () => {
    vi.stubEnv('VC_PAYMENTS', 'fake');
    vi.stubEnv('VC_PAYMENTS_WEBHOOK_SECRET', 'a-made-up-secret-of-thirty-two-characters');
    const [part, whole, plain] = getStore().purchases;
    const record = (n: number, purchaseId: string) => ({ checkoutId: `c-${n}`, sessionId: `s-${n}`, paymentId: `pay-${n}`, amountMinor: 1900, currency: 'USD', status: 'paid' as const, providerStatus: 'paid' as const, expiresAt: '2026-10-08T00:00:00.000Z', key: `k-${n}`, purchaseId });
    paymentStore().records.push(
      { ...record(1, part!.id), flag: 'refund-review', outsideRefunds: [{ id: 'ref-a', amountMinor: 100 }, { id: 'ref-b', amountMinor: 250 }] },
      { ...record(2, whole!.id), flag: 'refund-review', outsideRefundId: 'ref-c', outsideRefunds: [{ id: 'ref-c', amountMinor: 2261 }] },
      record(3, plain!.id),
    );
    const rows = (await loadRevenue({ period: 'all' })).purchases;
    expect(rows.find((p) => p.id === part!.id)).toMatchObject({ review: 'refund-review', partRefund: '$3.50' });
    expect(rows.find((p) => p.id === whole!.id)).toMatchObject({ review: 'refund-outside', partRefund: null });
    expect(rows.find((p) => p.id === plain!.id)).toMatchObject({ review: null, partRefund: null });
  });
  it('a purchase with a refund at the provider whose amount is not known says so on its row, beside the parts that are known; one whose whole payment went back, or whose parts are all known, does not', async () => {
    vi.stubEnv('VC_PAYMENTS', 'fake');
    vi.stubEnv('VC_PAYMENTS_WEBHOOK_SECRET', 'a-made-up-secret-of-thirty-two-characters');
    const [unknown, whole, part] = getStore().purchases;
    const record = (n: number, purchaseId: string) => ({ checkoutId: `c-${n}`, sessionId: `s-${n}`, paymentId: `pay-${n}`, amountMinor: 1900, currency: 'USD', status: 'paid' as const, providerStatus: 'paid' as const, expiresAt: '2026-10-08T00:00:00.000Z', key: `k-${n}`, purchaseId });
    paymentStore().records.push(
      { ...record(1, unknown!.id), flag: 'refund-review', outsideRefunds: [{ id: 'ref-a', amountMinor: 100 }, { id: 'ref-b', amountMinor: null }] },
      { ...record(2, whole!.id), flag: 'refund-review', outsideRefundId: 'ref-c', outsideRefunds: [{ id: 'ref-b', amountMinor: null }, { id: 'ref-c', amountMinor: 2261 }] },
      { ...record(3, part!.id), flag: 'refund-review', outsideRefunds: [{ id: 'ref-d', amountMinor: 100 }] },
    );
    const rows = (await loadRevenue({ period: 'all' })).purchases;
    expect(rows.find((p) => p.id === unknown!.id)).toMatchObject({ review: 'refund-review', refundAmountUnknown: true, partRefund: '$1.00' });
    expect(rows.find((p) => p.id === whole!.id)).toMatchObject({ review: 'refund-outside', refundAmountUnknown: false, partRefund: null });
    expect(rows.find((p) => p.id === part!.id)).toMatchObject({ review: 'refund-review', refundAmountUnknown: false, partRefund: '$1.00' });
  });
  it('a payment the gate did not credit is on the page with its buyer, or as a deleted account, whatever the period; without the signed payment pipeline there is none', async () => {
    const record = (checkoutId: string, refusal: 'amount' | 'no-account') => ({ checkoutId, sessionId: `s-${checkoutId}`, paymentId: '', amountMinor: 1900, currency: 'USD', status: 'pending' as const, providerStatus: 'open' as const, expiresAt: '2026-10-08T00:00:00.000Z', key: checkoutId, purchaseId: null, flag: 'payment-review', refusal });
    const checkout = (id: string, userId: string, startedAt: string) => ({ id, userId, packId: 'pack-starter', returnTo: '/credits', purchaseId: null, state: 'pending' as const, startedAt, pendingSince: startedAt, reference: '' });
    getStore().checkouts.push(checkout('c-short', 'usr-demo', '2025-01-02T03:04:05.000Z'), checkout('c-gone', 'usr-gone', '2025-01-03T03:04:05.000Z'));
    paymentStore().records.push(record('c-short', 'amount'), record('c-gone', 'no-account'));
    expect((await loadRevenue({ period: 'all' })).uncredited).toEqual([]);
    vi.stubEnv('VC_PAYMENTS', 'fake');
    vi.stubEnv('VC_PAYMENTS_WEBHOOK_SECRET', 'a-made-up-secret-of-thirty-two-characters');
    expect((await loadRevenue({ period: '7d' })).uncredited).toEqual([
      { id: 'c-short', at: '2025-01-02T03:04:05.000Z', userId: 'usr-demo', email: 'demo@viralclone.app', packName: 'Starter', amount: '$19.00', reason: 'amount' },
      { id: 'c-gone', at: '2025-01-03T03:04:05.000Z', userId: 'usr-gone', email: null, packName: 'Starter', amount: '$19.00', reason: 'no-account' },
    ]);
  });
});

describe('loadCredits', () => {
  it('a purchase of the ledger carries the provider\'s own invoice address where the payment has one, and none otherwise', async () => {
    const [first, second] = getStore().purchases.filter((p) => p.invoiceId);
    first!.invoiceUrl = 'https://test.dodopayments.com/invoices/payments/pay_A';
    const { purchases } = await loadCredits({ period: 'all' });
    expect(purchases[first!.id]).toMatchObject({ invoiceId: first!.invoiceId, invoiceUrl: 'https://test.dodopayments.com/invoices/payments/pay_A' });
    expect(purchases[second!.id]!.invoiceUrl).toBeNull();
  });
});
