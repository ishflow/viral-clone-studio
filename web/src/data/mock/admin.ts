import { periodStart } from '@/core/period';
import { engine } from '../engine';
import { NotFoundError } from '../ports';
import type { AdminQueries, AdminUserRow, DayValue, Format, Id, LedgerType, Period, Purchase, Quality, SpendingRow, User } from '../ports';
import { adminActor, operations, record, requiredReason } from './admin-operations';
import { PACKS, money } from './demo-values';
import { liveJobs, toJob } from './jobs';
import { balanceOf, lotsOf, toEntry, writeEntry } from './ledger';
import { SOLD, toPurchase } from './payments';
import { findUser, getStore, keyOf, newestFirst, now } from './store';
import type { JobRecord } from './store';

const DAY_MS = 86_400_000;

const QUALITIES: Quality[] = ['fast', 'best'];
const FORMATS: Format[] = ['no-talking', 'talking'];

const sum = (numbers: number[]): number => numbers.reduce((total, value) => total + value, 0);
const has = (text: string, search?: string): boolean => !search?.trim() || text.toLowerCase().includes(search.trim().toLowerCase());

/** A test for "is this ISO time inside the period". The start comes from the helper the panel's filters use: today is the current day in UTC. */
function within(period: Period): (iso: string) => boolean {
  const from = periodStart(period, now()) ?? Number.NEGATIVE_INFINITY;
  return (iso) => Date.parse(iso) >= from;
}

const entriesOf = (userId: Id, type: LedgerType) => getStore().ledger.filter((entry) => entry.userId === userId && entry.type === type);
const isPaying = (userId: Id): boolean => getStore().purchases.some((purchase) => purchase.userId === userId && SOLD.includes(purchase.status));

/** What the user paid: the sold purchases added up. Nothing bought = $0 (a real amount, not a placeholder); a sold purchase whose price is not decided = null. */
function paidTotalOf(userId: Id): string | null {
  const sold = getStore().purchases.filter((purchase) => purchase.userId === userId && SOLD.includes(purchase.status));
  if (sold.some((purchase) => purchase.amountCents === null)) return null;
  return money(sold.reduce((total, purchase) => total + (purchase.amountCents ?? 0), 0));
}

/** The sold purchases added up: `$0.00` when there are none; null when a sold purchase has no price to add up. */
function soldMoney(sold: { amountCents: number | null }[]): string | null {
  if (sold.some((purchase) => purchase.amountCents === null)) return null;
  return money(sold.reduce((total, purchase) => total + (purchase.amountCents ?? 0), 0));
}

function userRow(user: User, jobs: JobRecord[]): AdminUserRow {
  return {
    user: { ...user },
    balance: balanceOf(user.id),
    paidTotal: paidTotalOf(user.id),
    creditsSpent: 0 - sum(entriesOf(user.id, 'generation').map((entry) => entry.change)),
    videos: jobs.filter((job) => job.userId === user.id && job.status === 'done').length,
  };
}

/**
 * Numbers and tables for the panel, computed from the store and the engine. Revenue is added up from the sold purchases; the generation cost and the margin are not measured (null).
 * Users, revenue and credits are here; jobs, templates, candidates, scans and settings are in admin-operations.ts.
 */
export const admin: AdminQueries = {
  ...operations,

  /**
   * Dated records are counted inside the period. `users`, `verified` and `templatesWaiting` are totals as of now.
   * A paying user is counted only while the account exists, so `payingUsers` never exceeds `users`.
   */
  async overview(period) {
    const store = getStore();
    const inPeriod = within(period);
    const entries = store.ledger.filter((entry) => inPeriod(entry.at));
    const purchases = store.purchases.filter((purchase) => inPeriod(purchase.at));
    const changes = (type: LedgerType) => entries.filter((entry) => entry.type === type).map((entry) => entry.change);
    const payers = purchases.filter((purchase) => SOLD.includes(purchase.status) && findUser(purchase.userId)).map((purchase) => purchase.userId);
    return {
      users: store.users.length,
      newSignUps: store.users.filter((user) => inPeriod(user.joinedAt)).length,
      verified: store.users.filter((user) => user.emailVerified).length,
      payingUsers: new Set(payers).size,
      revenue: soldMoney(purchases.filter((purchase) => SOLD.includes(purchase.status))),
      creditsSold: sum(changes('purchase')),
      creditsSpent: 0 - sum(changes('generation')),
      freeVideosUsed: changes('free-video').length,
      generationCost: null,
      margin: null,
      stoppedJobs: liveJobs().filter((job) => job.status === 'stopped' && inPeriod(job.startedAt)).length,
      paymentsNotCompleted: purchases.filter((purchase) => purchase.status === 'not-completed').length,
      templatesWaiting: engine().templates().filter((template) => template.status === 'waiting').length,
      refundRequests: store.purchases.filter((purchase) => purchase.status === 'refund-requested').length,
    };
  },

  /** Newest account first. "free-only" is a user who made the free video and never paid. */
  async users({ search, filter = 'all' }) {
    const matches: Record<typeof filter, (user: User) => boolean> = {
      all: () => true,
      paying: (user) => isPaying(user.id),
      'free-only': (user) => !isPaying(user.id) && entriesOf(user.id, 'free-video').length > 0,
      'not-verified': (user) => !user.emailVerified,
      blocked: (user) => user.blocked,
    };
    const jobs = liveJobs();
    return newestFirst(getStore().users, (user) => user.joinedAt)
      .filter((user) => matches[filter](user) && (has(user.email, search) || has(user.name, search)))
      .map((user) => userRow(user, jobs));
  },

  async user(id) {
    const user = findUser(id);
    if (!user) return null;
    const store = getStore();
    const jobs = liveJobs();
    return {
      ...userRow(user, jobs),
      creditsBought: sum(entriesOf(id, 'purchase').map((entry) => entry.change)),
      purchases: newestFirst(store.purchases.filter((purchase) => purchase.userId === id), (purchase) => purchase.at).map(toPurchase),
      jobs: newestFirst(jobs.filter((job) => job.userId === id), (job) => job.startedAt).map(toJob),
      ledger: newestFirst(store.ledger.filter((entry) => entry.userId === id), (entry) => entry.at).map(toEntry),
    };
  },

  /**
   * Only an admin can add credits; the amount is a whole number above 0 and a reason is required.
   * The same key for the same user gives the same entry; a blank key is refused.
   */
  async addCredits(adminId, userId, credits, reason, idempotencyKey) {
    const by = adminActor(adminId);
    const key = keyOf('admin-credits', userId, idempotencyKey);
    if (!Number.isInteger(credits) || credits <= 0) throw new RangeError('invalid-credits');
    const note = reason.trim();
    if (!note) throw new Error('reason-required');
    if (!findUser(userId)) throw new NotFoundError('user');
    const store = getStore();
    const existing = store.ledger.find((entry) => entry.id === store.keys.get(key));
    if (existing) return toEntry(existing);
    const entry = writeEntry(userId, 'admin', credits, note, { by, reason: note });
    store.keys.set(key, entry.id);
    record(by, 'add-credits', userId, note);
    return entry;
  },

  async setBlocked(userId, blocked) {
    const user = findUser(userId);
    if (!user) throw new NotFoundError('user');
    user.blocked = blocked;
    user.block = blocked ? user.block ?? { at: now().toISOString(), reason: '', by: { kind: 'system' } } : null;
    return { ...user };
  },

  async setAccess(adminId, userId, blocked, reason) {
    const by = adminActor(adminId);
    const why = requiredReason(reason);
    if (blocked && userId === adminId) throw new Error('self');
    const user = findUser(userId);
    if (!user) throw new NotFoundError('user');
    if (user.blocked === blocked) return { outcome: 'already-done', at: user.block?.at ?? user.lastActiveAt, value: { ...user } };
    const at = now().toISOString();
    user.blocked = blocked;
    user.block = blocked ? { at, reason: why, by } : null;
    // A block ends every open session of the account; lifting it does not bring them back, the person logs in again.
    if (blocked) user.sessionVersion = (user.sessionVersion ?? 0) + 1;
    record(by, blocked ? 'block' : 'unblock', userId, why);
    return { outcome: 'done', at, value: { ...user } };
  },

  /** Newest first. */
  async purchases(period) {
    const inPeriod = within(period);
    return newestFirst(getStore().purchases.filter((purchase) => inPeriod(purchase.at)), (purchase) => purchase.at).map(toPurchase);
  },

  /** `sold` counts the purchases whose money is with us (paid, a refund asked or failed; not the refunded ones). */
  async packSales(period) {
    const inPeriod = within(period);
    const paid = getStore().purchases.filter((purchase) => SOLD.includes(purchase.status) && inPeriod(purchase.at));
    return PACKS.map((pack) => ({ pack: { ...pack }, sold: paid.filter((purchase) => purchase.packId === pack.id).length, revenue: soldMoney(paid.filter((purchase) => purchase.packId === pack.id)) }));
  },

  /**
   * Marks a paid purchase refunded and takes its credits back, once. Credits that are already spent cannot be taken back:
   * the entry removes what is left of the pack at most, so the balance never goes below zero. With nothing left, no entry is written.
   */
  async refund(purchaseId) {
    const purchase = getStore().purchases.find((item) => item.id === purchaseId);
    if (!purchase) throw new NotFoundError('purchase');
    if (purchase.status === 'not-completed') throw new Error('not-paid');
    if (purchase.status === 'paid') {
      const takenBack = Math.min(purchase.credits, balanceOf(purchase.userId));
      if (takenBack > 0) writeEntry(purchase.userId, 'refund', -takenBack, purchase.packName, { purchaseId: purchase.id });
      purchase.status = 'refunded';
    }
    return toPurchase(purchase);
  },

  async refundPurchase(adminId, purchaseId, reason, idempotencyKey) {
    const by = adminActor(adminId);
    const why = requiredReason(reason);
    const purchase = getStore().purchases.find((item) => item.id === purchaseId);
    if (!purchase) throw new NotFoundError('purchase');
    keyOf('admin-refund', purchase.userId, idempotencyKey);
    if ((purchase.status === 'refund-sent' || purchase.status === 'refunded') && purchase.refund?.sentAt) {
      return { outcome: 'already-done', at: purchase.refund.sentAt, value: toPurchase(purchase) };
    }
    if (purchase.status !== 'refund-requested' && purchase.status !== 'refund-failed') throw new Error('not-requested');
    if ((lotsOf(purchase.userId).get(purchase.id) ?? 0) < purchase.credits) throw new Error('credits-used');
    const at = now().toISOString();
    purchase.status = 'refund-sent'; // first: the pack is not held any more, so its credits can be removed
    purchase.refund = { requestedAt: purchase.refund?.requestedAt ?? at, sentAt: at, settledAt: null, by };
    writeEntry(purchase.userId, 'refund', -purchase.credits, purchase.packName, { by, reason: why, purchaseId: purchase.id, from: purchase.id });
    record(by, 'refund', purchaseId, why);
    return { outcome: 'done', at, value: toPurchase(purchase) };
  },

  /** Everyone's entries, newest first. */
  async ledger({ type, period }) {
    const inPeriod = within(period);
    const entries = getStore().ledger.filter((entry) => (!type || entry.type === type) && inPeriod(entry.at));
    return newestFirst(entries, (entry) => entry.at).map(toEntry);
  },

  /**
   * One row per UTC day from the start of the period (or the first purchase) to today. The cost is not measured: null (B21).
   * A sale from before the period starts is left out even on the day the period starts, so the days add up to the revenue of the period (the first day can be a part day).
   */
  async dailySeries(period) {
    const store = getStore();
    const today = Date.parse(now().toISOString().slice(0, 10));
    const first = store.purchases.reduce((min, purchase) => Math.min(min, Date.parse(purchase.at.slice(0, 10))), today);
    const start = Date.parse(new Date(periodStart(period, now()) ?? first).toISOString().slice(0, 10));
    const inPeriod = within(period);
    const days: DayValue[] = [];
    for (let day = start; day <= today; day += DAY_MS) {
      const date = new Date(day).toISOString().slice(0, 10);
      const sold = store.purchases.filter((purchase) => SOLD.includes(purchase.status) && inPeriod(purchase.at) && purchase.at.slice(0, 10) === date);
      const unpriced = sold.some((purchase) => purchase.amountCents === null);
      days.push({ date, revenueCents: unpriced ? null : sum(sold.map((purchase: Omit<Purchase, 'refundable'>) => purchase.amountCents ?? 0)), generationCostCents: null });
    }
    return days;
  },

  /** The paid requests of every job started in the period, as approved at its start; no price yet (B21). */
  async usage(period) {
    const inPeriod = within(period);
    return newestFirst(liveJobs().filter((job) => inPeriod(job.startedAt) && job.approved), (job) => job.startedAt)
      .map((job) => ({ jobId: job.id, at: job.startedAt, templateId: job.templateId, paid: { ...(job.approved ?? { images: 0, clips: 0, clipSeconds: 0, music: 0, voice: 0 }) }, costCents: null }));
  },

  /** Jobs started in the period and the credits they were charged. The label is the quality or format key. */
  async spending(period) {
    const inPeriod = within(period);
    const templates = engine().templates();
    const jobs = liveJobs().filter((job) => inPeriod(job.startedAt));
    const formatOf = (job: JobRecord) => templates.find((template) => template.id === job.templateId)?.format;
    const row = (label: string, group: JobRecord[]): SpendingRow => ({ label, jobs: group.length, credits: sum(group.map((job) => job.credits)), cost: null });
    return {
      byQuality: QUALITIES.map((quality) => row(quality, jobs.filter((job) => job.input.quality === quality))),
      byFormat: FORMATS.map((format) => row(format, jobs.filter((job) => formatOf(job) === format))),
    };
  },
};
