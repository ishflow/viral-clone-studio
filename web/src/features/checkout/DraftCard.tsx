'use client';

import { useT } from '@/core/i18n/I18nProvider';
import { MediaImage } from '@/shared/ui';
import type { Draft } from './draft';

export function DraftSummary({ draft }: { draft: Draft }) {
  const t = useT();
  return (
    <div className="flex items-center gap-4">
      <div className="relative aspect-9/16 w-18 flex-none overflow-hidden rounded-8 bg-raised shadow-[0_0_0_1px_var(--media-edge)]">
        <MediaImage src={draft.image} alt={t('checkout.draft.imageAlt')} fill sizes="72px" className="object-cover" />
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-17 font-semibold">{draft.title}</span>
        <span className="text-13 leading-snug text-text-3">{t('checkout.draft.products', { count: draft.products })}</span>
      </div>
    </div>
  );
}
