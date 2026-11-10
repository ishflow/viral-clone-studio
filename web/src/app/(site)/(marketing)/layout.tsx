import type { ReactNode } from 'react';
import { Footer, PageFrame } from '@/shared/ui';
import { SessionHeader } from '@/shared/ui/SessionHeader';

/** Home, pricing, legal and contact: the public frame with the footer (the boards of these pages have one). */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <PageFrame header={<SessionHeader />} footer={<Footer />}>
      {children}
    </PageFrame>
  );
}
