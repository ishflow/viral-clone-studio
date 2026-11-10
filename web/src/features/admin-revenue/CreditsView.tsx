'use client';

import { useLocale, useT } from '@/core/i18n/I18nProvider';
import type { LedgerEntry, LedgerType, Period, SpendingRow } from '@/data/ports';
import { DataTable, PageHead, Pager, Segmented, Tile, TileGrid } from '@/shared/ui';
import { LedgerTable, type PurchaseRef } from '../admin-common/LedgerTable';
import { hrefWith, LEDGER_TYPES } from './query';
import { PeriodControl, RevenueTabs } from './RevenueView';

export type CreditsViewProps = {
  period: Period;
  type: LedgerType | undefined;
  tiles: { sold: number; spent: number; unspent: number; free: number; admin: number; refunded: number };
  spending: { byQuality: SpendingRow[]; byFormat: SpendingRow[] };
  ledger: (LedgerEntry & { email: string | null })[];
  /** purchase id → invoice number and link, for the "Related" column. */
  purchases: Record<string, PurchaseRef>;
};

/** `/admin/revenue/credits`: every credit that was sold, given or spent. */
export function CreditsView({ period, type, tiles, spending, ledger, purchases }: CreditsViewProps) {
  const t = useT();
  const locale = useLocale();
  const number = new Intl.NumberFormat(locale);
  const spendingTable = (caption: string, rows: SpendingRow[], labelKey: 'quality' | 'format') => (
    <DataTable
      caption={caption}
      minWidth={440}
      columns={[
        { key: 'label', header: caption },
        { key: 'jobs', header: t('adminRevenue.credits.jobs'), numeric: true },
        { key: 'credits', header: t('adminRevenue.credits.credits'), numeric: true },
        { key: 'cost', header: t('adminRevenue.credits.cost'), numeric: true },
      ]}
      rows={rows.map((r) => ({
        id: r.label,
        cells: {
          label: <span className="whitespace-nowrap">{t(`adminRevenue.${labelKey}.${r.label}`)}</span>,
          jobs: number.format(r.jobs),
          credits: number.format(r.credits),
          cost: r.cost ?? t('adminRevenue.placeholder.amount'),
        },
      }))}
    />
  );
  return (
    <div className="flex flex-col gap-8">
      <RevenueTabs current="credits" />
      <PageHead title={t('adminRevenue.credits.title')} lead={t('adminRevenue.credits.lead')} actions={<div className="flex w-full flex-col items-stretch nav:w-auto"><PeriodControl base="/admin/revenue/credits" period={period} /></div>} />

      <div className="flex flex-wrap gap-8">
        <div className="min-w-0 flex-[3_1_752px] max-nav:*:auto-rows-fr"><TileGrid>
          <Tile label={t('adminRevenue.credits.tile.sold.label')} value={number.format(tiles.sold)} sub={t('adminRevenue.credits.tile.sold.sub')} />
          <Tile label={t('adminRevenue.credits.tile.spent.label')} value={number.format(tiles.spent)} sub={t('adminRevenue.credits.tile.spent.sub')} />
          <Tile label={t('adminRevenue.credits.tile.unspent.label')} value={number.format(tiles.unspent)} sub={t('adminRevenue.credits.tile.unspent.sub')} />
          <Tile label={t('adminRevenue.credits.tile.free.label')} value={number.format(tiles.free)} sub={t('adminRevenue.credits.tile.free.sub')} />
          <Tile label={t('adminRevenue.credits.tile.admin.label')} value={number.format(tiles.admin)} sub={t('adminRevenue.credits.tile.admin.sub')} />
          <Tile label={t('adminRevenue.credits.tile.refunded.label')} value={number.format(tiles.refunded)} sub={t('adminRevenue.credits.tile.refunded.sub')} />
        </TileGrid></div>
        <div className="flex min-w-0 flex-[2_1_496px] flex-col gap-4">
          {spendingTable(t('adminRevenue.credits.byQuality'), spending.byQuality, 'quality')}
          {spendingTable(t('adminRevenue.credits.byFormat'), spending.byFormat, 'format')}
        </div>
      </div>

      <section aria-labelledby="h-ledger" className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <h2 id="h-ledger" className="m-0 heading-6">{t('adminRevenue.credits.ledger.title')}</h2>
          <Segmented
            label={t('adminRevenue.credits.ledger.type')}
            value={type ?? 'all'}
            options={[{ value: 'all', label: t('adminRevenue.ledgerFilter.all') }, ...LEDGER_TYPES.map((value) => ({ value, label: t(`adminRevenue.ledgerFilter.${value}`) }))]}
            hrefFor={(value) => hrefWith('/admin/revenue/credits', { period, type: value === 'all' ? undefined : (value as LedgerType) })}
          />
        </div>
        <LedgerTable showUser entries={ledger} purchases={purchases} caption={t('adminRevenue.credits.ledger.title')} empty={t('adminRevenue.credits.ledger.empty')} />
        <Pager shown={ledger.length} total={ledger.length} />
      </section>
    </div>
  );
}
