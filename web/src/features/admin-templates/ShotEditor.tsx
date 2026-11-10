'use client';

import { useT } from '@/core/i18n/I18nProvider';
import { cx } from '@/shared/lib/cx';
import { Button, Icon, MediaImage } from '@/shared/ui';
import type { Shot } from '@/data/ports';
import { clock, tileShots, type ShotDraft } from './shots';

const ROW = 'grid items-center gap-x-4 gap-y-3 px-4 py-3 max-nav:grid-cols-[1fr_auto] nav:grid-cols-[28px_44px_104px_minmax(0,262fr)_minmax(0,232fr)_132px_136px]';
const INPUT = 'box-border min-h-13 w-full min-w-0 rounded-12 border border-edge-strong bg-bg px-4 text-15 text-text';
const ICON_BUTTON = 'flex size-11 cursor-pointer items-center justify-center rounded-12 border-0 bg-transparent text-text hover:bg-raised disabled:cursor-not-allowed disabled:text-text-3 disabled:opacity-50 disabled:hover:bg-transparent';

/** The rows of the shot list. Times are read-only: they tile the template length, so they are recomputed on every change. */
export function ShotEditor({
  drafts, onChange, seconds, products, errorRow,
}: {
  drafts: Shot[];
  onChange: (next: Shot[]) => void;
  seconds: number;
  products: number;
  errorRow?: number;
}) {
  const t = useT();
  // Times are the stored ones; they are re-tiled only when a shot is added, removed or moved.
  const timed = drafts;
  const patch = (i: number, change: Partial<ShotDraft>) => onChange(drafts.map((d, j) => (j === i ? { ...d, ...change } : d)));
  const retile = (next: Shot[]) => onChange(tileShots(seconds, next));
  const move = (i: number, by: -1 | 1) => {
    const next = [...drafts];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    retile(next);
  };
  const full = drafts.length >= seconds;
  const productOptions = Array.from({ length: Math.max(products, ...drafts.map((d) => d.product ?? 0)) }, (_, k) => k + 1);
  return (
    <div className="flex flex-col rounded-16 border border-line bg-surface">
      <div role="table" aria-label={t('adminTemplates.edit.caption')} className="flex flex-col">
        <div role="rowgroup" className="max-nav:hidden">
          <div role="row" className={cx(ROW, 'border-b border-line py-3 text-13 font-medium text-text-3')}>
            <span role="columnheader">{t('adminTemplates.edit.col.n')}</span>
            <span aria-hidden="true" />
            <span role="columnheader">{t('adminTemplates.edit.col.time')}</span>
            <span role="columnheader">{t('adminTemplates.edit.col.action')}</span>
            <span role="columnheader">{t('adminTemplates.edit.col.text')}</span>
            <span role="columnheader">{t('adminTemplates.edit.col.product')}</span>
            <span role="columnheader" className="sr-only">{t('adminTemplates.edit.col.actions')}</span>
          </div>
        </div>
        <div role="rowgroup">
          {drafts.map((draft, i) => {
            const n = i + 1;
            return (
              <div key={i} role="row" aria-invalid={errorRow === n ? true : undefined} className={cx(ROW, 'border-b border-line', errorRow === n && 'bg-raised')}>
                <div className="flex items-center gap-3 max-nav:col-start-1 max-nav:row-start-1 nav:contents">
                  <span role="rowheader" className="text-15 font-semibold">{n}</span>
                  {draft.image ? (
                    <MediaImage src={draft.image} alt="" width={44} height={78} className="h-19.5 w-11 shrink-0 rounded-8 object-cover shadow-[0_0_0_1px_var(--media-edge)]" />
                  ) : (
                    <span aria-hidden="true" className="box-border h-19.5 w-11 shrink-0 rounded-8 border-[1.5px] border-dashed border-edge-strong" />
                  )}
                  <span role="cell" className="text-15 font-medium whitespace-nowrap text-accent-text">{`${clock(timed[i]!.from)}–${clock(timed[i]!.to)}`}</span>
                </div>
                <label role="cell" className="flex min-w-0 flex-col gap-1 max-nav:col-span-2">
                  <span aria-hidden="true" className="text-13 text-text-3 nav:hidden">{t('adminTemplates.edit.col.action')}</span>
                  <input className={INPUT} aria-label={t('adminTemplates.edit.shotAction', { n })} value={draft.action} maxLength={200} onChange={(e) => patch(i, { action: e.target.value })} />
                </label>
                <label role="cell" className="flex min-w-0 flex-col gap-1 max-nav:col-span-2">
                  <span aria-hidden="true" className="text-13 text-text-3 nav:hidden">{t('adminTemplates.edit.col.text')}</span>
                  <input className={INPUT} aria-label={t('adminTemplates.edit.shotText', { n })} value={draft.text} maxLength={120} onChange={(e) => patch(i, { text: e.target.value })} />
                </label>
                <label role="cell" className="flex min-w-0 flex-col gap-1 max-nav:col-span-2">
                  <span aria-hidden="true" className="text-13 text-text-3 nav:hidden">{t('adminTemplates.edit.col.product')}</span>
                  <select className={INPUT} aria-label={t('adminTemplates.edit.shotProduct', { n })} value={draft.product ?? ''} onChange={(e) => patch(i, { product: e.target.value === '' ? null : Number(e.target.value) })}>
                    <option value="">{t('adminTemplates.edit.noProduct')}</option>
                    {productOptions.map((p) => <option key={p} value={p}>{t('adminTemplates.edit.productN', { n: p })}</option>)}
                  </select>
                </label>
                <div role="cell" className="flex items-center max-nav:col-start-2 max-nav:row-start-1">
                  <button type="button" className={ICON_BUTTON} aria-label={t('adminTemplates.edit.up', { n })} disabled={i === 0} onClick={() => move(i, -1)}><Icon name="arrow up" /></button>
                  <button type="button" className={ICON_BUTTON} aria-label={t('adminTemplates.edit.down', { n })} disabled={i === drafts.length - 1} onClick={() => move(i, 1)}><Icon name="arrow down" /></button>
                  <button type="button" className={ICON_BUTTON} aria-label={t('adminTemplates.edit.remove', { n })} onClick={() => retile(drafts.filter((_, j) => j !== i))}><Icon name="delete" size={20} /></button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
        <Button variant="secondary" className="gap-2 max-nav:w-full" disabled={full} onClick={() => retile([...drafts, { n: drafts.length + 1, from: 0, to: 0, action: t('adminTemplates.edit.newShot'), text: '', product: null }])}>
          <Icon name="add" size={20} />
          {t('adminTemplates.edit.addShot')}
        </Button>
        <p className="m-0 min-w-0 flex-1 basis-60 max-nav:basis-full text-13 leading-snug text-text-3">{full ? t('adminTemplates.edit.maxShots', { count: seconds }) : t('adminTemplates.edit.shotsNote')}</p>
      </div>
    </div>
  );
}
