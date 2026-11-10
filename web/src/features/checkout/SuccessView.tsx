'use client';

import Link from 'next/link';
import { useLocale, useT } from '@/core/i18n/I18nProvider';
import { formatDate, taxOf } from '@/shared/lib/format';
import { Card, Icon, LinkButton } from '@/shared/ui';
import { DEFAULT_RETURN, type Draft } from './draft-view';
import { DraftSummary } from './DraftCard';

export interface Receipt { packName: string; packId: string; credits: number; amount: string | null; at: string; invoiceId: string | null; taxCents?: number; totalCents?: number; invoiceUrl?: string }

export function SuccessView({ receipt, balance, returnTo, draft }: { receipt: Receipt; balance: number; returnTo: string; draft: Draft | null }) {
  const t = useT();
  const locale = useLocale();
  const count = (n: number) => t('common.credits.count', { count: n });
  // The provider added tax on top of the pack price: the receipt says what the total it charged is made of.
  const taxed = taxOf(receipt);
  const price = receipt.amount ?? t('checkout.success.amount');
  const paid: [string, string][] = taxed
    ? [[t('checkout.success.price'), price], [t('checkout.success.tax'), taxed.tax], [t('checkout.success.paid'), taxed.total]]
    : [[t('checkout.success.paid'), price]];
  const rows: [string, string][] = [
    [t('checkout.success.pack'), t('checkout.success.packName', { name: receipt.packName })],
    [t('checkout.success.credits'), String(receipt.credits)],
    ...paid,
    [t('checkout.success.date'), formatDate(receipt.at, locale)],
  ];
  return (
    <div className="flex flex-col gap-12 pt-4">
      <section className="flex flex-col gap-3">
        <span className="flex items-center gap-2 text-15 font-semibold text-accent-text">
          <Icon name="done" size={18} strokeWidth={2.6} />
          {t('checkout.success.status')}
        </span>
        <h1 className="m-0 heading-3">{t('checkout.success.title', { credits: count(receipt.credits) })}</h1>
        <p className="m-0 max-w-155 text-17 leading-normal text-text-2 text-pretty">{t('checkout.success.text', { balance: count(balance) })}</p>
        {!draft && (
          // Bought from somewhere that is not a generate form (a stopped job, the account page): that place first, the gallery second.
          <div className="mt-3 flex flex-col gap-3 nav:flex-row">
            {returnTo !== DEFAULT_RETURN && <LinkButton href={returnTo} size="l">{t('checkout.success.back')}</LinkButton>}
            <LinkButton href="/gallery" size="l" variant={returnTo === DEFAULT_RETURN ? 'primary' : 'secondary'}>{t('checkout.success.browse')}</LinkButton>
          </div>
        )}
      </section>
      <div className="flex flex-wrap items-start gap-8">
        {draft && (
          <Card as="section" aria-labelledby="h-draft" className="flex min-w-0 flex-[1_1_420px] flex-col gap-6">
            <h2 id="h-draft" className="m-0 heading-5">{t('checkout.success.waiting.title')}</h2>
            <DraftSummary draft={draft} />
            <p className="m-0 text-15 leading-normal text-text-2">{t('checkout.saved')}</p>
            <div className="flex flex-col gap-3 nav:flex-row">
              <LinkButton href={returnTo} size="l">{t('checkout.success.waiting.back')}</LinkButton>
              <LinkButton href="/gallery" variant="secondary" size="l">{t('checkout.success.browse')}</LinkButton>
            </div>
          </Card>
        )}
        <Card as="section" aria-labelledby="h-receipt" className="flex min-w-0 flex-[1_1_420px] flex-col gap-3">
          <h2 id="h-receipt" className="m-0 mb-1 heading-5">{t('checkout.success.receipt')}</h2>
          <dl className="m-0 flex flex-col">
            {rows.map(([label, value]) => (
              <div key={label} className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-line py-3 text-15">
                <dt className="text-text-2">{label}</dt>
                <dd className="m-0 ml-auto text-right font-semibold wrap-anywhere">{value}</dd>
              </div>
            ))}
          </dl>
          {receipt.invoiceUrl && (
            // The payment provider is the seller, and its invoice is on its own site: the site's own page stays below it, so one is left if the other does not open.
            <a href={receipt.invoiceUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center gap-2 self-start text-15 font-medium no-underline">
              <Icon name="download" size={18} />
              {t('checkout.success.invoiceDodo')}
            </a>
          )}
          {receipt.invoiceId && (
            <Link href={`/invoices/${receipt.invoiceId}`} className="flex min-h-11 items-center gap-2 self-start text-15 font-medium no-underline">
              <Icon name="download" size={18} />
              {t('checkout.success.invoice')}
            </Link>
          )}
        </Card>
      </div>
    </div>
  );
}
