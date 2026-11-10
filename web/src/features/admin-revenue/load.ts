import { requireAdmin } from '@/core/session/guards';
import { data } from '@/data';
import { paymentPipelineEnabled } from '@/core/payments/config';
import { creditsLeft, paidAtDodo, partRefunded, paymentMarks, refundAmountUnknown, uncreditedPayments } from '@/data/real/payments-gateway';
import { taxOf } from '@/shared/lib/format';
import { readSeries } from '../admin-common/series';
import type { CreditsViewProps } from './CreditsView';
import { parseLedgerType, parsePeriod, parseStatusMark, type Params } from './query';
import type { RevenuePurchase, RevenueUncredited, RevenueViewProps } from './RevenueView';

/** Purchases whose money is still with us: revenue, average, pack shares and the purchases tile are all made of these. */
const SOLD = ['paid', 'refund-requested', 'refund-failed'];

/** Money returned to customers: refunds sent (the tile moves when the admin sends, not when the provider confirms) and refunded; null when one of them has no price to add up. */
function refundedMoney(purchases: { status: string; amountCents: number | null }[]): string | null {
  const refunded = purchases.filter((p) => p.status === 'refunded' || p.status === 'refund-sent');
  if (refunded.some((p) => p.amountCents === null)) return null;
  const cents = refunded.reduce((total, p) => total + (p.amountCents ?? 0), 0);
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 === 0 ? 0 : 2 })}`;
}

type Refundable = { id: string; status: string; amountCents: number | null; totalCents?: number };
/**
 * The refunds tile where the payment pipeline runs. A refund of a Dodo payment is money back only once Dodo said so: it counts when it is
 * "refunded", with all that went back (the tax Dodo added too), and until then it is `pending`, beside the sum and not in it. The offline
 * provider says how a refund ended only when someone makes it say so, so its refunds count as before: when they are sent, with the pack price.
 */
function refundTiles(purchases: Refundable[]): { refunds: string | null; refundsPending: string | null } {
  const atDodo = (p: Refundable) => paidAtDodo(p.id);
  const back = (p: Refundable) => (atDodo(p) ? (p.totalCents ?? p.amountCents) : p.amountCents);
  const settled = purchases.filter((p) => p.status === 'refunded' || (p.status === 'refund-sent' && !atDodo(p))).map((p) => ({ status: p.status, amountCents: back(p) }));
  const pending = purchases.filter((p) => p.status === 'refund-sent' && atDodo(p)).map((p) => ({ status: p.status, amountCents: back(p) }));
  return { refunds: refundedMoney(settled), refundsPending: pending.length > 0 ? refundedMoney(pending) : null };
}

/** Revenue divided by the sold purchases; null with no purchase or a purchase without a price. */
function averageMoney(purchases: { status: string; amountCents: number | null }[]): string | null {
  const sold = purchases.filter((p) => SOLD.includes(p.status));
  if (sold.length === 0 || sold.some((p) => p.amountCents === null)) return null;
  const cents = Math.round(sold.reduce((total, p) => total + (p.amountCents ?? 0), 0) / sold.length);
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

/** A pack's part of the revenue, in whole percent; null with no revenue or a purchase without a price. */
function shareOf(purchases: { status: string; packId: string; amountCents: number | null }[], packId: string): string | null {
  const sold = purchases.filter((p) => SOLD.includes(p.status));
  if (sold.length === 0 || sold.some((p) => p.amountCents === null)) return null;
  const total = sold.reduce((n, p) => n + (p.amountCents ?? 0), 0);
  if (total === 0) return null;
  const part = sold.filter((p) => p.packId === packId).reduce((n, p) => n + (p.amountCents ?? 0), 0);
  return `${Math.round((part / total) * 100)}%`;
}

const sum = (numbers: number[]) => numbers.reduce((total, n) => total + n, 0);

/** Revenue page data for one period. Admin only. */
export async function loadRevenue(params: Params): Promise<RevenueViewProps> {
  await requireAdmin();
  const period = parsePeriod(params.period);
  const [overview, purchases, packs, users, chart] = await Promise.all([
    data.admin.overview(period), data.admin.purchases(period), data.admin.packSales(period), data.admin.users({}), readSeries(() => data.admin.dailySeries(period)),
  ]);
  // A purchase outlives its account: no user, no email (the views say "Deleted account").
  const emailOf = new Map(users.map((row) => [row.user.id, row.user.email]));
  const invoiceNumbers = new Map((await Promise.all(users.map((row) => data.invoices.listFor(row.user.id)))).flat().map((invoice) => [invoice.id, invoice.number]));
  const balanceOf = new Map(users.map((row) => [row.user.id, row.balance]));
  // Marks exist only where the signed payment pipeline runs: the demo's purchases have no payment record.
  const marks = paymentPipelineEnabled() ? paymentMarks() : null;
  // A part of a payment that went back at the provider, printed like every amount: the mark then says "partial refund" with it.
  const partOf = (purchaseId: string) => { const cents = marks ? partRefunded(purchaseId) : 0; return cents > 0 ? `$${(cents / 100).toFixed(2)}` : null; };
  const rows: RevenuePurchase[] = purchases.map((p) => ({
    review: marks?.get(p.id) ?? null, partRefund: partOf(p.id), refundAmountUnknown: marks ? refundAmountUnknown(p.id) : false,
    by: p.refund?.by?.kind === 'admin' ? p.refund.by.name : null, balance: balanceOf.get(p.userId) ?? 0,
    id: p.id, at: p.at, userId: p.userId, email: emailOf.get(p.userId) ?? null, packName: p.packName, credits: p.credits, creditsLeft: creditsLeft(p.id),
    amount: p.amount, tax: taxOf(p)?.tax ?? null, total: taxOf(p)?.total ?? null, invoiceUrl: p.invoiceUrl ?? null, status: p.status, invoiceId: p.invoiceId, invoiceNumber: p.invoiceId ? (invoiceNumbers.get(p.invoiceId) ?? null) : null,
  }));
  // A payment that was not credited has no purchase to hang a mark on, and waits for the owner whatever the period.
  const uncredited: RevenueUncredited[] = paymentPipelineEnabled()
    ? uncreditedPayments().map((u) => ({ id: u.checkoutId, at: u.at, userId: u.userId, email: emailOf.get(u.userId) ?? null, packName: u.packName, amount: u.amount, reason: u.reason }))
    : [];
  return {
    period,
    mark: parseStatusMark(params.status),
    uncredited,
    tiles: {
      revenue: overview.revenue,
      purchases: purchases.filter((p) => SOLD.includes(p.status)).length,
      average: averageMoney(purchases),
      paying: overview.payingUsers,
      notCompleted: overview.paymentsNotCompleted,
      ...(paymentPipelineEnabled() ? refundTiles(purchases) : { refunds: refundedMoney(purchases), refundsPending: null }),
    },
    chart,
    packs: packs.map(({ pack, sold, revenue }) => ({ id: pack.id, name: pack.name, credits: pack.credits, price: pack.price, sold, revenue, share: shareOf(purchases, pack.id) })),
    purchases: rows,
  };
}

/** Credits page data: tiles, spending tables, ledger filtered by type. Admin only. */
export async function loadCredits(params: Params): Promise<CreditsViewProps> {
  await requireAdmin();
  const period = parsePeriod(params.period);
  const type = parseLedgerType(params.type);
  const [overview, spending, ledger, adminEntries, refundEntries, users, allPurchases] = await Promise.all([
    data.admin.overview(period), data.admin.spending(period), data.admin.ledger({ type, period }),
    data.admin.ledger({ type: 'admin', period }), data.admin.ledger({ type: 'refund', period }), data.admin.users({}), data.admin.purchases('all'),
  ]);
  const numbers = new Map((await Promise.all(users.map((row) => data.invoices.listFor(row.user.id)))).flat().map((invoice) => [invoice.id, invoice.number]));
  const emailOf = new Map(users.map((row) => [row.user.id, row.user.email]));
  return {
    period,
    type,
    tiles: {
      sold: overview.creditsSold,
      spent: overview.creditsSpent,
      unspent: sum(users.map((row) => row.balance)),
      free: overview.freeVideosUsed,
      admin: sum(adminEntries.map((e) => e.change)),
      refunded: 0 - sum(refundEntries.map((e) => e.change)),
    },
    spending,
    ledger: ledger.map((e) => ({ ...e, email: emailOf.get(e.userId) ?? null })),
    purchases: Object.fromEntries(allPurchases.map((p) => [p.id, { number: p.invoiceId ? (numbers.get(p.invoiceId) ?? null) : null, invoiceId: p.invoiceId, invoiceUrl: p.invoiceUrl ?? null }])),
  };
}
