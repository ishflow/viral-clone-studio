// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

let sessionId: string | null = 'usr-admin';
vi.mock('@/core/session/session', async () => {
  const { data } = await import('@/data');
  const readUser = async () => (sessionId ? data.auth.getUser(sessionId) : null);
  return { getSessionUser: readUser, getSessionState: async () => {
    const user = await readUser();
    return user ? { kind: user.blocked ? 'blocked' : 'active', user } : { kind: 'anonymous' };
  } };
});
vi.mock('next/navigation', () => ({
  forbidden: () => { throw new Error('NEXT_FORBIDDEN'); },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

import { data } from '@/data';
import { writeEntry } from '@/data/mock/ledger';
import { getStore, resetStore } from '@/data/mock/store';
import { paymentStore } from '@/data/real/payments-store';
import { refundPurchase } from './actions';
import { loadCredits, loadRevenue } from './load';
import { parseLedgerType, parsePeriod, parseStatusMark } from './query';
import { purchasesCsv } from './csv';

const KEY = { reason: 'Within the 14 days', key: 'k-1' };
/** A fresh paid purchase the customer asked to refund (what the admin sees as "Refund requested"). */
const requested = async () => {
  const { checkoutId } = await data.payments.startCheckout('usr-demo', 'pack-starter', '/credits');
  const paid = await data.payments.complete(checkoutId, 'paid');
  await data.payments.requestRefund(paid.userId, paid.id);
  return paid;
};

beforeEach(() => {
  resetStore();
  sessionId = 'usr-admin';
  revalidatePath.mockClear();
});

describe('refundPurchase', () => {
  it('sends the refund of a requested purchase with the reason: Refund sent, the credits removed, the summary for the dialog (no refresh here)', async () => {
    const paid = await requested();
    const result = await refundPurchase({ purchaseId: paid.id, ...KEY });
    expect(result).toMatchObject({ status: 'done', detail: { amount: paid.amount, credits: paid.credits } });
    expect((await data.admin.purchases('all')).find((p) => p.id === paid.id)).toMatchObject({ status: 'refund-sent', refund: { by: { kind: 'admin', id: 'usr-admin' } } });
    const entry = (await data.ledger.entries(paid.userId)).find((e) => e.type === 'refund' && e.relatedPurchaseId === paid.id);
    expect(entry).toMatchObject({ change: -paid.credits, reason: 'Within the 14 days', by: { kind: 'admin' } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('the summary says whether the payment provider took the refund: one whose answer never came is not reported as on its way', async () => {
    const paid = await requested();
    expect(await refundPurchase({ purchaseId: paid.id, ...KEY })).toMatchObject({ status: 'done', detail: { confirmed: true } });
    // With the payment pipeline, a sent refund that has no id of the provider's is one whose call was not answered.
    vi.stubEnv('VC_PAYMENTS', 'fake');
    vi.stubEnv('VC_PAYMENTS_WEBHOOK_SECRET', 'a-made-up-secret-of-thirty-two-characters');
    const record = { checkoutId: 'c-1', sessionId: 's-1', paymentId: 'pay-1', amountMinor: 1900, currency: 'USD', status: 'paid' as const, providerStatus: 'paid' as const, expiresAt: '2026-10-08T00:00:00.000Z', key: 'k-1', purchaseId: paid.id, refundId: undefined as string | undefined };
    paymentStore().records.push(record);
    const sent = vi.spyOn(data.admin, 'refundPurchase').mockImplementation(async () => ({ outcome: 'done', at: '2026-10-07T10:00:00.000Z', value: (await data.admin.purchases('all')).find((p) => p.id === paid.id)! }));
    expect(await refundPurchase({ purchaseId: paid.id, ...KEY })).toMatchObject({ status: 'done', detail: { confirmed: false } });
    record.refundId = 'ref-1';
    expect(await refundPurchase({ purchaseId: paid.id, ...KEY })).toMatchObject({ status: 'done', detail: { confirmed: true } });
    sent.mockRestore();
    vi.unstubAllEnvs();
  });

  it('the summary names the money that went back, the total with the tax the provider added, and says "closed" only where the purchase was closed without sending money', async () => {
    const stub = () => { vi.stubEnv('VC_PAYMENTS', 'fake'); vi.stubEnv('VC_PAYMENTS_WEBHOOK_SECRET', 'a-made-up-secret-of-thirty-two-characters'); };
    const record = (n: number, purchaseId: string) => ({ checkoutId: `c-${n}`, sessionId: `s-${n}`, paymentId: `pay-${n}`, amountMinor: 1900, currency: 'USD', status: 'paid' as const, providerStatus: 'paid' as const, expiresAt: '2026-10-08T00:00:00.000Z', key: `k-${n}`, purchaseId });
    const sent = await requested(), closed = await requested();
    for (const paid of [sent, closed]) Object.assign(getStore().purchases.find((p) => p.id === paid.id)!, { taxCents: 361, totalCents: 2261 });
    writeEntry(closed.userId, 'generation', -3, 'made-up job', { from: closed.id });
    stub();
    paymentStore().records.push(record(1, sent.id), { ...record(2, closed.id), outsideRefundId: 'ref-outside' });
    expect(await refundPurchase({ purchaseId: sent.id, ...KEY })).toMatchObject({ status: 'done', detail: { amount: '$22.61', credits: 10, closed: false } });
    expect(await refundPurchase({ purchaseId: closed.id, reason: 'Refunded in the panel', key: 'k-2' })).toMatchObject({ status: 'done', detail: { amount: '$22.61', credits: 7, closed: true } });
    vi.unstubAllEnvs();
  });
  it('closing a pack none of whose credits were spent, whose whole payment the provider reported refunded, sends no money either: the summary says "closed", never that a refund is on its way', async () => {
    const paid = await requested();
    vi.stubEnv('VC_PAYMENTS', 'fake'); vi.stubEnv('VC_PAYMENTS_WEBHOOK_SECRET', 'a-made-up-secret-of-thirty-two-characters');
    paymentStore().records.push({ checkoutId: 'c-1', sessionId: 's-1', paymentId: 'pay-1', amountMinor: 1900, currency: 'USD', status: 'paid', providerStatus: 'paid', expiresAt: '2026-10-08T00:00:00.000Z', key: 'k-1', purchaseId: paid.id, outsideRefundId: 'ref-outside' });
    expect(await refundPurchase({ purchaseId: paid.id, reason: 'Refunded in the panel', key: 'k-2' })).toMatchObject({ status: 'done', detail: { credits: 10, confirmed: true, closed: true } });
    expect(getStore().purchases.find((p) => p.id === paid.id)).toMatchObject({ status: 'refunded' });
    vi.unstubAllEnvs();
  });
  it('closing a pack with spent credits whose whole payment the provider reported refunded: the summary says the credits that were left and removed, not the whole pack', async () => {
    const { checkoutId } = await data.payments.startCheckout('usr-demo', 'pack-starter', '/credits');
    const paid = await data.payments.complete(checkoutId, 'paid');
    writeEntry(paid.userId, 'generation', -3, 'made-up job', { from: paid.id });
    getStore().purchases.find((p) => p.id === paid.id)!.status = 'refund-requested';
    vi.stubEnv('VC_PAYMENTS', 'fake');
    vi.stubEnv('VC_PAYMENTS_WEBHOOK_SECRET', 'a-made-up-secret-of-thirty-two-characters');
    paymentStore().records.push({ checkoutId: 'c-1', sessionId: 's-1', paymentId: 'pay-1', amountMinor: 1900, currency: 'USD', status: 'paid', providerStatus: 'paid', expiresAt: '2026-10-08T00:00:00.000Z', key: 'k-1', purchaseId: paid.id, outsideRefundId: 'ref-outside' });
    expect(await refundPurchase({ purchaseId: paid.id, ...KEY })).toMatchObject({ status: 'done', detail: { amount: paid.amount, credits: 7 } });
    expect((await data.ledger.entries(paid.userId)).find((e) => e.type === 'refund' && e.relatedPurchaseId === paid.id)).toMatchObject({ change: -7 });
    expect((await data.admin.purchases('all')).find((p) => p.id === paid.id)!.status).toBe('refunded');
    vi.unstubAllEnvs();
  });

  it('a second send answers "already" with the day it was sent, and removes nothing twice', async () => {
    const paid = await requested();
    await refundPurchase({ purchaseId: paid.id, ...KEY });
    expect(await refundPurchase({ purchaseId: paid.id, ...KEY, reason: 'Again' })).toMatchObject({ status: 'already' });
    expect((await data.ledger.entries(paid.userId)).filter((e) => e.type === 'refund' && e.relatedPurchaseId === paid.id)).toHaveLength(1);
  });

  it('a failed refund can be tried again (credits are back in the pack)', async () => {
    const paid = await requested();
    await refundPurchase({ purchaseId: paid.id, ...KEY });
    await data.payments.refundSettled(paid.id, 'failed');
    expect((await data.admin.purchases('all')).find((p) => p.id === paid.id)?.status).toBe('refund-failed');
    expect(await refundPurchase({ purchaseId: paid.id, reason: 'Retry', key: 'k-2' })).toMatchObject({ status: 'done' });
    expect((await data.admin.purchases('all')).find((p) => p.id === paid.id)?.status).toBe('refund-sent');
  });

  it('a refund the payment provider refused is told apart from one that did not go through: the admin must not be told that nothing changed', async () => {
    const paid = await requested();
    const refused = vi.spyOn(data.admin, 'refundPurchase').mockRejectedValueOnce(new Error('refund-refused')).mockRejectedValueOnce(new Error('refund-refused: with more words')).mockRejectedValueOnce(new Error('made-up failure'));
    expect(await refundPurchase({ purchaseId: paid.id, ...KEY })).toEqual({ status: 'refused' });
    expect(await refundPurchase({ purchaseId: paid.id, ...KEY })).toEqual({ status: 'failed' });
    expect(await refundPurchase({ purchaseId: paid.id, ...KEY })).toEqual({ status: 'failed' });
    refused.mockRestore();
  });

  it('a refund the payment provider refused because its balance cannot cover it is told with that reason; any other refusal, and one without the payment pipeline, names none', async () => {
    const paid = await requested();
    const refused = vi.spyOn(data.admin, 'refundPurchase').mockRejectedValue(new Error('refund-refused'));
    // What the gate leaves behind when the provider's wallet could not cover the refund: a failed refund with that note.
    getStore().purchases.find((p) => p.id === paid.id)!.status = 'refund-failed';
    const record = { checkoutId: 'c-1', sessionId: 's-1', paymentId: 'pay-1', amountMinor: 1900, currency: 'USD', status: 'paid' as const, providerStatus: 'paid' as const, expiresAt: '2026-10-08T00:00:00.000Z', key: 'k-1', purchaseId: paid.id, refundNote: 'no-funds' as 'no-funds' | 'not-found' };
    paymentStore().records.push(record);
    expect(await refundPurchase({ purchaseId: paid.id, ...KEY })).toEqual({ status: 'refused' });
    vi.stubEnv('VC_PAYMENTS', 'fake');
    vi.stubEnv('VC_PAYMENTS_WEBHOOK_SECRET', 'a-made-up-secret-of-thirty-two-characters');
    expect(await refundPurchase({ purchaseId: paid.id, ...KEY })).toEqual({ status: 'refused', why: 'no-funds' });
    record.refundNote = 'not-found';
    expect(await refundPurchase({ purchaseId: paid.id, ...KEY })).toStrictEqual({ status: 'refused' });
    refused.mockRestore();
    vi.unstubAllEnvs();
  });

  it('a reason is required; a purchase nobody asked to refund, an unpaid one or an unknown one fail and change nothing', async () => {
    const paid = await requested();
    expect(await refundPurchase({ purchaseId: paid.id, reason: '  ', key: 'k-1' })).toEqual({ status: 'failed' });
    expect((await data.admin.purchases('all')).find((p) => p.id === paid.id)?.status).toBe('refund-requested');
    const open = (await data.admin.purchases('all')).find((p) => p.status === 'not-completed')!;
    const never = (await data.admin.purchases('all')).find((p) => p.status === 'paid')!;
    for (const id of [open.id, never.id, 'nope']) expect(await refundPurchase({ purchaseId: id, ...KEY })).toEqual({ status: 'failed' });
    expect((await data.admin.purchases('all')).find((p) => p.id === open.id)?.status).toBe('not-completed');
  });

  it('a customer or a visitor gets the 404 and nothing is refunded', async () => {
    const paid = await requested();
    sessionId = 'usr-demo';
    await expect(refundPurchase({ purchaseId: paid.id, ...KEY })).rejects.toThrow('NEXT_FORBIDDEN');
    sessionId = null;
    await expect(refundPurchase({ purchaseId: paid.id, ...KEY })).rejects.toThrow('NEXT_FORBIDDEN');
    expect((await data.admin.purchases('all')).find((p) => p.id === paid.id)?.status).toBe('refund-requested');
  });
});

describe('query parsing', () => {
  it('period falls back to 30 days, type and mark only accept known values', () => {
    expect(parsePeriod('7d')).toBe('7d');
    expect(parsePeriod('zzz')).toBe('30d');
    expect(parseLedgerType('refund')).toBe('refund');
    expect(parseLedgerType('zzz')).toBeUndefined();
    expect(parseStatusMark('not-completed')).toBe('not-completed');
    expect(parseStatusMark('refund-requested')).toBe('refund-requested');
    expect(parseStatusMark('paid')).toBeNull();
  });
});

describe('loaders', () => {
  it('refuse a customer before reading anything', async () => {
    sessionId = 'usr-demo';
    await expect(loadRevenue({})).rejects.toThrow('NEXT_FORBIDDEN');
    await expect(loadCredits({})).rejects.toThrow('NEXT_FORBIDDEN');
  });

  it('revenue: counts paid purchases, joins emails and invoice numbers', async () => {
    const r = await loadRevenue({ period: 'all' });
    const paid = (await data.admin.purchases('all')).filter((p) => p.status === 'paid');
    expect(r.tiles.purchases).toBe(paid.length);
    expect(r.tiles.revenue).toBe('$242.00');
    expect(r.tiles.average).toMatch(/^\$\d+\.\d{2}$/);
    expect(r.packs.map((p) => p.share)).toEqual(['8%', '22%', '70%']);
    expect(r.purchases.every((p) => p.email?.includes('@'))).toBe(true);
    expect(r.purchases.some((p) => p.status === 'paid' && p.invoiceNumber)).toBe(true);
    expect(r.packs.map((p) => p.name)).toEqual(['Starter', 'Standard', 'Studio']);
  });

  it('a deleted account has no email (null), never its raw id; the export leaves the cell empty', async () => {
    await data.auth.deleteAccount('usr-paying');
    const r = await loadRevenue({ period: 'all' });
    const gone = r.purchases.filter((p) => p.userId === 'usr-paying');
    expect(gone.length).toBeGreaterThan(0);
    expect(gone.every((p) => p.email === null)).toBe(true);
    expect(r.purchases.filter((p) => p.userId !== 'usr-paying').every((p) => p.email?.includes('@'))).toBe(true);
    const c = await loadCredits({ period: 'all' });
    expect(c.ledger.filter((e) => e.userId === 'usr-paying').map((e) => e.email)).toContain(null);
    expect(c.ledger.some((e) => e.email === 'usr-paying')).toBe(false);
    expect(purchasesCsv(gone)).not.toContain('usr-paying');
  });

  it('credits: the ledger follows the type filter', async () => {
    const c = await loadCredits({ period: 'all', type: 'admin' });
    expect(c.ledger.every((e) => e.type === 'admin')).toBe(true);
    const all = await loadCredits({ period: 'all' });
    expect(all.ledger.length).toBeGreaterThan(c.ledger.length);
    expect(all.spending.byQuality.map((r) => r.label)).toEqual(['fast', 'best']);
  });
});

describe('purchasesCsv', () => {
  it('has date, email, pack, credits, status, invoice and no money column', async () => {
    const r = await loadRevenue({ period: 'all' });
    const lines = purchasesCsv(r.purchases).trim().split('\r\n');
    expect(lines[0]).toBe('date,email,pack,credits,status,invoice');
    expect(lines).toHaveLength(r.purchases.length + 1);
  });
});
