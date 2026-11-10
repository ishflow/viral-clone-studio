// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '../index';
import { NotFoundError } from '../ports';
import { getStore, resetStore } from './store';

const ids = (rows: { user: { id: string } }[]) => rows.map((row) => row.user.id);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
  resetStore();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('addCredits', () => {
  it('writes an admin ledger entry with the reason and raises the balance', async () => {
    const entry = await data.admin.addCredits('usr-admin', 'usr-new', 5, ' Welcome gift ', 'key-1');
    expect(entry).toMatchObject({ userId: 'usr-new', type: 'admin', change: 5, note: 'Welcome gift', balanceAfter: 5, at: '2026-10-04T12:00:00.000Z' });
    expect(await data.ledger.balance('usr-new')).toBe(5);
    expect(await data.ledger.entries('usr-new')).toEqual([entry]);
  });

  it('same idempotencyKey twice → one entry', async () => {
    const first = await data.admin.addCredits('usr-admin', 'usr-new', 5, 'Welcome gift', 'key-1');
    const second = await data.admin.addCredits('usr-admin', 'usr-new', 5, 'Welcome gift', 'key-1');
    const [third, fourth] = await Promise.all([
      data.admin.addCredits('usr-admin', 'usr-new', 5, 'Welcome gift', 'key-2'),
      data.admin.addCredits('usr-admin', 'usr-new', 5, 'Welcome gift', 'key-2'),
    ]);
    expect(second).toEqual(first);
    expect(fourth).toEqual(third);
    expect(await data.ledger.entries('usr-new')).toHaveLength(2);
    expect(await data.ledger.balance('usr-new')).toBe(10);
  });

  it('keeps the keys apart per user: the same key for another user adds credits there too', async () => {
    await data.admin.addCredits('usr-admin', 'usr-new', 5, 'Welcome gift', 'key-1');
    const other = await data.admin.addCredits('usr-admin', 'usr-free', 7, 'Welcome gift', 'key-1');
    expect(other).toMatchObject({ userId: 'usr-free', change: 7, balanceAfter: 7 });
    expect(await data.ledger.balance('usr-new')).toBe(5);
    expect(await data.ledger.balance('usr-free')).toBe(7);
  });

  it.each([
    ['0', 0, 'A reason'],
    ['a negative number', -5, 'A reason'],
    ['a number that is not whole', 1.5, 'A reason'],
    ['not a number', Number.NaN, 'A reason'],
    ['an empty reason', 5, ''],
    ['a reason of spaces', 5, '   '],
  ])('with %s throws and writes nothing', async (_case, credits, reason) => {
    const before = getStore().ledger.length;
    await expect(data.admin.addCredits('usr-admin', 'usr-new', credits, reason, 'key-1')).rejects.toThrow();
    expect(getStore().ledger).toHaveLength(before);
    expect(await data.ledger.balance('usr-new')).toBe(0);
    await expect(data.admin.addCredits('usr-admin', 'usr-new', 5, 'Welcome gift', 'key-1')).resolves.toMatchObject({ change: 5 });
  });

  it.each(['', '   '])('with a blank idempotency key (%j) throws and writes nothing', async (key) => {
    const before = getStore().ledger.length;
    await expect(data.admin.addCredits('usr-admin', 'usr-new', 5, 'Welcome gift', key)).rejects.toThrow('idempotency-key-required');
    expect(getStore().ledger).toHaveLength(before);
  });

  it('is refused for a caller who is not an admin, and for an unknown user', async () => {
    const before = getStore().ledger.length;
    await expect(data.admin.addCredits('usr-demo', 'usr-demo', 50, 'For me', 'key-1')).rejects.toThrow('forbidden');
    await expect(data.admin.addCredits('nobody', 'usr-demo', 50, 'For me', 'key-2')).rejects.toThrow('forbidden');
    await expect(data.admin.addCredits('usr-admin', 'nobody', 5, 'A reason', 'key-3')).rejects.toThrow(NotFoundError);
    expect(getStore().ledger).toHaveLength(before);
  });
});

describe('users', () => {
  it('setBlocked makes logIn return null', async () => {
    expect(await data.admin.setBlocked('usr-demo', true)).toMatchObject({ id: 'usr-demo', blocked: true });
    expect(await data.auth.logIn('demo@viralclone.app', 'x')).toMatchObject({ ok: false, reason: 'blocked' });
    expect(await data.ledger.balance('usr-demo')).toBe(19);
    await data.admin.setBlocked('usr-demo', false);
    expect(await data.auth.logIn('demo@viralclone.app', 'x')).toMatchObject({ ok: true, user: { id: 'usr-demo' } });
    await expect(data.admin.setBlocked('nobody', true)).rejects.toThrow(NotFoundError);
  });

  it('users({ filter: \'blocked\' }) returns only blocked', async () => {
    const rows = await data.admin.users({ filter: 'blocked' });
    expect(ids(rows)).toEqual(['usr-blocked']);
    expect(rows.every((row) => row.user.blocked)).toBe(true);
  });

  it('lists everyone, newest account first, with balance, credits spent and finished videos', async () => {
    const rows = await data.admin.users({});
    expect(ids(rows)).toEqual(['usr-new', 'usr-unverified', 'usr-free', 'usr-demo', 'usr-blocked', 'usr-paying', 'usr-admin']);
    expect(ids(await data.admin.users({ filter: 'all' }))).toEqual(ids(rows));
    expect(rows.find((row) => row.user.id === 'usr-demo')).toMatchObject({ balance: 19, paidTotal: '$54.00', creditsSpent: 16, videos: 3 });
    expect(rows.find((row) => row.user.id === 'usr-paying')).toMatchObject({ balance: 82, paidTotal: '$169.00', creditsSpent: 23, videos: 3 });
    expect(rows.find((row) => row.user.id === 'usr-new')).toMatchObject({ balance: 0, paidTotal: '$0.00', creditsSpent: 0, videos: 0 });   // nothing bought is $0.00, never the [AMOUNT] placeholder
  });

  it('filters paying, free video only and not verified', async () => {
    expect(ids(await data.admin.users({ filter: 'paying' }))).toEqual(['usr-demo', 'usr-blocked', 'usr-paying']);
    expect(ids(await data.admin.users({ filter: 'free-only' }))).toEqual(['usr-free']);
    expect(ids(await data.admin.users({ filter: 'not-verified' }))).toEqual(['usr-unverified']);
  });

  it('searches email and name, whatever the letter case', async () => {
    expect(ids(await data.admin.users({ search: 'VIRALCLONE.app' }))).toEqual(['usr-new', 'usr-demo', 'usr-admin']);
    expect(ids(await data.admin.users({ search: 'paying customer' }))).toEqual(['usr-paying']);
    expect(ids(await data.admin.users({ search: 'example.com', filter: 'paying' }))).toEqual(['usr-blocked', 'usr-paying']);
    expect(await data.admin.users({ search: 'no such user' })).toEqual([]);
  });

  it('user(id) adds credits bought, purchases, jobs and the credit history', async () => {
    const detail = await data.admin.user('usr-paying');
    expect(detail).toMatchObject({ balance: 82, paidTotal: '$169.00', creditsSpent: 23, videos: 3, creditsBought: 110 });
    expect(detail?.purchases.map((purchase) => purchase.status)).toEqual(['not-completed', 'paid', 'refunded']);
    expect(detail?.jobs).toHaveLength(3);
    expect(detail?.ledger.map((entry) => entry.type)).toEqual(['generation', 'admin', 'generation', 'purchase', 'refund', 'purchase', 'free-video']);
    expect(await data.admin.user('nobody')).toBeNull();
  });
});

describe('overview', () => {
  it('overview(\'all\').users equals the number of users', async () => {
    expect((await data.admin.overview('all')).users).toBe(getStore().users.length);
    await data.auth.signUp('sam@example.com', 'x');
    expect((await data.admin.overview('all')).users).toBe(8);
  });

  it('counts everything for all time; revenue is the sold purchases added up, cost and margin are not measured', async () => {
    expect(await data.admin.overview('all')).toEqual({
      users: 7, newSignUps: 7, verified: 6, payingUsers: 3, revenue: '$242.00',
      creditsSold: 150, creditsSpent: 43, freeVideosUsed: 3, generationCost: null, margin: null,
      stoppedJobs: 1, paymentsNotCompleted: 1, templatesWaiting: 0, refundRequests: 0,
    });
  });

  it('counts dated records inside the period only', async () => {
    expect(await data.admin.overview('today')).toMatchObject({
      users: 7, newSignUps: 1, verified: 6, payingUsers: 0, creditsSold: 0, creditsSpent: 2, freeVideosUsed: 0, stoppedJobs: 0, paymentsNotCompleted: 0,
    });
    expect(await data.admin.overview('7d')).toMatchObject({
      newSignUps: 3, payingUsers: 0, creditsSold: 0, creditsSpent: 26, freeVideosUsed: 1, stoppedJobs: 1, paymentsNotCompleted: 1,
    });
    expect(await data.admin.overview('30d')).toMatchObject({ newSignUps: 4, payingUsers: 2, creditsSold: 40, creditsSpent: 35, freeVideosUsed: 2 });
  });

  it('counts the templates that wait to be published', async () => {
    await data.admin.prepareCandidate('cand-1');
    await data.admin.updateTemplate('tpl-eye', { status: 'waiting' });
    expect((await data.admin.overview('today')).templatesWaiting).toBe(2);
  });

  it('counts a paying user only while the account exists', async () => {
    await data.auth.deleteAccount('usr-paying');
    expect(await data.admin.overview('all')).toMatchObject({ users: 6, payingUsers: 2 });
  });
});

describe('dailySeries', () => {
  it('leaves out a purchase whose refund was sent: the days add up to the revenue of the same period', async () => {
    const { checkoutId } = await data.payments.startCheckout('usr-demo', 'pack-starter', '/gallery');
    const purchase = await data.payments.complete(checkoutId, 'paid');
    await data.payments.requestRefund('usr-demo', purchase.id);
    await data.admin.refundPurchase('usr-admin', purchase.id, 'Unused pack', 'key-1');
    expect(getStore().purchases.find((item) => item.id === purchase.id)?.status).toBe('refund-sent');

    const days = await data.admin.dailySeries('all');
    const cents = days.reduce((total, day) => total + (day.revenueCents ?? 0), 0);
    expect(`$${(cents / 100).toFixed(2)}`).toBe((await data.admin.overview('all')).revenue);
  });
});

describe('dailySeries against the revenue box', () => {
  const sale = (id: string, at: string, amountCents: number) => ({
    id, userId: 'usr-paying', packId: 'pack-starter', packName: 'Starter', credits: 10, amount: `$${(amountCents / 100).toFixed(2)}`,
    amountCents, at, status: 'paid' as const, invoiceId: null, refund: null,
  });
  const chartTotal = async (period: 'today' | '7d' | '30d' | 'all') => {
    const days = await data.admin.dailySeries(period);
    return `$${(days.reduce((total, day) => total + (day.revenueCents ?? 0), 0) / 100).toFixed(2)}`;
  };

  // "Now" is 2026-10-04 12:00 UTC. Each pair sits on the UTC day the period starts on: one sale before the start, one after it.
  it.each([
    ['7d', '2026-09-27T01:00:00.000Z', '2026-09-27T18:00:00.000Z'],
    ['30d', '2026-09-04T01:00:00.000Z', '2026-09-04T18:00:00.000Z'],
    ['today', '2026-10-03T23:00:00.000Z', '2026-10-04T08:00:00.000Z'],
  ] as const)('%s: a sale before the period starts, on the same UTC day as its start, is in neither the chart nor the box', async (period, before, after) => {
    getStore().purchases = [sale('pur-before', before, 1900), sale('pur-after', after, 2900)];

    expect((await data.admin.overview(period)).revenue).toBe('$29.00');
    expect(await chartTotal(period)).toBe('$29.00');
  });

  it('all: the chart adds up to the box', async () => {
    getStore().purchases = [sale('pur-old', '2025-01-01T01:00:00.000Z', 1900), sale('pur-new', '2026-10-04T08:00:00.000Z', 2900)];

    expect((await data.admin.overview('all')).revenue).toBe('$48.00');
    expect(await chartTotal('all')).toBe('$48.00');
  });
});
