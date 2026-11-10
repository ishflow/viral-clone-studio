// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '../index';
import { InsufficientCreditsError } from '../ports';
import { writeEntry } from './ledger';
import { getStore, resetStore } from './store';
import { startConfirmed } from './test-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
  resetStore();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('fake credit ledger', () => {
  it('balance equals the sum of changes', async () => {
    const entries = await data.ledger.entries('usr-demo');
    const sum = entries.reduce((total, entry) => total + entry.change, 0);
    expect(await data.ledger.balance('usr-demo')).toBe(sum);
    expect(sum).toBe(19);
  });

  it('entries are newest first', async () => {
    const entries = await data.ledger.entries('usr-paying');
    const times = entries.map((entry) => entry.at);
    expect(times.length).toBeGreaterThan(3);
    expect(times).toEqual([...times].sort().reverse());
  });

  it('balanceAfter of the newest entry equals balance()', async () => {
    for (const userId of ['usr-demo', 'usr-paying', 'usr-free', 'usr-blocked']) {
      const [newest] = await data.ledger.entries(userId);
      expect(newest?.balanceAfter).toBe(await data.ledger.balance(userId));
    }
  });

  it('every fixture entry carries the running balance of its user, and no balance goes below zero', async () => {
    for (const user of getStore().users) {
      let running = 0;
      for (const entry of (await data.ledger.entries(user.id)).reverse()) {
        running += entry.change;
        expect(entry.balanceAfter).toBe(running);
        expect(running).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('the fixtures hold an entry of every type', () => {
    const types = new Set(getStore().ledger.map((entry) => entry.type));
    expect([...types].sort()).toEqual(['admin', 'free-video', 'generation', 'purchase', 'refund', 'returned']);
  });

  it('a user without entries has balance 0', async () => {
    expect(await data.ledger.balance('usr-new')).toBe(0);
    expect(await data.ledger.entries('usr-new')).toEqual([]);
    expect(await data.ledger.balance('nobody')).toBe(0);
  });

  it('a written entry is stamped with the clock and the new balance, and comes first', async () => {
    vi.advanceTimersByTime(60_000);
    const entry = writeEntry('usr-demo', 'admin', 4, 'Test');
    expect(entry).toMatchObject({ userId: 'usr-demo', type: 'admin', change: 4, note: 'Test', balanceAfter: 23 });
    expect(entry.at).toBe('2026-10-04T12:01:00.000Z');
    expect((await data.ledger.entries('usr-demo'))[0]).toEqual(entry);
    expect(await data.ledger.balance('usr-demo')).toBe(23);
  });

  it('refuses an entry that would take the balance below zero', async () => {
    expect(() => writeEntry('usr-demo', 'generation', -20, 'Too much')).toThrow(InsufficientCreditsError);
    expect(await data.ledger.balance('usr-demo')).toBe(19);
  });

  it('refuses a change that is not a whole number', async () => {
    const before = getStore().ledger.length;
    expect(() => writeEntry('usr-demo', 'admin', Number.NaN, 'Broken')).toThrow(RangeError);
    expect(() => writeEntry('usr-demo', 'admin', 1.5, 'Broken')).toThrow(RangeError);
    expect(getStore().ledger).toHaveLength(before);
  });

  it('balanceAfter follows a mixed sequence: purchase → generation → added by the admin → refund', async () => {
    const { checkoutId } = await data.payments.startCheckout('usr-new', 'pack-starter', '/gallery');
    const purchase = await data.payments.complete(checkoutId, 'paid');
    await startConfirmed('usr-new', { templateId: 'tpl-layering', products: [], quality: 'best', variants: 1, language: 'en' }, 'key-1');
    await data.admin.addCredits('usr-admin', 'usr-new', 3, 'Test', 'key-1');
    await data.admin.refund(purchase.id);

    const entries = (await data.ledger.entries('usr-new')).reverse();
    expect(entries.map((entry) => [entry.type, entry.change, entry.balanceAfter])).toEqual([
      ['purchase', 10, 10], ['generation', -5, 5], ['admin', 3, 8], ['refund', -8, 0],
    ]);
    expect(entries.map((entry) => entry.note)).toEqual(['Starter', 'Fragrance layering recipe', 'Test', 'Starter']);
    expect(await data.ledger.balance('usr-new')).toBe(0);
  });

  it('hands out copies, so a caller cannot change the ledger', async () => {
    const [newest] = await data.ledger.entries('usr-demo');
    if (newest) newest.change = 1000;
    expect(await data.ledger.balance('usr-demo')).toBe(19);
  });
});
