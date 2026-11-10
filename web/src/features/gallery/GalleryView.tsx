'use client';

import Link from 'next/link';
import { useT } from '@/core/i18n/I18nProvider';
import type { Template } from '@/data/ports';
import { cx } from '@/shared/lib/cx';
import { buttonClass, Icon, Segmented, VideoGrid } from '@/shared/ui';
import { GalleryCard } from './GalleryCard';
import { galleryHref, type GalleryQuery } from './query';
import { SortSelect } from './SortSelect';

/**
 * `free`: the viewer still has the free video (or is not signed in), so a card without talking says `Free`.
 * `freeNotNow`: the templates whose card does not say it all the same: a free video on them would not start now (B1).
 * `showTalking`: talking templates are listed (a setting of the admin), so the `Talking` choice is offered.
 * `own`: how many ready templates of their own the viewer has; above 0 the list leads to them.
 * `visitor`: not signed in; an empty gallery then does not offer to add a video (only a customer can).
 */
export type GalleryViewData = { query: GalleryQuery; categories: string[]; templates: Template[]; others: Template[]; free: boolean; freeNotNow?: string[]; showTalking: boolean; own?: number; visitor?: boolean };

const PILL = 'flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border px-4.5 text-15 whitespace-nowrap no-underline';

export function AddCard() {
  const t = useT();
  return (
    <Link
      href="/templates/new"
      className="box-border flex aspect-9/16 flex-col items-center justify-center gap-3 rounded-16 border-[1.5px] border-dashed border-edge-strong p-6 text-center text-text no-underline"
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-raised text-accent-text">
        <Icon name="add" size={22} />
      </span>
      <span className="font-display text-20 font-bold tracking-[-0.01em]">{t('gallery.add.card.title')}</span>
      <span className="text-13 leading-snug text-text-3">{t('gallery.add.card.text')}</span>
    </Link>
  );
}

/** Heading, lead, search and the filter row (shared by the page and the loading skeleton). */
export function GalleryHead({ query, categories, interactive = true, showTalking = true }: { query: GalleryQuery; categories: string[]; interactive?: boolean; showTalking?: boolean }) {
  const t = useT();
  const formatOptions = [
    { value: '', label: t('gallery.filters.all') },
    { value: 'no-talking', label: t('common.format.noTalking') },
    ...(showTalking || query.format === 'talking' ? [{ value: 'talking', label: t('common.format.talking') }] : []),
  ];
  return (
    <>
      <section className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6">
        <h1 className="m-0 flex-[1_1_520px] font-display text-[clamp(42px,6.4vw,92px)] leading-[0.94] font-extrabold tracking-[-0.035em] text-balance">
          {t('gallery.title')} <span className="text-accent-text">{t('gallery.titleAccent')}</span>
        </h1>
        <div className="flex max-w-110 flex-[1_1_340px] flex-col gap-4">
          <p className="m-0 text-17 leading-normal text-text-2 text-pretty">{t('gallery.lead')}</p>
          <form action="/gallery" method="get" role="search">
            {query.category && <input type="hidden" name="category" value={query.category} />}
            {query.format && <input type="hidden" name="format" value={query.format} />}
            {query.sort !== 'newest' && <input type="hidden" name="sort" value={query.sort} />}
            <label className="flex min-h-13 items-center gap-3 rounded-12 border border-edge-strong bg-surface px-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-text">
              <Icon name="search" size={18} className="text-text-3" />
              <span className="sr-only">{t('gallery.search.label')}</span>
              <span className="relative flex-1">
                <input
                  type="search"
                  name="q"
                  defaultValue={query.q}
                  maxLength={80}
                  placeholder=" "
                  className="peer w-full min-w-0 border-0 bg-transparent text-15 text-text outline-0"
                />
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 hidden items-center text-15 text-text-3 peer-placeholder-shown:flex">
                  <span className="nav:hidden">{t('gallery.search.placeholderShort')}</span>
                  <span className="hidden nav:inline">{t('gallery.search.placeholder')}</span>
                </span>
              </span>
            </label>
          </form>
        </div>
      </section>

      <section aria-label={t('gallery.filters.label')} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div role="group" aria-label={t('gallery.filters.category')} className="-mx-4 flex gap-2 overflow-x-auto px-4 nav:mx-0 nav:flex-wrap nav:overflow-visible nav:px-0">
          {[{ value: '', label: t('gallery.filters.all') }, ...categories.map((c) => ({ value: c, label: c }))].map((c) => {
            const on = c.value === query.category;
            const cls = cx(PILL, on ? 'border-accent bg-accent font-semibold text-on-accent' : 'border-edge text-text-2 hover:text-text');
            return interactive ? (
              <Link key={c.value} href={galleryHref(query, { category: c.value })} aria-current={on ? 'page' : undefined} className={cls}>
                {c.label}
              </Link>
            ) : (
              <span key={c.value} className={cls}>
                {c.label}
              </span>
            );
          })}
        </div>
        {/* Under 360 px the format choice has the row to itself and the sort choice drops to the next one, so neither is cut off. */}
        <div className="flex min-w-0 flex-wrap items-center gap-3 max-nav:w-full nav:flex-nowrap">
          <div inert={!interactive} className="min-w-0 flex-[1_1_100%] min-[360px]:flex-[1_1_0] nav:flex-none">
            {interactive ? (
              <Segmented label={t('gallery.filters.format')} options={formatOptions} value={query.format} hrefFor={(value) => galleryHref(query, { format: value as GalleryQuery['format'] })} />
            ) : (
              <Segmented label={t('gallery.filters.format')} options={formatOptions} value="" onChange={() => {}} />
            )}
          </div>
          <SortSelect query={query} disabled={!interactive} />
        </div>
      </section>
    </>
  );
}

export function GalleryView({ data }: { data: GalleryViewData }) {
  const t = useT();
  const { query, categories, templates, others, free, freeNotNow = [], showTalking, own = 0, visitor = false } = data;
  const empty = templates.length === 0;
  const filtered = query.category !== '' || query.format !== '';
  const nothingAsked = !query.q && !filtered;
  return (
    <div className="flex flex-col gap-6 max-nav:-mt-2 nav:gap-12 nav:pt-4">
      <GalleryHead query={query} categories={categories} showTalking={showTalking} />
      <section aria-label={t('gallery.list.label')} className="flex flex-col gap-8">
        {own > 0 && (
          <Link href="/templates/new#yours" className="flex min-h-11 items-center gap-2 self-start text-15 font-medium no-underline">
            {t('gallery.list.yours', { count: own })}
            <Icon name="forward" size={18} />
          </Link>
        )}
        {empty ? (
          <>
            <div role="status" className="box-border flex flex-wrap items-center justify-between gap-x-12 gap-y-6 rounded-16 border-[1.5px] border-dashed border-edge-strong p-6 nav:p-8">
              <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2">
                <h2 className="m-0 heading-5 text-balance [overflow-wrap:anywhere]">{query.q ? t('gallery.empty.title', { query: query.q }) : t(nothingAsked ? (own > 0 ? 'gallery.empty.titleNoneOwn' : 'gallery.empty.titleNone') : 'gallery.empty.titleFilters')}</h2>
                <p className="m-0 max-w-155 text-15 leading-normal text-text-2 text-pretty">{t(nothingAsked ? (own > 0 ? 'gallery.empty.textNoneOwn' : visitor ? 'gallery.empty.textNoneVisitor' : 'gallery.empty.textNone') : 'gallery.empty.text')}</p>
              </div>
              <div className="flex flex-[1_1_100%] flex-col gap-3 nav:flex-none nav:flex-row nav:flex-wrap">
                {(query.q || filtered) && (
                  <Link href={galleryHref(query, query.q ? { q: '' } : { category: '', format: '' })} className={buttonClass('secondary')}>
                    {t('gallery.empty.clear')}
                  </Link>
                )}
                {!(visitor && nothingAsked) && (
                  <Link href="/templates/new" className={buttonClass(nothingAsked ? 'primary' : 'secondary')}>
                    {t('gallery.empty.add')}
                  </Link>
                )}
              </div>
            </div>
            {others.length > 0 && (
              <div className="flex flex-col gap-6">
                <h2 className="m-0 heading-5">{t('gallery.empty.other')}</h2>
                <Grid templates={others} free={free} freeNotNow={freeNotNow} />
              </div>
            )}
          </>
        ) : (
          <Grid templates={templates} free={free} freeNotNow={freeNotNow} withAdd />
        )}
      </section>
    </div>
  );
}

function Grid({ templates, free, freeNotNow, withAdd }: { templates: Template[]; free: boolean; freeNotNow: string[]; withAdd?: boolean }) {
  return (
    <VideoGrid>
      {withAdd && <AddCard />}
      {templates.map((template) => (
        <GalleryCard key={template.id} template={template} free={free && !freeNotNow.includes(template.id)} />
      ))}
    </VideoGrid>
  );
}
