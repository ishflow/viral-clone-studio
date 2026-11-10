'use client';

import Link from 'next/link';
import { useLocale, useT } from '@/core/i18n/I18nProvider';
import type { LedgerEntry } from '@/data/ports';
import { formatDateTime } from '@/shared/lib/format';
import { DataTable } from '@/shared/ui';
import { UserCell } from '../admin-revenue/parts';

export type LedgerRow = LedgerEntry & { email?: string | null };
/** purchase id → what the "Related" column shows and links to: the provider's own invoice where the payment has one, the site's own page otherwise. */
export type PurchaseRef = { number: string | null; invoiceId: string | null; invoiceUrl?: string | null };

const LINK = 'inline-flex min-h-11 -my-3 items-center text-15 font-medium text-text underline decoration-edge-strong underline-offset-4 hover:decoration-text whitespace-nowrap';

/**
 * The credit ledger, as one table for the credits page (`showUser`) and the user's page: date and time, type, change, who did it (`By`),
 * what it belongs to (`Related`: a job or a purchase), the reason, and the balance after. Scrolls sideways in its own box on a phone.
 */
export function LedgerTable({ entries, purchases = {}, showUser, empty, caption }: { entries: LedgerRow[]; purchases?: Record<string, PurchaseRef>; showUser?: boolean; empty: string; caption?: string }) {
  const t = useT();
  const locale = useLocale();
  const number = new Intl.NumberFormat(locale);
  const signed = (n: number) => (n > 0 ? `+${number.format(n)}` : n < 0 ? `−${number.format(-n)}` : '0');
  const by = (e: LedgerEntry) => (e.by.kind === 'admin' ? e.by.name : t(e.by.kind === 'system' ? 'adminActions.ledger.by_system' : 'adminActions.ledger.by_customer'));
  const related = (e: LedgerEntry) => {
    if (e.relatedJobId) return <Link href={`/admin/jobs?job=${encodeURIComponent(e.relatedJobId)}`} className={LINK}>{t('adminActions.ledger.job', { id: e.relatedJobId })}</Link>;
    if (e.relatedPurchaseId) {
      const ref = purchases[e.relatedPurchaseId];
      const label = t('adminActions.ledger.purchase', { number: ref?.number ?? e.relatedPurchaseId });
      if (ref?.invoiceUrl) return <a href={ref.invoiceUrl} target="_blank" rel="noopener noreferrer" className={LINK}>{label}</a>;
      return ref?.invoiceId ? <Link href={`/invoices/${ref.invoiceId}`} className={LINK}>{label}</Link> : <span className="whitespace-nowrap">{label}</span>;
    }
    return '';
  };
  const columns = [
    { key: 'date', header: t('adminActions.ledger.date') },
    ...(showUser ? [{ key: 'user', header: t('adminActions.ledger.user') }] : []),
    { key: 'type', header: t('adminActions.ledger.type') },
    { key: 'change', header: t('adminActions.ledger.change'), numeric: true },
    { key: 'by', header: t('adminActions.ledger.by') },
    { key: 'related', header: t('adminActions.ledger.related') },
    { key: 'reason', header: t('adminActions.ledger.reason') },
    { key: 'after', header: t('adminActions.ledger.balanceAfter'), numeric: true },
  ];
  return (
    <DataTable
      caption={caption ?? t('adminActions.ledger.caption')}
      minWidth={showUser ? 1280 : 1120}
      dense
      columns={columns}
      rows={entries.map((e) => ({
        id: e.id,
        cells: {
          date: <span className="whitespace-nowrap">{formatDateTime(e.at, locale)}</span>,
          user: showUser ? <UserCell userId={e.userId} email={e.email ?? null} /> : '',
          type: <span className="whitespace-nowrap">{t(`adminActions.ledger.typeName.${e.type}`)}</span>,
          change: <span className={`font-semibold ${e.change > 0 ? 'text-accent-text' : 'text-text'}`}>{signed(e.change)}</span>,
          by: <span className="whitespace-nowrap">{by(e)}</span>,
          related: related(e),
          reason: e.reason ?? '',
          after: number.format(e.balanceAfter),
        },
      }))}
      empty={{ text: empty }}
    />
  );
}
