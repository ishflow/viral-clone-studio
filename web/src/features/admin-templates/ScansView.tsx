'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useLocale, useT } from '@/core/i18n/I18nProvider';
import { Button, DataTable, Icon, LinkButton, PageHead, Pager, Segmented, StatusLine, Tile, TileGrid } from '@/shared/ui';
import { runScanNow, type ActionState } from './actions';
import { reasonLabel } from './labels';
import type { ScansData } from './load';
import { SCAN_PERIODS, scansHref, type ScanPeriod } from './query';
import { TemplatesNav } from './TemplatesNav';

const IDLE: ActionState = { status: 'idle' };

function RunScan() {
  const t = useT();
  const [state, action, pending] = useActionState(runScanNow, IDLE);
  return (
    <form action={action} className="flex flex-col gap-2 max-nav:w-full">
      <Button type="submit" variant="secondary" pending={pending} className="max-nav:w-full">{t('adminTemplates.scans.run')}</Button>
      <p role="status" className="m-0 text-13 leading-snug text-accent-text empty:hidden">{state.status === 'done' ? t('adminTemplates.scans.started') : ''}</p>
      {state.status === 'error' && <p role="alert" className="m-0 text-13 leading-snug text-warn">{t('adminTemplates.scans.failed')}</p>}
    </form>
  );
}

/** `/admin/templates/scans`. */
export function ScansView({ scans, total, period, threshold, published, times, next, tomorrow }: ScansData) {
  const t = useT();
  const when = t(tomorrow ? 'adminTemplates.when.tomorrow' : 'adminTemplates.when.today', { time: next });
  const locale = useLocale();
  const number = new Intl.NumberFormat(locale);
  const hourFormat = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const dateFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  const sum = (key: 'checked' | 'aboveThreshold' | 'prepared') => scans.reduce((n, scan) => n + scan[key], 0);
  return (
    <div className="flex flex-col gap-8">
      <TemplatesNav current="scans" />
      <PageHead
        title={t('adminTemplates.scans.title')}
        lead={t('adminTemplates.scans.lead')}
        actions={
          <>
            <Segmented
              label={t('adminTemplates.scans.periodLabel')}
              value={period}
              options={SCAN_PERIODS.map((value) => ({ value, label: t(`adminTemplates.scans.period.${value}`) }))}
              hrefFor={(value) => scansHref(value as ScanPeriod)}
              className="max-nav:w-full"
            />
            <RunScan />
          </>
        }
      />
      <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-15 leading-snug text-text">
        <span className="flex items-center gap-3 text-text-2"><Icon name="clock" size={20} />
          <span className="text-text">{t('adminTemplates.scans.schedule', { count: times.length, times: times.join(', '), next: when })}</span>
        </span>
        <Link href="/admin/settings" className="inline-flex min-h-11 items-center font-medium text-accent-text no-underline hover:text-text">{t('adminTemplates.scans.changeTimes')}</Link>
      </p>
      <TileGrid lead>
        <Tile label={t('adminTemplates.scans.tile.scans.label')} value={number.format(scans.length)} sub={t('adminTemplates.scans.tile.scans.sub')} />
        <Tile label={t('adminTemplates.scans.tile.checked.label')} value={number.format(sum('checked'))} sub={t('adminTemplates.scans.tile.checked.sub')} />
        <Tile label={t('adminTemplates.scans.tile.above.label')} value={number.format(sum('aboveThreshold'))} sub={t('adminTemplates.scans.tile.above.sub', { threshold })} />
        <Tile label={t('adminTemplates.scans.tile.prepared.label')} value={number.format(sum('prepared'))} sub={t('adminTemplates.scans.tile.prepared.sub')} />
        <Tile label={t('adminTemplates.scans.tile.published.label')} value={number.format(published)} sub={t('adminTemplates.scans.tile.published.sub')} />
      </TileGrid>
      <section aria-label={t('adminTemplates.scans.caption')} className="flex flex-col gap-4">
        <DataTable
          caption={t('adminTemplates.scans.caption')}
          minWidth={960}
          columns={[
            { key: 'started', header: t('adminTemplates.scans.col.started') },
            { key: 'source', header: t('adminTemplates.scans.col.source') },
            { key: 'checked', header: t('adminTemplates.scans.col.checked'), numeric: true },
            { key: 'queued', header: t('adminTemplates.scans.col.queued'), numeric: true },
            { key: 'above', header: t('adminTemplates.scans.col.above'), numeric: true },
            { key: 'prepared', header: t('adminTemplates.scans.col.prepared'), numeric: true },
            { key: 'status', header: t('adminTemplates.scans.col.status') },
            { key: 'actions', header: t('adminTemplates.scans.col.actions'), numeric: true, srOnlyHeader: true },
          ]}
          rows={scans.map((scan) => ({
            id: scan.id,
            cells: {
              started: <span className="whitespace-nowrap">{`${dateFormat.format(new Date(scan.startedAt))} · ${hourFormat.format(new Date(scan.startedAt))}`}</span>,
              source: <span className="whitespace-nowrap">{t(`adminTemplates.source.${scan.source}`)}</span>,
              checked: number.format(scan.checked),
              queued: number.format(scan.queued ?? 0),
              above: number.format(scan.aboveThreshold),
              prepared: number.format(scan.prepared),
              status: (
                <span className="flex flex-col gap-1">
                  <StatusLine kind={scan.status} className="whitespace-nowrap">{t(`common.status.${scan.status}`)}</StatusLine>
                  {(scan.status === 'stopped' || (scan.status === 'done' && scan.reason === 'no-matching-industry')) && <span className="max-w-72 min-w-56 pl-5 text-13 leading-snug font-normal text-pretty text-text-3">{reasonLabel(t, scan.reason)}</span>}
                </span>
              ),
              actions: (
                <Link href={`/admin/templates/inbox?source=${scan.source}`} className="-m-3 inline-flex min-h-11 items-center px-3 text-15 font-medium whitespace-nowrap text-accent-text no-underline hover:text-text">
                  {t('adminTemplates.scans.openCandidates')}
                </Link>
              ),
            },
          }))}
          empty={{ text: t('adminTemplates.scans.empty.text'), action: <LinkButton href={scansHref('all')} variant="secondary">{t('adminTemplates.scans.empty.clear')}</LinkButton> }}
        />
        <Pager shown={scans.length} total={total} />
      </section>
    </div>
  );
}
