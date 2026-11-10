'use client';

import Link from 'next/link';
import { useT } from '@/core/i18n/I18nProvider';
import { Dot, DesktopBar, NavPills, PhoneBar, PILL_ON, useCurrent } from './header-parts';
import { Logo } from './Logo';
import { MobileMenu } from './MobileMenu';
import { customerNav, type CustomerKey } from './nav';

/**
 * Header of signed-in customers (A-Hesap). `balanceLabel` is the finished text of the chip ("12 credits", "1 free video").
 * `current` is optional: without it the path decides. Only the server-verified administrator receives the admin entry.
 * `swap`: person swap is open, so both menus link to it.
 */
export function HeaderCustomer({ current, balanceLabel, isAdmin = false, swap = false }: { current?: CustomerKey; balanceLabel: string; isAdmin?: boolean; swap?: boolean }) {
  const t = useT();
  const active = useCurrent('customer', current);
  const accountOn = active === 'account';
  return (
    <>
      <DesktopBar>
        <Logo href="/gallery" />
        <NavPills items={customerNav(swap).filter((i) => i.key !== 'account')} current={active} label={t('common.nav.mainMenu')} />
        <div className="flex items-center gap-3">
          {isAdmin && <Link href="/admin" prefetch={false} className="flex min-h-11 items-center text-13 text-text no-underline">{t('common.nav.adminPanel')}</Link>}
          <span className="rounded-full border border-edge px-3.5 py-2 text-13 text-text-2">{balanceLabel}</span>
          <Link
            href="/account"
            prefetch={false}
            aria-current={accountOn ? 'page' : undefined}
            className={accountOn ? PILL_ON : 'flex min-h-11 items-center rounded-full px-4 text-15 font-medium text-text no-underline'}
          >
            {accountOn && <Dot />}
            {t('common.nav.account')}
          </Link>
        </div>
      </DesktopBar>
      <PhoneBar>
        <Logo href="/gallery" className="py-2.5" />
        <div className="flex items-center gap-2">
          <Link
            href="/account"
            prefetch={false}
            className="box-border flex min-h-11 items-center rounded-full border border-edge px-3 text-13 whitespace-nowrap text-text-2 no-underline"
          >
            {balanceLabel}
          </Link>
          <MobileMenu isAdmin={isAdmin} kind="customer" current={active} balanceLabel={balanceLabel} swap={swap} />
        </div>
      </PhoneBar>
    </>
  );
}
