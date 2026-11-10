'use client';

import { useT } from '@/core/i18n/I18nProvider';
import { cx } from '@/shared/lib/cx';
import { Icon, VideoGrid } from '@/shared/ui';
import { AddCard, GalleryHead } from './GalleryView';

/** Board A-Galeri-Yukleniyor: the page frame with skeleton cards (nine on the desktop: two rows of five with the add card; five on the phone). */
export function GalleryLoading({ categories }: { categories: string[] }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-6 max-nav:-mt-2 nav:gap-12 nav:pt-4">
      <GalleryHead query={{ q: '', category: '', format: '', sort: 'newest' }} categories={categories} interactive={false} />
      <section aria-label={t('gallery.list.label')} aria-busy="true" className="flex flex-col gap-4">
        <p role="status" className="m-0 flex items-center gap-2 text-13 leading-snug text-text-3">
          <Icon name="generating" size={16} className="animate-spin motion-reduce:animate-none" />
          {t('gallery.list.loading')}
        </p>
        <VideoGrid>
          <AddCard />
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} aria-hidden="true" className={cx('flex min-w-0 flex-col gap-3', i >= 5 && 'max-nav:hidden')}>
              <div className="aspect-9/16 animate-pulse rounded-16 bg-surface shadow-[0_0_0_1px_var(--media-edge)] motion-reduce:animate-none" />
              <div className="flex flex-col gap-2">
                <span className="h-3 w-4/5 rounded-full bg-raised" />
                <span className="h-3 w-1/2 rounded-full bg-raised" />
              </div>
            </div>
          ))}
        </VideoGrid>
      </section>
    </div>
  );
}
