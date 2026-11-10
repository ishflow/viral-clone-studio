'use client';

import { useT } from '@/core/i18n/I18nProvider';

/** "Person swap": what tells a person-swap video from a product template in the list and on its page. */
export function SwapTag() {
  const t = useT();
  return <span className="w-fit rounded-full border border-edge-strong px-2.5 py-0.5 text-13 font-medium text-text-2">{t('adminTemplates.swap.tag')}</span>;
}
