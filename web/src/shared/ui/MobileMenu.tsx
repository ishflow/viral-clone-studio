'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import { cx } from '@/shared/lib/cx';
import { AdminTag, Dot, PHONE_ROUND } from './header-parts';
import { Icon } from './Icon';
import { LogOutForm } from './LogOutForm';
import { LanguageMenu } from './LanguageMenu';
import { Logo } from './Logo';
import { buttonClass } from './Button';
import { HOME_BY_KIND, NAV_BY_KIND, customerNav, type MenuKind } from './nav';

const LINK = 'box-content flex min-h-15 items-center gap-3 border-b border-line font-display text-24 leading-tight font-bold tracking-[-0.01em] no-underline';

/**
 * The menu button of the phone header plus the full-screen menu it opens (A-Menu-M, A-Menu-Ziyaretci-M, A-Menu-Admin-M).
 * Place it where the header's menu button goes. `current` is the active item key; `balanceLabel` is used by kind "customer"; `freeOffer` (default on) by kind "visitor": false leaves the first-video-free line out; `invite` (kind "visitor", sign-up by invitation only) offers "Request an invite" at `/contact` in place of "Get started"; `swap` by kind "customer": person swap is open and the menu links to it.
 */
export function MobileMenu({ kind, current, balanceLabel, isAdmin = false, freeOffer = true, invite = false, swap = false }: { kind: MenuKind; current?: string; balanceLabel?: string; isAdmin?: boolean; freeOffer?: boolean; invite?: boolean; swap?: boolean }) {
  const t = useT();
  const pathname = usePathname();
  // The menu is open only for the path it was opened on: Back, forward or a redirect (log out) closes it.
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath !== null && openPath === pathname;
  const setOpen = (v: boolean) => setOpenPath(v ? pathname : null);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const el = dialog.current;
    if (!el) return;
    const back = opener.current;
    if (typeof el.showModal === 'function') el.showModal();
    else el.setAttribute('open', '');
    closeButton.current?.focus();
    return () => {
      if (typeof el.close === 'function' && el.open) el.close();
      back?.focus();
    };
  }, [open]);

  const close = () => setOpen(false);
  const label = kind === 'admin' ? t('common.admin.menu') : t('common.nav.mainMenu');
  const items = kind === 'customer' ? customerNav(swap) : NAV_BY_KIND[kind];

  return (
    <>
      <button
        ref={opener}
        type="button"
        aria-label={t('common.nav.openMenu')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={PHONE_ROUND}
      >
        <Icon name="menu" />
      </button>
      {open && (
        <dialog
          ref={dialog}
          aria-label={label}
          onCancel={(e) => {
            e.preventDefault();
            close();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              close();
            }
          }}
          className="fixed inset-0 z-50 m-0 box-border h-full max-h-none w-full max-w-none flex-col gap-6 overflow-y-auto border-0 bg-bg px-4 pb-6 text-text open:flex"
        >
          <div className="flex items-center justify-between gap-3 border-b border-line py-3">
            {kind === 'admin' ? (
              <div className="flex items-center gap-2">
                <Logo href={HOME_BY_KIND[kind]} onClick={close} className="-my-2.5 py-2.5" />
                <AdminTag />
              </div>
            ) : (
              <Logo href={HOME_BY_KIND[kind]} onClick={close} className="-my-2.5 py-2.5" />
            )}
            <button ref={closeButton} type="button" aria-label={t('common.nav.closeMenu')} onClick={close} className={PHONE_ROUND}>
              <Icon name="close" />
            </button>
          </div>

          <nav aria-label={label} className="flex flex-col">
            {isAdmin && kind === 'customer' && <Link href="/admin" prefetch={false} onClick={close} className={LINK}>{t('common.nav.adminPanel')}</Link>}
            {items.map((item) => {
              const on = item.key === current;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  prefetch={false}
                  aria-current={on ? 'page' : undefined}
                  onClick={close}
                  className={cx(LINK, on ? 'text-text' : 'text-text-2')}
                >
                  {on && <Dot />}
                  {t(item.label)}
                </Link>
              );
            })}
          </nav>

          {kind === 'customer' && (
            <section aria-label={t('common.menu.creditBalance')} className="box-border flex flex-col gap-4 rounded-16 border border-line bg-surface p-6">
              <div className="flex flex-col gap-1">
                <span className="text-13 leading-snug text-text-3">{t('common.menu.creditBalance')}</span>
                <span className="heading-5">{balanceLabel}</span>
              </div>
              <Link href="/pricing" prefetch={false} onClick={close} className={buttonClass('primary', 'm', true)}>
                {t('common.menu.buyCredits')}
              </Link>
            </section>
          )}

          {kind === 'visitor' && (
            <section aria-label={t(invite ? 'common.nav.requestInvite' : 'common.nav.getStarted')} className="flex flex-col gap-3">
              {freeOffer && !invite && <p className="m-0 text-15 leading-normal text-text-2 text-pretty">{t('common.menu.firstFree')}</p>}
              <Link href={invite ? '/contact' : '/signup'} onClick={close} className={buttonClass('primary', 'l', true)}>
                {t(invite ? 'common.nav.requestInvite' : 'common.nav.getStarted')}
              </Link>
              <Link href="/login" onClick={close} className={buttonClass('secondary', 'l', true)}>
                {t('common.nav.logIn')}
              </Link>
            </section>
          )}

          <div className="mt-auto flex flex-col gap-2">
            {kind === 'admin' ? (
              <Link href="/gallery" onClick={close} className={buttonClass('secondary', 'm', true, 'gap-2')}>
                {t('common.admin.viewSite')}
                <Icon name="external" />
              </Link>
            ) : (
              <LanguageMenu variant="row" />
            )}
            {kind === 'customer' && (
              <LogOutForm>
                <button type="submit" className="flex min-h-11 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-15 font-medium text-text-2">
                  {t('common.nav.logOut')}
                </button>
              </LogOutForm>
            )}
          </div>
        </dialog>
      )}
    </>
  );
}
