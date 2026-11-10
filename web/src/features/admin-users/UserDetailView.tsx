'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useLocale, useT } from '@/core/i18n/I18nProvider';
import type { Format, JobStatus, LedgerEntry, PurchaseStatus, Quality } from '@/data/ports';
import { formatDate } from '@/shared/lib/format';
import { Card, DataTable, Icon, StatusLine, Tile, TileGrid } from '@/shared/ui';
import { LedgerTable } from '../admin-common/LedgerTable';
import { JOB_KIND, PURCHASE_KIND } from '../admin-common/status';
import { AccessActions } from './AccessActions';
import { AddCreditsForm } from './AddCreditsForm';

export type DetailPurchase = { id: string; at: string; packName: string; credits: number; amount: string | null; status: PurchaseStatus; invoiceId: string | null; invoiceNumber: string | null;
  /** The provider's own invoice of the payment, where it gave one: the link goes there, and to the site's own page otherwise. */
  invoiceUrl?: string | null };
export type DetailJob = { id: string; startedAt: string; templateTitle: string; format: Format | null; quality: Quality; language: string; credits: number; status: JobStatus };
export type UserDetailProps = {
  user: { id: string; email: string; name: string; joinedAt: string; lastActiveAt: string; verified: boolean; blocked: boolean; block: { at: string; reason: string } | null };
  balance: number; paidTotal: string | null; creditsBought: number; creditsSpent: number; videos: number;
  purchases: DetailPurchase[]; jobs: DetailJob[]; ledger: LedgerEntry[];
  /** The signed-in admin is looking at their own account. */
  isSelf: boolean;
};

const LINK = 'text-accent-text no-underline hover:text-text';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-4">
      <h2 id={id} className="m-0 heading-6">{title}</h2>
      {children}
    </section>
  );
}

/** `/admin/users/[id]`: tiles, the two actions, and the user's purchases, jobs and credit history. */
export function UserDetailView({ user, balance, paidTotal, creditsBought, creditsSpent, videos, purchases, jobs, ledger, isSelf }: UserDetailProps) {
  const t = useT();
  const locale = useLocale();
  const number = new Intl.NumberFormat(locale);
  const amount = (value: string | null) => value ?? t('adminUsers.placeholder.amount');
  return (
    <div className="flex flex-col gap-8">
      <section aria-label={user.email} className="flex flex-col gap-2">
        <Link href="/admin/users" className="flex min-h-11 items-center gap-2 self-start text-15 text-text-3 no-underline hover:text-text">
          <Icon name="back" size={18} />
          {t('adminUsers.detail.back')}
        </Link>
        <div className="flex items-center gap-x-3 nav:flex-wrap nav:gap-x-6 nav:gap-y-3">
          <h1 title={user.email} className="m-0 min-w-0 truncate heading-3">{user.email}</h1>
          <StatusLine kind={user.blocked ? 'stopped' : 'running'} className="shrink-0">{t(user.blocked ? 'adminUsers.status.blocked' : 'adminUsers.status.active')}</StatusLine>
        </div>
        <p className="m-0 text-15 leading-normal text-text-2 text-pretty">
          {t('adminUsers.detail.meta', {
            joined: formatDate(user.joinedAt, locale),
            verified: t(user.verified ? 'adminUsers.detail.emailVerified' : 'adminUsers.detail.emailNotVerified'),
            last: formatDate(user.lastActiveAt, locale),
          })}
        </p>
      </section>

      <TileGrid lead>
        <Tile label={t('adminUsers.detail.tile.balance.label')} value={number.format(balance)} sub={t('adminUsers.detail.tile.balance.sub')} />
        <Tile label={t('adminUsers.detail.tile.paid.label')} value={amount(paidTotal)} sub={t('adminUsers.detail.tile.paid.sub')} />
        <Tile label={t('adminUsers.detail.tile.bought.label')} value={number.format(creditsBought)} sub={t('adminUsers.detail.tile.bought.sub')} />
        <Tile label={t('adminUsers.detail.tile.spent.label')} value={number.format(creditsSpent)} sub={t('adminUsers.detail.tile.spent.sub')} />
        <Tile label={t('adminUsers.detail.tile.videos.label')} value={number.format(videos)} sub={t('adminUsers.detail.tile.videos.sub')} />
      </TileGrid>

      <Section id="h-actions" title={t('adminUsers.detail.actions.title')}>
        <Card className="flex flex-wrap gap-x-12 gap-y-6 max-nav:p-4">
          <AddCreditsForm userId={user.id} balance={balance} />
          <AccessActions userId={user.id} blocked={user.blocked} block={user.block} balance={balance} videos={videos} isSelf={isSelf} />
        </Card>
      </Section>

      <Section id="h-buys" title={t('adminUsers.detail.purchases.title')}>
        <DataTable
          caption={t('adminUsers.detail.purchases.title')}
          minWidth={960}
          columns={[
            { key: 'date', header: t('adminUsers.detail.purchases.date') },
            { key: 'pack', header: t('adminUsers.detail.purchases.pack') },
            { key: 'credits', header: t('adminUsers.detail.purchases.credits'), numeric: true },
            { key: 'amount', header: t('adminUsers.detail.purchases.amount'), numeric: true },
            { key: 'invoice', header: t('adminUsers.detail.purchases.invoice') },
            { key: 'status', header: t('adminUsers.detail.purchases.status') },
          ]}
          rows={purchases.map((p) => ({
            id: p.id,
            cells: {
              date: <span className="whitespace-nowrap">{formatDate(p.at, locale)}</span>,
              pack: <span className="whitespace-nowrap">{t('adminUsers.detail.purchases.packName', { name: p.packName })}</span>,
              credits: number.format(p.credits),
              amount: amount(p.amount),
              invoice: p.invoiceId ? (
                <span className="inline-flex items-center gap-3 whitespace-nowrap">
                  {p.invoiceNumber}
                  {p.invoiceUrl ? (
                    <a href={p.invoiceUrl} target="_blank" rel="noopener noreferrer" className="-mx-2 -my-3 inline-flex min-h-11 items-center px-2 text-15 font-medium text-text underline decoration-edge-strong underline-offset-4">
                      {t('adminUsers.detail.purchases.pdf')}
                    </a>
                  ) : (
                    <Link href={`/invoices/${p.invoiceId}`} className="-mx-2 -my-3 inline-flex min-h-11 items-center px-2 text-15 font-medium text-text underline decoration-edge-strong underline-offset-4">
                      {t('adminUsers.detail.purchases.view')}
                    </Link>
                  )}
                </span>
              ) : (
                <span className="whitespace-nowrap">{t('adminUsers.detail.purchases.noInvoice')}</span>
              ),
              status: <StatusLine kind={PURCHASE_KIND[p.status]} className="whitespace-nowrap">{t(`adminActions.purchaseStatus.${p.status}`)}</StatusLine>,
            },
          }))}
          empty={{ text: t('adminUsers.detail.purchases.empty') }}
        />
      </Section>

      <Section id="h-jobs" title={t('adminUsers.detail.jobs.title')}>
        <DataTable
          caption={t('adminUsers.detail.jobs.title')}
          minWidth={960}
          columns={[
            { key: 'started', header: t('adminUsers.detail.jobs.started') },
            { key: 'template', header: t('adminUsers.detail.jobs.template') },
            { key: 'format', header: t('adminUsers.detail.jobs.format') },
            { key: 'quality', header: t('adminUsers.detail.jobs.quality') },
            { key: 'language', header: t('adminUsers.detail.jobs.language') },
            { key: 'credits', header: t('adminUsers.detail.jobs.credits'), numeric: true },
            { key: 'status', header: t('adminUsers.detail.jobs.status') },
            { key: 'actions', header: t('adminUsers.detail.jobs.actions'), numeric: true, srOnlyHeader: true },
          ]}
          rows={jobs.map((j) => ({
            id: j.id,
            cells: {
              started: <span className="whitespace-nowrap">{formatDate(j.startedAt, locale)}</span>,
              template: <span className="whitespace-nowrap">{j.templateTitle}</span>,
              format: j.format ? <span className="whitespace-nowrap">{t(`adminUsers.format.${j.format}`)}</span> : '',
              quality: <span className="whitespace-nowrap">{t(`adminUsers.quality.${j.quality}`)}</span>,
              language: <span className="whitespace-nowrap">{j.language === 'en' || j.language === 'tr' ? t(`adminUsers.language.${j.language}`) : j.language}</span>,
              credits: j.credits > 0 ? number.format(j.credits) : t('adminUsers.detail.jobs.free'),
              status: <StatusLine kind={JOB_KIND[j.status]} className="whitespace-nowrap">{t(`adminActions.jobStatus.${j.status}`)}</StatusLine>,
              actions: (
                <Link href={`/admin/jobs?job=${j.id}#job-detail`} className={`-m-3 inline-flex min-h-11 min-w-11 items-center justify-center px-3 text-15 font-medium ${LINK}`}>
                  {t('adminUsers.detail.jobs.open')}
                </Link>
              ),
            },
          }))}
          empty={{ text: t('adminUsers.detail.jobs.empty') }}
        />
      </Section>

      <Section id="h-history" title={t('adminUsers.detail.history.title')}>
        <LedgerTable
          caption={t('adminUsers.detail.history.title')}
          entries={ledger}
          purchases={Object.fromEntries(purchases.map((p) => [p.id, { number: p.invoiceNumber, invoiceId: p.invoiceId, invoiceUrl: p.invoiceUrl }]))}
          empty={t('adminUsers.detail.history.empty')}
        />
      </Section>
    </div>
  );
}
