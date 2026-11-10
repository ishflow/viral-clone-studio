'use client';

import { useT } from '@/core/i18n/I18nProvider';
import { SubNav } from '@/shared/ui';

/** All templates · Inbox · Scan history. */
export function TemplatesNav({ current }: { current: 'all' | 'inbox' | 'scans' }) {
  const t = useT();
  const items = [
    { href: '/admin/templates', label: t('adminTemplates.nav.all') },
    { href: '/admin/templates/inbox', label: t('adminTemplates.nav.inbox') },
    { href: '/admin/templates/scans', label: t('adminTemplates.nav.scans') },
  ];
  return <div className="-mt-8"><SubNav label={t('adminTemplates.nav.label')} items={items} currentHref={items[['all', 'inbox', 'scans'].indexOf(current)]!.href} /></div>;
}
