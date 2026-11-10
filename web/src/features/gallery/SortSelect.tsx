'use client';

import { useT } from '@/core/i18n/I18nProvider';
import type { GalleryQuery } from './query';

/** The sort control: a GET form (keeps q, category, format) that submits when the choice changes. */
export function SortSelect({ query, disabled }: { query: GalleryQuery; disabled?: boolean }) {
  const t = useT();
  return (
    <form action="/gallery" method="get" className="flex shrink-0 items-center gap-2">
      {query.q && <input type="hidden" name="q" value={query.q} />}
      {query.category && <input type="hidden" name="category" value={query.category} />}
      {query.format && <input type="hidden" name="format" value={query.format} />}
      <label className="flex items-center gap-2 text-13 text-text-3">
        <span className="sr-only nav:not-sr-only">{t('gallery.filters.sort')}</span>
        <select
          name="sort"
          defaultValue={query.sort}
          disabled={disabled}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="min-h-11 max-w-40 rounded-12 border border-edge-strong bg-surface px-3 text-15 text-text"
        >
          <option value="newest">{t('gallery.filters.newest')}</option>
          <option value="used">{t('gallery.filters.mostUsed')}</option>
        </select>
      </label>
    </form>
  );
}
