'use client';

import Link from 'next/link';
import { useLocale, useT } from '@/core/i18n/I18nProvider';
import { formatDate, formatName, formatReference } from '@/shared/lib/format';
import { DataTable, Icon, LinkButton, PageHead, Pager, Segmented, StatusLine, MediaImage } from '@/shared/ui';
import { secLabel } from './labels';
import type { ListData } from './load';
import { listHref, TEMPLATE_FILTERS, type TemplateFilter } from './query';
import { SwapTag } from './SwapTag';
import { TemplatesNav } from './TemplatesNav';

/** `/admin/templates`. */
export function ListView({ rows, total, status, q }: ListData) {
  const t = useT();
  const locale = useLocale();
  const number = new Intl.NumberFormat(locale);
  return (
    <div className="flex flex-col gap-8">
      <TemplatesNav current="all" />
      <PageHead
        title={t('adminTemplates.list.title')}
        lead={t('adminTemplates.list.lead')}
        actions={
          <>
            <LinkButton href="/admin/templates/new-swap" variant="secondary" className="gap-2">
              <Icon name="add" size={20} />
              {t('adminTemplates.list.addSwap')}
            </LinkButton>
            <LinkButton href="/admin/templates/inbox" variant="secondary" className="gap-2">
              <Icon name="link" size={20} />
              {t('adminTemplates.list.addLink')}
            </LinkButton>
          </>
        }
      />
      <section aria-label={t('adminTemplates.list.caption')} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <form method="get" action="/admin/templates" role="search" className="relative flex max-w-105 min-w-0 flex-[1_1_320px] items-center max-nav:max-w-none">
            {status !== 'all' && <input type="hidden" name="status" value={status} />}
            <label htmlFor="template-search" className="sr-only">{t('adminTemplates.list.searchLabel')}</label>
            <span aria-hidden="true" className="pointer-events-none absolute left-4 flex text-text-3"><Icon name="search" size={20} /></span>
            <input
              id="template-search" type="search" name="q" defaultValue={q} placeholder={t('adminTemplates.list.searchPlaceholder')}
              className="box-border min-h-13 w-full rounded-12 border border-edge-strong bg-bg py-0 pr-4 pl-12 text-15 text-text"
            />
          </form>
          <Segmented
            label={t('adminTemplates.list.filterLabel')}
            value={status}
            options={TEMPLATE_FILTERS.map((value) => ({ value, label: t(`adminTemplates.list.filter.${value}`) }))}
            hrefFor={(value) => listHref({ status: value as TemplateFilter, q })}
            className="max-nav:w-full"
          />
        </div>
        <DataTable
          caption={t('adminTemplates.list.caption')}
          minWidth={1280}
          columns={[
            { key: 'template', header: t('adminTemplates.list.col.template') },
            { key: 'category', header: t('adminTemplates.list.col.category') },
            { key: 'format', header: t('adminTemplates.list.col.format') },
            { key: 'length', header: t('adminTemplates.list.col.length') },
            { key: 'views', header: t('adminTemplates.list.col.views'), numeric: true },
            { key: 'generated', header: t('adminTemplates.list.col.generated'), numeric: true },
            { key: 'status', header: t('adminTemplates.list.col.status') },
            { key: 'sample', header: t('adminTemplates.list.col.sample') },
            { key: 'edited', header: t('adminTemplates.list.col.edited') },
            { key: 'actions', header: t('adminTemplates.list.col.actions'), numeric: true, srOnlyHeader: true },
          ]}
          rows={rows.map((row) => ({
            id: row.id,
            cells: {
              template: (
                <span className="flex min-w-64 items-center gap-4">
                  <span className="relative block h-19.5 w-11 shrink-0 overflow-hidden rounded-8 bg-raised">
                    {row.image ? <MediaImage src={row.image} alt="" fill sizes="44px" className="object-cover" /> : row.referenceImage ? <img src={row.referenceImage} alt="" className="size-full object-cover" /> : <span aria-hidden="true" className="block size-full animate-pulse bg-raised motion-reduce:animate-none" />}
                  </span>
                  <span className="flex flex-col items-start gap-1.5">
                    <span className="font-medium text-text">{row.title}</span>
                    {row.swapVideo && <SwapTag />}
                  </span>
                </span>
              ),
              category: <span className="whitespace-nowrap">{row.category || t('adminTemplates.list.noCategory')}</span>,
              format: <span className="whitespace-nowrap">{formatName(row.format, t)}</span>,
              length: <span className="whitespace-nowrap">{secLabel(t, row.seconds)}</span>,
              views: <span className="whitespace-nowrap">{formatReference(row, t)}</span>,
              generated: number.format(row.timesGenerated),
              status:
                row.preparation === 'failed' || row.preparation === 'preparing' ? <StatusLine kind={row.preparation === 'failed' ? 'stopped' : 'waiting'}>{t(`adminTemplates.preparation.${row.preparation}`)}</StatusLine> : row.status === 'private' ? (
                  <span className="flex items-start gap-2">
                    <span className="mt-0.5 text-text-2"><Icon name="private" size={18} /></span>
                    <span className="flex flex-col whitespace-nowrap"><span className="text-15 font-semibold text-text">{t('adminTemplates.status.private')}</span><span className="text-13 text-text-3">{t('adminTemplates.status.privateNote')}</span></span>
                  </span>
                ) : (
                  <StatusLine kind={row.status === 'published' ? 'done' : row.status === 'waiting' ? 'waiting' : 'stopped'} className="whitespace-nowrap">
                    {t(`adminTemplates.status.${row.status}`)}
                  </StatusLine>
                ),
              sample:
                row.sample === 'outdated' ? (
                  <span className="flex items-center gap-2 whitespace-nowrap text-15 font-semibold text-warn"><Icon name="warning" size={18} />{t('adminTemplates.list.sample.outdated')}</span>
                ) : row.sample === 'current' ? (
                  <span className="flex items-center gap-2 whitespace-nowrap text-15 text-text-2"><Icon name="done" size={18} strokeWidth={2.6} />{t('adminTemplates.list.sample.current')}</span>
                ) : (
                  <span className="whitespace-nowrap text-15 text-text-3">{t('adminTemplates.list.sample.none')}</span>
                ),
              edited: <span className="whitespace-nowrap">{formatDate(row.editedAt, locale)}</span>,
              actions: (
                <Link href={`/admin/templates/${row.id}`} className="-m-3 inline-flex min-h-11 items-center px-3 text-15 font-medium text-accent-text no-underline hover:text-text">
                  {t('adminTemplates.list.edit')}
                </Link>
              ),
            },
          }))}
          empty={{ text: t('adminTemplates.list.empty.text'), action: <LinkButton href="/admin/templates" variant="secondary">{t('adminTemplates.list.empty.clear')}</LinkButton> }}
        />
        <Pager shown={rows.length} total={total} />
      </section>
    </div>
  );
}
