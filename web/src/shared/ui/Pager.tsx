'use client';

import Link from 'next/link';
import { useT } from '@/core/i18n/I18nProvider';
import { Icon } from './Icon';

const BTN =
  'box-border inline-flex min-h-11 w-full items-center nav:w-auto justify-center gap-2 rounded-12 border px-4 text-15 font-semibold no-underline';
const ON = 'cursor-pointer border-edge-strong bg-transparent text-text hover:bg-raised';
const OFF = 'cursor-not-allowed border-edge-strong bg-transparent text-text-3';

/** Under a table: "Showing {shown} of {total}", then Previous / Next. Without a href the button is disabled. */
export function Pager({ shown, total, prevHref, nextHref }: { shown: number | string; total: number | string; prevHref?: string; nextHref?: string }) {
  const t = useT();
  const prev = t('common.pager.previous');
  const next = t('common.pager.next');
  return (
    <div className="flex flex-col gap-3 nav:flex-row nav:flex-wrap nav:items-center nav:justify-between">
      <span className="text-13 leading-snug text-text-3">{t('common.pager.showing', { shown: t('common.pager.range', { shown, total }) })}</span>
      <div className="grid grid-cols-2 gap-2 nav:flex">
        {prevHref ? (
          <Link href={prevHref} className={`${BTN} ${ON}`}>
            <Icon name="back" size={18} />
            {prev}
          </Link>
        ) : (
          <button type="button" disabled aria-disabled="true" className={`${BTN} ${OFF}`}>
            <Icon name="back" size={18} />
            {prev}
          </button>
        )}
        {nextHref ? (
          <Link href={nextHref} className={`${BTN} ${ON}`}>
            {next}
            <Icon name="forward" size={18} />
          </Link>
        ) : (
          <button type="button" disabled aria-disabled="true" className={`${BTN} ${OFF}`}>
            {next}
            <Icon name="forward" size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
