import type { ReactNode } from 'react';
import { getCookieConsent } from '@/core/consent/server';
import { CookieNotice } from '@/shared/ui';

/**
 * The public pages. The frame comes from the two groups below: `(marketing)` has the footer, `(browse)` has none.
 * A route group decides it, so the footer is right after a soft navigation too (a layout does not render again for a new path).
 */
export default async function SiteLayout({ children }: { children: ReactNode }) {
  const answered = (await getCookieConsent()) !== null;
  return (
    <>
      {children}
      <CookieNotice answered={answered} />
    </>
  );
}
