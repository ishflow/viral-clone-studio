'use client';

import Link from 'next/link';
import { useLocale, useT } from '@/core/i18n/I18nProvider';
import type { Period, PurchaseStatus } from '@/data/ports';
import { formatDate } from '@/shared/lib/format';
import { buttonClass, DataTable, Icon, PageHead, Pager, Segmented, StatusLine, SubNav, Tile, TileGrid } from '@/shared/ui';
import { Section, UserCell } from './parts';
import { hrefWith, PERIODS, type StatusMark } from './query';
import { ChartCard } from '../admin-common/ChartCard';
import { PURCHASE_KIND } from '../admin-common/status';
import type { BarDay } from '@/shared/ui';
import { RefundButton } from './RefundButton';

export type RevenuePurchase = { id: string; at: string; userId: string; email: string | null; packName: string; credits: number; amount: string | null; status: PurchaseStatus; invoiceId: string | null; invoiceNumber: string | null;
  /** The tax the payment provider added to the pack price and the total it charged; absent or null where it reported no tax. `amount` is the pack price either way. */
  tax?: string | null; total?: string | null;
  /** The provider's own invoice of the payment, where it gave one: the link goes there, and to the site's own page otherwise. */
  invoiceUrl?: string | null;
  /** What is left of the pack: the credits a refund takes out. Absent: the whole pack. */
  creditsLeft?: number;
  /** Who sent the refund (the admin's name), when one did. */
  by: string | null;
  /** What the payment gate asks the owner to look at on this purchase, when it does. */
  review: 'disputed' | 'refund-review' | 'refund-outside' | 'refund-conflict' | 'refund-overdue' | 'refund-unknown' | 'refund-not-found' | 'refund-no-funds' | 'second-payment' | null;
  /** A part of the payment that went back at the provider, not from here, while the whole of it did not: the mark says so with this amount, and the owner decides. */
  partRefund?: string | null;
  /** A refund went through at the provider, not from here, and how much it gave back is not known: the mark says so, and sends the owner to the provider. */
  refundAmountUnknown?: boolean;
  /** The user's balance now (for the refund confirmation). */
  balance: number };
/** A payment the provider reported that was not credited, and why: it has no purchase. `email` is null when the account was deleted. */
export type RevenueUncredited = { id: string; at: string; userId: string; email: string | null; packName: string; amount: string; reason: 'facts-missing' | 'currency' | 'tax-unknown' | 'cart' | 'amount' | 'no-account' | 'binding' | 'gave-up' };
export type RevenuePack = { id: string; name: string; credits: number; price: string | null; sold: number; revenue: string | null; share?: string | null };
export type RevenueViewProps = {
  period: Period;
  mark: StatusMark | null;
  tiles: { revenue: string | null; purchases: number; average: string | null; paying: number; notCompleted: number; refunds: string | null;
    /** Refunds that were sent and that the provider has not settled yet: not in `refunds`, said under it. */
    refundsPending?: string | null };
  /** The days of the chart; null when they could not be read. */
  chart: BarDay[] | null;
  packs: RevenuePack[];
  purchases: RevenuePurchase[];
  uncredited: RevenueUncredited[];
};

/** The Purchases / Credits tabs, shared by both revenue pages. */
export function RevenueTabs({ current }: { current: 'purchases' | 'credits' }) {
  const t = useT();
  return (
    <div className="-mt-8">
      <SubNav
        label={t('adminRevenue.sections')}
        currentHref={current === 'purchases' ? '/admin/revenue' : '/admin/revenue/credits'}
        items={[{ href: '/admin/revenue', label: t('adminRevenue.tab.purchases') }, { href: '/admin/revenue/credits', label: t('adminRevenue.tab.credits') }]}
      />
    </div>
  );
}

export function PeriodControl({ base, period }: { base: string; period: Period }) {
  const t = useT();
  return (
    <Segmented
      label={t('adminRevenue.period.label')}
      value={period}
      options={PERIODS.map((value) => ({ value, label: t(`adminRevenue.period.${value}`) }))}
      hrefFor={(value) => hrefWith(base, { period: value as Period })}
      className="max-nav:w-full"
    />
  );
}

/** `/admin/revenue`: the numbers of the period, sales by pack, and every purchase with its invoice and a Refund button. */
export function RevenueView({ period, mark, tiles, chart, packs, purchases, uncredited }: RevenueViewProps) {
  const t = useT();
  const locale = useLocale();
  const number = new Intl.NumberFormat(locale);
  const amount = (value: string | null) => value ?? t('adminRevenue.placeholder.amount');
  return (
    <div className="flex flex-col gap-8">
      <RevenueTabs current="purchases" />
      <PageHead
        title={t('adminRevenue.title')}
        lead={t('adminRevenue.lead')}
        actions={
          <div className="flex w-full flex-col items-stretch gap-3 nav:w-auto nav:flex-row nav:items-center">
            <PeriodControl base="/admin/revenue" period={period} />
            <a href={hrefWith('/admin/revenue/export', { period })} download className={buttonClass('secondary', 'm', false, 'gap-2')}>
              <Icon name="download" size={20} />
              {t('adminRevenue.export')}
            </a>
          </div>
        }
      />

      <div className="flex flex-wrap gap-8">
        <div className="min-w-0 flex-[3_1_752px] max-nav:*:auto-rows-fr"><TileGrid>
          <Tile label={t('adminRevenue.tile.revenue.label')} value={amount(tiles.revenue)} sub={t('adminRevenue.tile.revenue.sub')} />
          <Tile label={t('adminRevenue.tile.purchases.label')} value={number.format(tiles.purchases)} sub={t('adminRevenue.tile.purchases.sub')} />
          <Tile label={t('adminRevenue.tile.average.label')} value={amount(tiles.average)} sub={t('adminRevenue.tile.average.sub')} />
          <Tile label={t('adminRevenue.tile.paying.label')} value={number.format(tiles.paying)} sub={t('adminRevenue.tile.paying.sub')} />
          <Tile label={t('adminRevenue.tile.notCompleted.label')} value={number.format(tiles.notCompleted)} sub={t('adminRevenue.tile.notCompleted.sub')} />
          <Tile label={t('adminRevenue.tile.refunds.label')} value={amount(tiles.refunds)} sub={tiles.refundsPending ? t('adminRevenue.tile.refunds.pending', { amount: tiles.refundsPending }) : t('adminRevenue.tile.refunds.sub')} />
        </TileGrid></div>
        <div className="flex min-w-0 flex-[2_1_496px] flex-col [&>*]:flex-1">
          <ChartCard period={period} initial={chart} title={t('adminRevenue.chart')} />
        </div>
      </div>

      <Section id="h-packs" title={t('adminRevenue.packs.title')}>
        <DataTable
          caption={t('adminRevenue.packs.caption')}
          minWidth={720}
          columns={[
            { key: 'pack', header: t('adminRevenue.packs.pack') },
            { key: 'price', header: t('adminRevenue.packs.price'), numeric: true },
            { key: 'credits', header: t('adminRevenue.packs.credits'), numeric: true },
            { key: 'sold', header: t('adminRevenue.packs.sold'), numeric: true },
            { key: 'revenue', header: t('adminRevenue.packs.revenue'), numeric: true },
            { key: 'share', header: t('adminRevenue.packs.share'), numeric: true },
          ]}
          rows={packs.map((p) => ({
            id: p.id,
            cells: {
              pack: <span className="whitespace-nowrap">{t('adminRevenue.packs.name', { name: p.name })}</span>,
              price: p.price ?? t('adminRevenue.placeholder.price'),
              credits: number.format(p.credits),
              sold: number.format(p.sold),
              revenue: amount(p.revenue),
              share: p.share ?? t('adminRevenue.placeholder.percent'),
            },
          }))}
        />
      </Section>

      {uncredited.length > 0 && (
        <Section id="h-uncredited" title={t('adminRevenue.uncredited.title')}>
          <DataTable
            caption={t('adminRevenue.uncredited.title')}
            minWidth={880}
            columns={[
              { key: 'date', header: t('adminRevenue.purchases.date') },
              { key: 'user', header: t('adminRevenue.purchases.user') },
              { key: 'pack', header: t('adminRevenue.purchases.pack') },
              { key: 'amount', header: t('adminRevenue.purchases.amount'), numeric: true },
              { key: 'why', header: t('adminRevenue.uncredited.why') },
            ]}
            rows={uncredited.map((u) => ({
              id: u.id,
              cells: {
                date: <span className="whitespace-nowrap">{formatDate(u.at, locale)}</span>,
                user: <UserCell userId={u.userId} email={u.email} />,
                pack: <span className="whitespace-nowrap">{t('adminRevenue.packs.name', { name: u.packName })}</span>,
                amount: u.amount,
                why: <span className="text-13 leading-snug text-warn">{t(`adminRevenue.uncredited.reason.${u.reason}`)}</span>,
              },
            }))}
          />
        </Section>
      )}

      <Section id="h-purchases" title={t('adminRevenue.purchases.title')}>
        <DataTable
          caption={t('adminRevenue.purchases.title')}
          minWidth={1120}
          columns={[
            { key: 'date', header: t('adminRevenue.purchases.date') },
            { key: 'user', header: t('adminRevenue.purchases.user') },
            { key: 'pack', header: t('adminRevenue.purchases.pack') },
            { key: 'credits', header: t('adminRevenue.purchases.credits'), numeric: true },
            { key: 'amount', header: t('adminRevenue.purchases.amount'), numeric: true },
            { key: 'tax', header: t('adminRevenue.purchases.tax'), numeric: true },
            { key: 'invoice', header: t('adminRevenue.purchases.invoice') },
            { key: 'status', header: t('adminRevenue.purchases.status') },
            { key: 'actions', header: t('adminRevenue.purchases.actions'), numeric: true, srOnlyHeader: true },
          ]}
          rows={purchases.map((p) => {
            const marked = mark !== null && p.status === mark;
            return {
              id: p.id,
              cells: {
                date: <span className="whitespace-nowrap">{formatDate(p.at, locale)}</span>,
                user: <UserCell userId={p.userId} email={p.email} />,
                pack: <span className="whitespace-nowrap">{t('adminRevenue.packs.name', { name: p.packName })}</span>,
                credits: number.format(p.credits),
                amount: amount(p.amount),
                tax: p.tax && p.total ? (
                  <span className="flex flex-col gap-0.5">
                    <span>{p.tax}</span>
                    <span className="text-13 leading-snug whitespace-nowrap text-text-3">{t('adminRevenue.purchases.charged', { total: p.total })}</span>
                  </span>
                ) : t('adminRevenue.placeholder.amount'),
                invoice: p.invoiceId ? (
                  <span className="inline-flex items-center gap-3 whitespace-nowrap">
                    {p.invoiceNumber}
                    {p.invoiceUrl ? (
                      <a href={p.invoiceUrl} target="_blank" rel="noopener noreferrer" className="-mx-2 -my-3 inline-flex min-h-11 items-center px-2 text-15 font-medium text-text underline decoration-edge-strong underline-offset-4">
                        {t('adminRevenue.purchases.pdf')}
                      </a>
                    ) : (
                      <Link href={`/invoices/${p.invoiceId}`} className="-mx-2 -my-3 inline-flex min-h-11 items-center px-2 text-15 font-medium text-text underline decoration-edge-strong underline-offset-4">
                        {t('adminRevenue.purchases.view')}
                      </Link>
                    )}
                  </span>
                ) : (
                  <span className="whitespace-nowrap">{t('adminRevenue.purchases.noInvoice')}</span>
                ),
                status: (
                  <span data-marked={marked || undefined} className={marked ? '-mx-2 -my-1 inline-flex rounded-8 bg-raised px-2 py-1' : 'inline-flex'}>
                    <span className="flex flex-col gap-0.5">
                      <StatusLine kind={PURCHASE_KIND[p.status]} className="whitespace-nowrap">{t(`adminActions.purchaseStatus.${p.status}`)}</StatusLine>
                      {p.by && <span className="text-13 leading-snug whitespace-nowrap text-text-3">{t('adminRevenue.purchases.by', { name: p.by })}</span>}
                      {p.review && <span className="max-w-70 text-13 leading-snug text-warn">{p.review !== 'refund-review' || p.status === 'refund-sent' || p.status === 'refunded' ? t(`adminRevenue.purchases.review.${p.review}`) : p.refundAmountUnknown ? t('adminRevenue.purchases.review.refund-amount-unknown') : p.partRefund ? t('adminRevenue.purchases.review.refund-partial', { amount: p.partRefund }) : t('adminRevenue.purchases.review.refund-review')}</span>}
                    </span>
                  </span>
                ),
                actions: p.status === 'refund-requested' || p.status === 'refund-failed' ? <RefundButton purchase={p} again={p.status === 'refund-failed'} /> : '',
              },
            };
          })}
          empty={{ text: t('adminRevenue.purchases.empty') }}
        />
        <Pager shown={purchases.length} total={purchases.length} />
      </Section>
    </div>
  );
}
