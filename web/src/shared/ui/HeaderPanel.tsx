'use client';

import Link from 'next/link';
import { useT } from '@/core/i18n/I18nProvider';
import { AdminTag, DesktopBar, NavPills, PhoneBar, useCurrent } from './header-parts';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { MobileMenu } from './MobileMenu';
import { PANEL_NAV, type PanelKey } from './nav';

/** The admin panel's own header (Admin tag, six sections, "View site" → /gallery). `current` is optional: without it the path decides. */
export function HeaderPanel({ current }: { current?: PanelKey }) {
  const t = useT();
  const active = useCurrent('admin', current);
  return (
    <>
      <DesktopBar className="panel:gap-x-4 wide:gap-x-8">
        <div className="order-1 flex items-center gap-3">
          <Logo href="/admin" />
          <AdminTag />
        </div>
        <NavPills
          items={PANEL_NAV}
          current={active}
          label={t('common.admin.menu')}
          className="order-3 basis-full panel:order-2 panel:basis-auto"
          pillClassName="panel:px-2 wide:px-4"
        />
        <Link
          href="/gallery"
          className="order-2 ml-auto flex min-h-11 items-center gap-2 text-15 font-medium text-text-2 no-underline hover:text-text panel:order-3 panel:ml-0 panel:min-w-11 panel:justify-center wide:min-w-0"
        >
          <span className="panel:sr-only wide:not-sr-only">{t('common.admin.viewSite')}</span>
          <Icon name="external" size={18} />
        </Link>
      </DesktopBar>
      <PhoneBar>
        <div className="flex items-center gap-2">
          <Logo href="/admin" className="py-2.5" />
          <AdminTag />
        </div>
        <MobileMenu kind="admin" current={active} />
      </PhoneBar>
    </>
  );
}
