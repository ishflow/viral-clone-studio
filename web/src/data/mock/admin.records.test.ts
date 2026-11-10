// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '../index';
import { NotFoundError } from '../ports';
import { writeEntry } from './ledger';
import { getStore, resetStore } from './store';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
  resetStore();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('purchases', () => {
  it('purchases(period) returns everyone\'s purchases, newest first', async () => {
    expect((await data.admin.purchases('all')).map((purchase) => purchase.id)).toEqual([
      'pur-paying-standard', 'pur-demo-standard', 'pur-blocked-starter', 'pur-paying-studio', 'pur-paying-starter',
    ]);
    expect((await data.admin.purchases('7d')).map((purchase) => purchase.id)).toEqual(['pur-paying-standard']);
    expect(await data.admin.purchases('today')).toEqual([]);
  });

  it('packSales counts the paid purchases of every pack, with the money of its sold purchases', async () => {
    const sales = await data.admin.packSales('all');
    expect(sales.map((row) => [row.pack.name, row.pack.price, row.sold, row.revenue])).toEqual([
      ['Starter', '$19', 1, '$19.00'], ['Standard', '$54', 1, '$54.00'], ['Studio', '$169', 1, '$169.00'],
    ]);
    expect((await data.admin.packSales('7d')).map((row) => row.sold)).toEqual([0, 0, 0]);
  });
});

describe('refund', () => {
  it('refund marks the purchase refunded and writes a negative refund entry', async () => {
    const { checkoutId } = await data.payments.startCheckout('usr-demo', 'pack-starter', '/gallery');
    const purchase = await data.payments.complete(checkoutId, 'paid');
    expect(await data.ledger.balance('usr-demo')).toBe(29);

    const refunded = await data.admin.refund(purchase.id);
    expect(refunded).toMatchObject({ id: purchase.id, status: 'refunded', invoiceId: purchase.invoiceId });
    expect((await data.ledger.entries('usr-demo'))[0]).toMatchObject({ type: 'refund', change: -10, note: 'Starter', balanceAfter: 19 });
    expect((await data.payments.purchasesFor('usr-demo'))[0]?.status).toBe('refunded');
  });

  it('refund twice writes one entry', async () => {
    const before = getStore().ledger.length;
    await data.admin.refund('pur-blocked-starter');
    await data.admin.refund('pur-blocked-starter');
    expect(getStore().ledger).toHaveLength(before + 1);
  });

  it('refund never takes a balance below zero: it removes what is left of the pack', async () => {
    await data.admin.refund('pur-demo-standard');
    expect((await data.ledger.entries('usr-demo'))[0]).toMatchObject({ type: 'refund', change: -19, balanceAfter: 0 });
    expect(await data.ledger.balance('usr-demo')).toBe(0);
  });

  it('refund with a balance of 0 marks the purchase refunded and writes no entry', async () => {
    writeEntry('usr-demo', 'generation', -19, 'Spend all');
    expect(await data.ledger.balance('usr-demo')).toBe(0);
    const before = getStore().ledger.length;

    expect((await data.admin.refund('pur-demo-standard')).status).toBe('refunded');
    expect(getStore().ledger).toHaveLength(before);
    expect(await data.ledger.balance('usr-demo')).toBe(0);
  });

  it('refund of a purchase that was never paid throws; an unknown purchase is not found', async () => {
    const before = getStore().ledger.length;
    await expect(data.admin.refund('pur-paying-standard')).rejects.toThrow('not-paid');
    await expect(data.admin.refund('pur-missing')).rejects.toThrow(NotFoundError);
    expect(getStore().ledger).toHaveLength(before);
  });
});

describe('credits', () => {
  it('ledger returns everyone\'s entries, newest first, by type and period', async () => {
    const all = await data.admin.ledger({ period: 'all' });
    expect(all).toHaveLength(17);
    expect(all.map((entry) => entry.at)).toEqual(all.map((entry) => entry.at).sort().reverse());
    expect((await data.admin.ledger({ type: 'refund', period: 'all' })).map((entry) => [entry.userId, entry.change])).toEqual([['usr-paying', -10]]);
    expect(await data.admin.ledger({ type: 'admin', period: 'all' })).toHaveLength(1);
    expect((await data.admin.ledger({ period: '7d' })).map((entry) => entry.change)).toEqual([-2, 5, -5, -15, 0, -4]);
    expect(await data.admin.ledger({ type: 'purchase', period: '7d' })).toEqual([]);
  });

  it('the note of an entry is data, never a sentence of ours: template title, pack name or the admin\'s reason', async () => {
    const titles = getStore().templates.map((template) => template.title);
    const packs = (await data.payments.packs()).map((pack) => pack.name);
    for (const entry of await data.admin.ledger({ period: 'all' })) {
      if (entry.type === 'generation' || entry.type === 'free-video') expect(titles).toContain(entry.note);
      if (entry.type === 'purchase' || entry.type === 'refund') expect(packs).toContain(entry.note);
    }
    expect((await data.admin.ledger({ type: 'admin', period: 'all' }))[0]?.note).toBe('Credits back for a video that came out wrong');
  });

  it('spending splits the jobs and their credits by quality and by format', async () => {
    expect(await data.admin.spending('all')).toEqual({
      byQuality: [
        { label: 'fast', jobs: 6, credits: 10, cost: null },
        { label: 'best', jobs: 4, credits: 33, cost: null },
      ],
      byFormat: [
        { label: 'no-talking', jobs: 8, credits: 31, cost: null },
        { label: 'talking', jobs: 2, credits: 12, cost: null },
      ],
    });
    expect((await data.admin.spending('today')).byQuality).toEqual([
      { label: 'fast', jobs: 1, credits: 2, cost: null },
      { label: 'best', jobs: 0, credits: 0, cost: null },
    ]);
  });
});
