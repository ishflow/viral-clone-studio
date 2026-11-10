'use client';

import Link from 'next/link';
import { clearCookieConsent } from '@/core/consent/actions';
import { useT } from '@/core/i18n/I18nProvider';

const LINK = 'flex min-h-11 min-w-11 items-center text-text-2 no-underline hover:text-text';

export function Footer() {
  const t = useT();
  return (
    <footer className="mt-12 flex flex-wrap items-center justify-between gap-x-8 gap-y-4 border-t border-line pt-6 text-13 text-text-3">
      <span>{t('common.footer.company')}</span>
      <nav aria-label={t('common.footer.menu')} className="flex flex-wrap gap-x-6 gap-y-1">
        <Link href="/gallery" className={LINK}>
          {t('common.nav.gallery')}
        </Link>
        <Link href="/pricing" className={LINK}>
          {t('common.nav.pricing')}
        </Link>
        <Link href="/legal/terms" className={LINK}>
          {t('common.footer.terms')}
        </Link>
        <Link href="/legal/privacy" className={LINK}>
          {t('common.footer.privacy')}
        </Link>
        <Link href="/legal/refunds" className={LINK}>
          {t('common.footer.refunds')}
        </Link>
        <Link href="/legal/cookies" className={LINK}>
          {t('common.footer.cookies')}
        </Link>
        <Link href="/legal/content" className={LINK}>
          {t('common.footer.content')}
        </Link>
        <Link href="/contact" className={LINK}>
          {t('common.footer.contact')}
        </Link>
        <form action={clearCookieConsent} className="flex">
          <button type="submit" className={`${LINK} cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-[length:inherit]`}>
            {t('common.footer.cookieSettings')}
          </button>
        </form>
      </nav>
    </footer>
  );
}
