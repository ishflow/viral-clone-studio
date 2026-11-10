// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '../index';
import { NotFoundError } from '../ports';
import { getStore, resetStore } from './store';

const paymentEmails = async () => (await data.mailer.outbox()).filter((email) => email.kind === 'payment');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
  resetStore();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('fake payment gateway', () => {
  it('offers the three demo packs without a price', async () => {
    expect(await data.payments.packs()).toEqual([
      { id: 'pack-starter', name: 'Starter', credits: 10, price: '$19', priceCents: 1900 },
      { id: 'pack-standard', name: 'Standard', credits: 30, price: '$54', priceCents: 5400 },
      { id: 'pack-studio', name: 'Studio', credits: 100, price: '$169', priceCents: 16900 },
    ]);
  });

  it('startCheckout spends nothing and gives the address of the mock provider page, with the way back', async () => {
    const { checkoutId, url } = await data.payments.startCheckout('usr-demo', 'pack-starter', '/templates/tpl-layering/generate?confirm=1');
    expect(url).toBe(`/checkout/mock/${checkoutId}?returnTo=%2Ftemplates%2Ftpl-layering%2Fgenerate%3Fconfirm%3D1`);
    expect(await data.ledger.balance('usr-demo')).toBe(19);
    expect(await data.payments.purchasesFor('usr-demo')).toHaveLength(1);
  });

  it('complete(id, \'paid\') adds the pack\'s credits, creates one invoice and one payment email', async () => {
    const { checkoutId } = await data.payments.startCheckout('usr-demo', 'pack-starter', '/gallery');
    const purchase = await data.payments.complete(checkoutId, 'paid');

    expect(purchase).toMatchObject({
      userId: 'usr-demo', packId: 'pack-starter', packName: 'Starter', credits: 10, amount: '$19.00', amountCents: 1900,
      status: 'paid', at: '2026-10-04T12:00:00.000Z',
    });
    expect(await data.ledger.balance('usr-demo')).toBe(29);
    expect((await data.ledger.entries('usr-demo'))[0]).toMatchObject({ type: 'purchase', change: 10, note: 'Starter', balanceAfter: 29, by: { kind: 'customer' }, relatedPurchaseId: purchase.id });

    const invoices = await data.invoices.listFor('usr-demo');
    expect(invoices).toHaveLength(2);
    expect(invoices[0]).toMatchObject({ id: purchase.invoiceId, userId: 'usr-demo', purchaseId: purchase.id, packName: 'Starter', credits: 10, amount: '$19.00' });
    expect(new Set(getStore().invoices.map((invoice) => invoice.number)).size).toBe(getStore().invoices.length);

    expect(await paymentEmails()).toMatchObject([
      { to: 'demo@viralclone.app', data: { purchaseId: purchase.id, invoiceId: purchase.invoiceId, packName: 'Starter', credits: '10', balance: '29', returnTo: '/gallery' } },
    ]);
  });

  it('calling it twice changes nothing more', async () => {
    const { checkoutId } = await data.payments.startCheckout('usr-demo', 'pack-starter', '/gallery');
    const first = await data.payments.complete(checkoutId, 'paid');
    const ledgerAfterFirst = getStore().ledger.length;
    vi.advanceTimersByTime(5_000);
    const second = await data.payments.complete(checkoutId, 'paid');
    const third = await data.payments.complete(checkoutId, 'declined');

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(getStore().ledger).toHaveLength(ledgerAfterFirst);
    expect(await data.ledger.balance('usr-demo')).toBe(29);
    expect(await data.invoices.listFor('usr-demo')).toHaveLength(2);
    expect(await data.payments.purchasesFor('usr-demo')).toHaveLength(2);
    expect(await paymentEmails()).toHaveLength(1);
  });

  it('two completions at the same moment add the credits once', async () => {
    const { checkoutId } = await data.payments.startCheckout('usr-demo', 'pack-studio', '/gallery');
    const [first, second] = await Promise.all([data.payments.complete(checkoutId, 'paid'), data.payments.complete(checkoutId, 'paid')]);
    expect(second.id).toBe(first.id);
    expect(await data.ledger.balance('usr-demo')).toBe(119);
  });

  it('\'declined\' creates a not-completed purchase and no credits', async () => {
    const ledgerBefore = getStore().ledger.length;
    const { checkoutId } = await data.payments.startCheckout('usr-demo', 'pack-standard', '/gallery');
    const purchase = await data.payments.complete(checkoutId, 'declined');

    expect(purchase).toMatchObject({ userId: 'usr-demo', packId: 'pack-standard', credits: 30, amount: '$54.00', status: 'not-completed', invoiceId: null });
    expect(await data.ledger.balance('usr-demo')).toBe(19);
    expect(getStore().ledger).toHaveLength(ledgerBefore);
    expect(await data.invoices.listFor('usr-demo')).toHaveLength(1);
    expect(await paymentEmails()).toEqual([]);
  });

  it('a declined checkout cannot be paid afterwards; trying again needs a new checkout', async () => {
    const { checkoutId } = await data.payments.startCheckout('usr-demo', 'pack-standard', '/gallery');
    await data.payments.complete(checkoutId, 'declined');
    expect((await data.payments.complete(checkoutId, 'paid')).status).toBe('not-completed');
    expect(await data.ledger.balance('usr-demo')).toBe(19);

    const again = await data.payments.startCheckout('usr-demo', 'pack-standard', '/gallery');
    expect(again.checkoutId).not.toBe(checkoutId);
    expect((await data.payments.complete(again.checkoutId, 'paid')).status).toBe('paid');
    expect(await data.ledger.balance('usr-demo')).toBe(49);
  });

  it('getCheckout gives the owner an open checkout, with the pack and the way back', async () => {
    const { checkoutId } = await data.payments.startCheckout('usr-demo', 'pack-starter', '/templates/tpl-layering/generate?confirm=1');
    expect(await data.payments.getCheckout(checkoutId, 'usr-demo')).toEqual({
      id: checkoutId, userId: 'usr-demo', pack: { id: 'pack-starter', name: 'Starter', credits: 10, price: '$19', priceCents: 1900 },
      returnTo: '/templates/tpl-layering/generate?confirm=1', status: 'open', purchaseId: null,
      startedAt: '2026-10-04T12:00:00.000Z', reference: `PAY-${checkoutId.slice(0, 8).toUpperCase()}`, delayed: false,
    });
    expect(await data.ledger.balance('usr-demo')).toBe(19);
  });

  it('getCheckout of another user\'s checkout is null, also for an admin', async () => {
    const { checkoutId } = await data.payments.startCheckout('usr-demo', 'pack-starter', '/gallery');
    expect(await data.payments.getCheckout(checkoutId, 'usr-paying')).toBeNull();
    expect(await data.payments.getCheckout(checkoutId, 'usr-admin')).toBeNull();
    expect(await data.payments.getCheckout(checkoutId, 'nobody')).toBeNull();
  });

  it('getCheckout of an unknown id is null', async () => {
    expect(await data.payments.getCheckout('checkout-missing', 'usr-demo')).toBeNull();
  });

  it('after complete(id, \'paid\') the checkout is paid and points at the purchase', async () => {
    const { checkoutId } = await data.payments.startCheckout('usr-demo', 'pack-standard', '/gallery');
    const purchase = await data.payments.complete(checkoutId, 'paid');
    expect(await data.payments.getCheckout(checkoutId, 'usr-demo')).toMatchObject({ status: 'paid', purchaseId: purchase.id, returnTo: '/gallery' });
    await data.admin.refund(purchase.id);
    expect((await data.payments.getCheckout(checkoutId, 'usr-demo'))?.status).toBe('paid');
  });

  it('after complete(id, \'declined\') the checkout is declined', async () => {
    const { checkoutId } = await data.payments.startCheckout('usr-demo', 'pack-standard', '/gallery');
    const purchase = await data.payments.complete(checkoutId, 'declined');
    expect(await data.payments.getCheckout(checkoutId, 'usr-demo')).toMatchObject({ status: 'declined', purchaseId: purchase.id });
    await data.payments.complete(checkoutId, 'paid');
    expect((await data.payments.getCheckout(checkoutId, 'usr-demo'))?.status).toBe('declined');
  });

  it('getCheckout hands out a copy and keeps the record of the store to itself', async () => {
    const { checkoutId } = await data.payments.startCheckout('usr-demo', 'pack-starter', '/gallery');
    const checkout = await data.payments.getCheckout(checkoutId, 'usr-demo');
    expect(Object.keys(checkout ?? {}).sort()).toEqual(['delayed', 'id', 'pack', 'purchaseId', 'reference', 'returnTo', 'startedAt', 'status', 'userId']);
    if (checkout) {
      checkout.userId = 'usr-paying';
      checkout.pack.credits = 1000;
    }
    expect((await data.payments.getCheckout(checkoutId, 'usr-demo'))?.pack.credits).toBe(10);
    expect(await data.payments.getCheckout(checkoutId, 'usr-paying')).toBeNull();
    expect((await data.payments.packs())[0]?.credits).toBe(10);
  });

  it('throws NotFoundError for an unknown user, pack or checkout', async () => {
    await expect(data.payments.startCheckout('nobody', 'pack-starter', '/gallery')).rejects.toThrow(NotFoundError);
    await expect(data.payments.startCheckout('usr-demo', 'pack-missing', '/gallery')).rejects.toThrow(NotFoundError);
    await expect(data.payments.complete('checkout-missing', 'paid')).rejects.toThrow(NotFoundError);
  });

  it('does not add credits to an account that was deleted before the payment came back', async () => {
    const ledgerBefore = getStore().ledger.length;
    const { checkoutId } = await data.payments.startCheckout('usr-free', 'pack-starter', '/gallery');
    await data.auth.deleteAccount('usr-free');
    await expect(data.payments.complete(checkoutId, 'paid')).rejects.toThrow(NotFoundError);
    expect(getStore().ledger).toHaveLength(ledgerBefore);
  });

  it('purchasesFor returns only that user\'s purchases, newest first', async () => {
    const purchases = await data.payments.purchasesFor('usr-paying');
    expect(purchases.every((purchase) => purchase.userId === 'usr-paying')).toBe(true);
    expect(purchases.map((purchase) => purchase.status)).toEqual(['not-completed', 'paid', 'refunded']);
    expect(await data.payments.purchasesFor('usr-new')).toEqual([]);
  });

  it('the fixtures hold a paid, a not-completed and a refunded purchase; only not-completed ones have no invoice', () => {
    const { purchases, invoices } = getStore();
    expect(new Set(purchases.map((purchase) => purchase.status))).toEqual(new Set(['paid', 'not-completed', 'refunded']));
    for (const purchase of purchases) {
      const invoice = invoices.find((item) => item.id === purchase.invoiceId);
      expect(Boolean(invoice)).toBe(purchase.status !== 'not-completed');
      if (invoice) expect(invoice).toMatchObject({ userId: purchase.userId, purchaseId: purchase.id, credits: purchase.credits });
    }
  });
});
