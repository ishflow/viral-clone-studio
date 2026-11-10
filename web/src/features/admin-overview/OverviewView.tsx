'use client';

import Link from 'next/link';
import { useLocale, useT } from '@/core/i18n/I18nProvider';
import type { OverviewNumbers, Period } from '@/data/ports';
import { formatDate } from '@/shared/lib/format';
import { DataTable, Icon, PageHead, Segmented, StatusLine, Tile, TileGrid } from '@/shared/ui';
import { PERIODS } from '@/core/period';
import { Notice } from '@/shared/ui/Notice';
import { ChartCard } from '../admin-common/ChartCard';
import type { BarDay } from '@/shared/ui';

export type OverviewPurchase = { id: string; at: string; userId: string; email: string | null; packName: string; amount: string | null;
  /** The money went back (or its refund is sent): the row stays in the list, tagged, because it is not in the revenue. */
  refunded: boolean };
export type OverviewSignup = { id: string; joinedAt: string; email: string; verified: boolean; firstVideo: 'done' | 'running' | 'stopped' | 'none' };

const firstKind = { done: 'done', running: 'running', stopped: 'stopped', none: 'waiting' } as const;
const USER_LINK = 'inline-block max-w-none truncate align-middle max-nav:max-w-48 leading-11 -my-3 text-15 font-medium text-text underline decoration-edge-strong underline-offset-4 hover:decoration-text';

/** "Verified" is a quiet check; "Not verified" is the open ring (as on the board). */
function VerifiedMark({ verified, label }: { verified: boolean; label: string }) {
  return verified ? (
    <span className="flex items-center gap-2 whitespace-nowrap">
      <Icon name="done" size={18} strokeWidth={2.6} className="text-text-3" />
      {label}
    </span>
  ) : (
    <StatusLine kind="waiting" className="whitespace-nowrap">{label}</StatusLine>
  );
}

function Group({ id, title, flex, children }: { id: string; title: string; flex: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className={`flex min-w-0 flex-col gap-4 ${flex}`}>
      <h2 id={id} className="m-0 heading-6">{title}</h2>
      {children}
    </section>
  );
}

function SeeAll({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center gap-2 self-start text-15 font-medium text-accent-text no-underline hover:text-text">
      {children}
      <Icon name="forward" size={18} />
    </Link>
  );
}

/** `/admin`: numbers for the chosen period, what needs attention, the latest purchases and sign-ups. */
export function OverviewView({ period, numbers, purchases, signups, chart, outOfCredits = false }: { period: Period; numbers: OverviewNumbers; purchases: OverviewPurchase[]; signups: OverviewSignup[]; chart: BarDay[] | null; outOfCredits?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const number = new Intl.NumberFormat(locale);
  const n = (value: number) => number.format(value);
  const amount = (value: string | null) => value ?? t('adminOverview.placeholder.amount');
  const attention = [
    { key: 'stopped', href: '/admin/jobs?status=stopped', count: numbers.stoppedJobs, warn: true },
    { key: 'refunds', href: '/admin/revenue?status=refund-requested', count: numbers.refundRequests, warn: false },
    { key: 'payments', href: '/admin/revenue?status=not-completed', count: numbers.paymentsNotCompleted, warn: false },
    { key: 'templates', href: '/admin/templates/inbox', count: numbers.templatesWaiting, warn: false },
  ] as const;
  return (
    <div className="flex flex-col gap-8">
      <PageHead
        title={t('adminOverview.title')}
        lead={t('adminOverview.lead')}
        actions={
          <div className="flex w-full flex-col items-stretch nav:w-auto">
          <Segmented
            label={t('adminOverview.period.label')}
            value={period}
            options={PERIODS.map((value) => ({ value, label: t(`adminOverview.period.${value}`) }))}
            hrefFor={(value) => `/admin?period=${value}`}
            className="max-nav:w-full"
          />
          </div>
        }
      />

      {outOfCredits && (
        <div className="rounded-16 border border-warn bg-surface p-4">
          <Notice className="text-15 font-semibold">{t('adminSettings.provider.outOfCredits')}</Notice>
        </div>
      )}

      <div className="flex flex-wrap gap-8">
        <Group id="h-customers" title={t('adminOverview.customers.title')} flex="flex-[2_1_496px]">
          <TileGrid>
            <Tile label={t('adminOverview.customers.users.label')} value={n(numbers.users)} sub={t('adminOverview.customers.users.sub')} />
            <Tile label={t('adminOverview.customers.signups.label')} value={n(numbers.newSignUps)} sub={t('adminOverview.customers.signups.sub')} />
            <Tile label={t('adminOverview.customers.verified.label')} value={n(numbers.verified)} sub={t('adminOverview.customers.verified.sub')} />
            <Tile label={t('adminOverview.customers.paying.label')} value={n(numbers.payingUsers)} sub={t('adminOverview.customers.paying.sub')} />
          </TileGrid>
        </Group>
        <Group id="h-money" title={t('adminOverview.money.title')} flex="flex-[3_1_752px]">
          <TileGrid>
            <Tile label={t('adminOverview.money.revenue.label')} value={amount(numbers.revenue)} sub={t('adminOverview.money.revenue.sub')} />
            <Tile label={t('adminOverview.money.sold.label')} value={n(numbers.creditsSold)} sub={t('adminOverview.money.sold.sub')} />
            <Tile label={t('adminOverview.money.spent.label')} value={n(numbers.creditsSpent)} sub={t('adminOverview.money.spent.sub')} />
            <Tile label={t('adminOverview.money.free.label')} value={n(numbers.freeVideosUsed)} sub={t('adminOverview.money.free.sub')} />
            <Tile label={t('adminOverview.money.cost.label')} value={amount(numbers.generationCost)} sub={t('adminOverview.money.cost.sub')} />
            <Tile label={t('adminOverview.money.margin.label')} value={amount(numbers.margin)} sub={t('adminOverview.money.margin.sub')} />
          </TileGrid>
        </Group>
      </div>

      <div className="flex flex-wrap gap-8">
        <Group id="h-attention" title={t('adminOverview.attention.title')} flex="flex-[1_1_560px]">
          <ul className="m-0 flex flex-1 list-none flex-col rounded-16 border border-line bg-surface p-0">
            {attention.map((row, i) => (
              <li key={row.key} className={`flex flex-1 ${i > 0 ? 'border-t border-line' : ''}`}>
                <Link href={row.href} className="box-border flex min-h-18 flex-1 items-center gap-4 px-6 py-3 text-text no-underline hover:bg-raised">
                  <span className={`min-w-24 heading-5 tabular-nums ${row.warn ? 'text-warn' : 'text-text'}`}>{n(row.count)}</span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-center gap-2 text-15 leading-snug font-semibold">
                      {t(`adminOverview.attention.${row.key}.title`)}
                      {row.warn && <span className="flex text-warn"><Icon name="warning" size={18} /></span>}
                    </span>
                    <span className="text-13 leading-snug text-text-3">{t(`adminOverview.attention.${row.key}.text`)}</span>
                  </span>
                  <span className="flex text-text-3"><Icon name="forward" size={20} /></span>
                </Link>
              </li>
            ))}
          </ul>
        </Group>
        <Group id="h-chart" title={t('adminOverview.chart.title')} flex="flex-[1_1_560px]">
          <ChartCard period={period} initial={chart} title={t('adminOverview.chart.label')} showTitle={false} />
        </Group>
      </div>

      <div className="flex flex-wrap gap-8">
        <Group id="h-buy" title={t('adminOverview.purchases.title')} flex="flex-[1_1_560px]">
          <DataTable
            caption={t('adminOverview.purchases.title')}
            minWidth={480}
            columns={[
              { key: 'date', header: t('adminOverview.purchases.date') },
              { key: 'user', header: t('adminOverview.purchases.user') },
              { key: 'pack', header: t('adminOverview.purchases.pack') },
              { key: 'amount', header: t('adminOverview.purchases.amount'), numeric: true },
            ]}
            rows={purchases.map((p) => ({
              id: p.id,
              cells: {
                date: <span className="whitespace-nowrap">{formatDate(p.at, locale)}</span>,
                // A purchase outlives its account: then there is no email and no user page to link to.
                user: p.email === null
                  ? <span className="whitespace-nowrap text-text-3">{t('common.admin.deletedAccount')}</span>
                  : <Link href={`/admin/users/${p.userId}`} title={p.email} className={USER_LINK}>{p.email}</Link>,
                pack: (
                  <span className="flex flex-wrap items-center gap-x-3">
                    <span className="whitespace-nowrap">{t('adminOverview.purchases.packName', { name: p.packName })}</span>
                    {p.refunded && <StatusLine kind="waiting" className="whitespace-nowrap">{t('adminOverview.purchases.refunded')}</StatusLine>}
                  </span>
                ),
                amount: amount(p.amount),
              },
            }))}
            empty={{ text: t('adminOverview.purchases.empty') }}
          />
          <SeeAll href="/admin/revenue">{t('adminOverview.purchases.all')}</SeeAll>
        </Group>
        <Group id="h-new" title={t('adminOverview.signups.title')} flex="flex-[1_1_560px]">
          <DataTable
            caption={t('adminOverview.signups.title')}
            minWidth={520}
            columns={[
              { key: 'date', header: t('adminOverview.signups.date') },
              { key: 'user', header: t('adminOverview.signups.user') },
              { key: 'email', header: t('adminOverview.signups.email') },
              { key: 'first', header: t('adminOverview.signups.firstVideo') },
            ]}
            rows={signups.map((s) => ({
              id: s.id,
              cells: {
                date: <span className="whitespace-nowrap">{formatDate(s.joinedAt, locale)}</span>,
                user: <Link href={`/admin/users/${s.id}`} title={s.email} className={USER_LINK}>{s.email}</Link>,
                email: <VerifiedMark verified={s.verified} label={t(s.verified ? 'adminOverview.signups.verified' : 'adminOverview.signups.notVerified')} />,
                first: <StatusLine kind={firstKind[s.firstVideo]} className="whitespace-nowrap">{t(`adminOverview.signups.first.${s.firstVideo}`)}</StatusLine>,
              },
            }))}
            empty={{ text: t('adminOverview.signups.empty') }}
          />
          <SeeAll href="/admin/users">{t('adminOverview.signups.all')}</SeeAll>
        </Group>
      </div>
    </div>
  );
}
