// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '../index';
import type { Period } from '../ports';
import { getStore, now, resetStore, setClock } from './store';

const PERIODS: Period[] = ['today', '7d', '30d', 'all'];
const MONEY_FIELDS = ['price', 'amount', 'revenue', 'cost', 'margin', 'paidTotal', 'generationCost'];

/** Every [field, value] pair with a money field name, at any depth. */
function moneyValues(value: unknown, found: [string, unknown][] = []): [string, unknown][] {
  if (Array.isArray(value)) {
    value.forEach((item) => moneyValues(item, found));
  } else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      if (MONEY_FIELDS.includes(key)) found.push([key, inner]);
      else moneyValues(inner, found);
    }
  }
  return found;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
  resetStore();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('fake store', () => {
  it('is created from the fixtures on first use', () => {
    const store = getStore();
    expect(store.users).toHaveLength(7);
    expect(store.templates).toHaveLength(8);
    expect(store.templates.filter((template) => template.status === 'published')).toHaveLength(6);
    expect(store.scans).toHaveLength(3);
    expect(store.candidates).toHaveLength(5);
  });

  it('keeps one object between calls', () => {
    getStore().users.pop();
    expect(getStore().users).toHaveLength(6);
  });

  it('survives a module reload, like a Next dev hot reload', async () => {
    getStore().users.pop();
    vi.resetModules();
    const reloaded = await import('./store');
    expect(reloaded.getStore().users).toHaveLength(6);
  });

  it('resetStore() brings the fixtures back', () => {
    getStore().users.pop();
    resetStore();
    expect(getStore().users).toHaveLength(7);
  });

  it('takes the time from the system clock, so fake timers move it', () => {
    expect(now().toISOString()).toBe('2026-10-04T12:00:00.000Z');
    vi.advanceTimersByTime(90_000);
    expect(now().toISOString()).toBe('2026-10-04T12:01:30.000Z');
  });

  it('lets a test inject another clock, and resetStore() puts the real one back', () => {
    setClock(() => new Date('2030-01-01T00:00:00Z'));
    expect(now().toISOString()).toBe('2030-01-01T00:00:00.000Z');
    resetStore();
    expect(now().toISOString()).toBe('2026-10-04T12:00:00.000Z');
  });

  it('dates the fixtures relative to the moment the store is created', () => {
    const demo = getStore().users.find((user) => user.id === 'usr-demo');
    expect(demo?.joinedAt).toBe('2026-09-13T12:00:00.000Z');
  });
});

describe('money', () => {
  it('every money field is null but the pack prices and purchase amounts of the contract', async () => {
    const { checkoutId } = await data.payments.startCheckout('usr-new', 'pack-studio', '/gallery');
    const users = getStore().users;
    const answers = [
      await data.payments.packs(),
      await data.payments.getCheckout(checkoutId, 'usr-new'),
      await data.payments.complete(checkoutId, 'paid'),
      await Promise.all(users.map((user) => data.payments.purchasesFor(user.id))),
      await Promise.all(PERIODS.map((period) => data.admin.overview(period))),
      await Promise.all(PERIODS.map((period) => data.admin.purchases(period))),
      await Promise.all(PERIODS.map((period) => data.admin.packSales(period))),
      await Promise.all(PERIODS.map((period) => data.admin.spending(period))),
      await data.admin.users({}),
      await Promise.all(users.map((user) => data.admin.user(user.id))),
      getStore().purchases,
    ];
    const found = moneyValues(answers);
    expect(new Set(found.map(([field]) => field))).toEqual(new Set(MONEY_FIELDS));
    // The pack prices and the purchase amounts are the contract's (§1.1); the cost and the margin are not measured yet.
    const PRICES = ['$19', '$54', '$169'];
    const AMOUNTS = ['$19.00', '$54.00', '$169.00'];
    const contract = ([field, value]: [string, unknown]) =>
      (field === 'price' && PRICES.includes(String(value))) || (field === 'amount' && AMOUNTS.includes(String(value)))
      || ((field === 'paidTotal' || field === 'revenue') && /^\$\d+\.\d{2}$/.test(String(value)));   // a user's total and the revenue are sums of those amounts
    expect(found.filter(([, value]) => value !== null).filter((pair) => !contract(pair))).toEqual([]);
  });
});
