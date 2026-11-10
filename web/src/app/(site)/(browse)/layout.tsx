import type { ReactNode } from 'react';
import { PageFrame } from '@/shared/ui';
import { SessionHeader } from '@/shared/ui/SessionHeader';

/** The gallery and the template page: public, but without a footer (their boards have none), for a visitor and a signed-in customer alike. */
export default function BrowseLayout({ children }: { children: ReactNode }) {
  return <PageFrame header={<SessionHeader />}>{children}</PageFrame>;
}
