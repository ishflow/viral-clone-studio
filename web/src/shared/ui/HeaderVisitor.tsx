'use client';

import Link from 'next/link';
import { useT } from '@/core/i18n/I18nProvider';
import { DesktopBar, NavPills, PhoneBar, useCurrent } from './header-parts';
import { LanguageMenu } from './LanguageMenu';
import { Logo } from './Logo';
import { MobileMenu } from './MobileMenu';
import { VISITOR_NAV, type VisitorKey } from './nav';

/**
 * Header of signed-out visitors (A-Fiyatlar). Below 900 px it becomes the phone bar.
 * `current` is optional: without it the path decides. `actions="language"` keeps only the EN button on the desktop right (auth pages); `freeOffer={false}` leaves "Your first video is free" out of the phone menu (the admin switched the offer off); `phoneCta={false}` drops "Get started" from the phone bar (login / sign-up pages); `invite` (sign-up is by invitation, `inviteOnly()` in core) turns "Get started" into "Request an invite" at `/contact`.
 */
export function HeaderVisitor({
  current,
  phoneCta = true,
  actions = 'full',
  freeOffer = true,
  invite = false,
}: {
  current?: VisitorKey;
  phoneCta?: boolean;
  actions?: 'full' | 'language';
  freeOffer?: boolean;
  invite?: boolean;
}) {
  const t = useT();
  const active = useCurrent('visitor', current);
  return (
    <>
      <DesktopBar>
        <Logo href="/" />
        <NavPills items={VISITOR_NAV} current={active} label={t('common.nav.mainMenu')} />
        <div className="flex items-center gap-2.5">
          <LanguageMenu />
          {actions === 'full' && (
            <>
          <Link href="/login" className="flex min-h-11 items-center px-3 text-15 font-medium text-text no-underline">
            {t('common.nav.logIn')}
          </Link>
          <Link
            href={invite ? '/contact' : '/signup'}
            className="flex min-h-11 items-center rounded-full bg-accent px-5 text-15 font-semibold text-on-accent no-underline hover:bg-accent-hover"
          >
            {t(invite ? 'common.nav.requestInvite' : 'common.nav.getStarted')}
          </Link>
            </>
          )}
        </div>
      </DesktopBar>
      <PhoneBar>
        <Logo href="/" className="py-2.5" />
        <div className="flex items-center gap-2">
          {phoneCta && (
            <Link
              href={invite ? '/contact' : '/signup'}
              className="flex min-h-11 items-center rounded-full bg-accent px-4 text-15 font-semibold whitespace-nowrap text-on-accent no-underline hover:bg-accent-hover"
            >
              {t(invite ? 'common.nav.requestInvite' : 'common.nav.getStarted')}
            </Link>
          )}
          <MobileMenu kind="visitor" current={active} freeOffer={freeOffer} invite={invite} />
        </div>
      </PhoneBar>
    </>
  );
}
