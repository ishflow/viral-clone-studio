'use client';

import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, type ReactNode } from 'react';

const Shown = createContext<string | null>(null);

/** Around the pages, in the layout that renders the customer header: the text of the balance chip as that header shows it. */
export function ShownBalance({ label, children }: { label: string; children: ReactNode }) {
  return <Shown.Provider value={label}>{children}</Shown.Provider>;
}

/**
 * On a page whose own read can change the balance: a job that stopped gives its credits back the moment it is read. `label` is the
 * text of the chip read after that. The client router keeps the layout, so a page that arrives on its own leaves the header with the
 * balance from before; a server action calls `refreshShell()` for this, a render cannot. When the header shows another text, the route
 * is refreshed once and the header catches up.
 */
export function BalanceNow({ label }: { label: string }) {
  const router = useRouter();
  const shown = useContext(Shown);
  useEffect(() => {
    if (shown !== null && shown !== label) router.refresh();
  }, [shown, label, router]);
  return null;
}
