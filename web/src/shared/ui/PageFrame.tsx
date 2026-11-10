'use client';

import type { ReactNode } from 'react';
import { useT } from '@/core/i18n/I18nProvider';

/** Link that appears on keyboard focus and jumps over the header. */
export function SkipLink() {
  const t = useT();
  return (
    <a
      href="#main"
      className="sr-only rounded-12 bg-accent px-4 py-3 text-15 font-semibold text-on-accent no-underline focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
    >
      {t('common.nav.skip')}
    </a>
  );
}

/**
 * The page shell of the (site), (app) and admin layouts: side gutter, 1320 px column, header, `<main id="main">`, optional footer.
 * Content starts 32 px under the header; pages must not render their own `<main>`.
 */
export function PageFrame({ header, footer, children }: { header: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return (
    <div className="page-gutter flex min-h-screen flex-col bg-bg pb-18 text-text">
      <SkipLink />
      <div className="mx-auto flex w-full max-w-330 flex-1 flex-col">
        {header}
        <main id="main" className="flex flex-1 flex-col pt-8">
          {children}
        </main>
        {footer}
      </div>
    </div>
  );
}
