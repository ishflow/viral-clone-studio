'use client';

import type { ReactNode } from 'react';
import { logOut } from '@/core/session/actions';
import { dropAllDrafts } from '@/shared/lib/session-draft';

/** The log-out form: ends the session and clears the forms this tab kept, so the next person on the tab does not find them. */
export function LogOutForm({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <form action={logOut} onSubmit={dropAllDrafts} className={className}>
      {children}
    </form>
  );
}
