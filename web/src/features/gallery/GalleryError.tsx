'use client';

import { useT } from '@/core/i18n/I18nProvider';
import { LoadError } from '@/shared/ui';
import { GalleryHead } from './GalleryView';

/** Board A-Galeri-Hata: the gallery could not be read. The page frame stays (an empty, inert filter row), the card says so and offers a retry. */
export function GalleryError({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-6 max-nav:-mt-2 nav:gap-12 nav:pt-4">
      <GalleryHead query={{ q: '', category: '', format: '', sort: 'newest' }} categories={[]} interactive={false} />
      <section aria-label={t('gallery.list.label')}>
        <LoadError title={t('gallery.error.title')} text={t('gallery.error.text')} onRetry={onRetry} />
      </section>
    </div>
  );
}
