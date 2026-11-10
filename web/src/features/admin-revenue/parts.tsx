'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useT } from '@/core/i18n/I18nProvider';

/** A board section: h2 above its content. */
export function Section({ id, title, children, className }: { id: string; title: string; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={`flex min-w-0 flex-col gap-4 ${className ?? ''}`}>
      <h2 id={id} className="m-0 heading-6">{title}</h2>
      {children}
    </section>
  );
}

/** The user of a table row: the email, linked to the user's page. `email` is null when the account was deleted: no link, no id. */
export function UserCell({ userId, email }: { userId: string; email: string | null }) {
  const t = useT();
  if (email === null) return <span className="whitespace-nowrap text-text-3">{t('common.admin.deletedAccount')}</span>;
  return (
    <Link href={`/admin/users/${userId}`} title={email} className="inline-block truncate align-middle leading-11 -my-3 text-15 font-medium text-text underline decoration-edge-strong underline-offset-4 hover:decoration-text max-nav:max-w-48">
      {email}
    </Link>
  );
}
