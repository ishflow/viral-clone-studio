'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import { cx } from '@/shared/lib/cx';
import { Icon } from './Icon';
import { currentFromPath, type MenuKind, type NavItem } from './nav';

/** The explicit `current` prop wins; otherwise the path decides (layouts never pass it). */
export function useCurrent(kind: MenuKind, current: string | undefined): string | undefined {
  const pathname = usePathname();
  return current ?? currentFromPath(kind, pathname);
}

const PILL = 'flex min-h-11 items-center rounded-full px-4 text-15 font-medium no-underline';
export const PILL_OFF = `${PILL} text-text-3 hover:text-text`;
export const PILL_ON = `${PILL} gap-2 bg-raised text-text`;

export function Dot() {
  return <span aria-hidden="true" className="size-1.75 rounded-full bg-accent-text" />;
}

export function NavPills({
  items,
  current,
  label,
  className,
  pillClassName,
}: {
  items: readonly NavItem[];
  current?: string;
  label: string;
  className?: string;
  pillClassName?: string;
}) {
  const t = useT();
  return (
    <nav aria-label={label} className={cx('flex flex-wrap gap-1', className)}>
      {items.map((item) => {
        const on = item.key === current;
        return (
          <Link key={item.key} href={item.href} prefetch={false} aria-current={on ? 'page' : undefined} className={cx(on ? PILL_ON : PILL_OFF, pillClassName)}>
            {on && <Dot />}
            {t(item.label)}
          </Link>
        );
      })}
    </nav>
  );
}

/** The wide header (from the `nav` breakpoint up). */
export function DesktopBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <header className={cx('hidden flex-wrap items-center justify-between gap-x-8 gap-y-4 border-b border-line py-4.5 nav:flex', className)}>
      {children}
    </header>
  );
}

/** The phone header: logo, the one thing needed most, menu button. */
export function PhoneBar({ children }: { children: ReactNode }) {
  return <header className="flex items-center justify-between gap-3 border-b border-line py-3 nav:hidden">{children}</header>;
}

export function AdminTag({ className }: { className?: string }) {
  const t = useT();
  return (
    <span className={cx('rounded-8 border border-edge px-2 py-1 text-13 font-semibold text-text-2', className)}>{t('common.admin.label')}</span>
  );
}

export const PHONE_ROUND = 'flex size-11 flex-none items-center justify-center rounded-full border border-edge box-border text-text no-underline cursor-pointer bg-transparent p-0';

export function MenuIcon() {
  return <Icon name="menu" />;
}
